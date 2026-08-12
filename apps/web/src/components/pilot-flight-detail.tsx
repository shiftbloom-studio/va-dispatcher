"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Ban, Check, Plane, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { ReasonAction } from "@/components/action-dialog";
import { PageHeading } from "@/components/page-heading";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { ApiError, apiErrorMessage } from "@/lib/api/http";
import { flightResponseSchema } from "@/lib/api/schemas";
import { jsonBody, useApi } from "@/lib/api/use-api";
import { flightActions } from "@/lib/status";
import { formatUtc } from "@/lib/utc";

type PilotAction = "accept" | "decline" | "cancel";

export function PilotFlightDetail({
  slug,
  flightId,
}: {
  slug: string;
  flightId: string;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const flight = useQuery({
    queryKey: [slug, "flight", flightId],
    queryFn: () =>
      api(`/flights/${flightId}`, { schema: flightResponseSchema }),
  });
  const transition = useMutation({
    mutationFn: async ({
      action,
      reason,
    }: {
      action: PilotAction;
      reason?: string;
    }) =>
      api(`/flights/${flightId}/${action}`, {
        method: "POST",
        schema: flightResponseSchema,
        ...(action === "accept"
          ? {}
          : jsonBody({ reason: reason || undefined })),
      }),
    onSuccess: async (data) => {
      queryClient.setQueryData([slug, "flight", flightId], data);
      await queryClient.invalidateQueries({
        queryKey: [slug, "pilot", "flights"],
      });
      setNotice("Flight state updated.");
    },
  });

  async function performAction(action: PilotAction, reason?: string) {
    setNotice(null);
    try {
      await transition.mutateAsync({ action, reason });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        await flight.refetch();
        setNotice(
          "This flight changed while you were viewing it. The current state has been reloaded.",
        );
      }
      throw error;
    }
  }

  if (flight.isPending) return <LoadingState label="Loading flight" />;
  if (flight.isError)
    return (
      <ErrorState
        message={apiErrorMessage(flight.error)}
        onRetry={() => void flight.refetch()}
      />
    );

  const currentFlight = flight.data.flight;
  const actions = flightActions("pilot", currentFlight.status);

  return (
    <>
      <Link
        href={`/${slug}/portal`}
        className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-950"
      >
        <ArrowLeft aria-hidden className="size-4" /> Back to portal
      </Link>
      <PageHeading
        eyebrow="Flight workspace"
        title={currentFlight.flightNumber}
        description={`${currentFlight.depIcao} to ${currentFlight.arrIcao} · all times UTC / Zulu`}
        action={<StatusBadge status={currentFlight.status} />}
      />
      {notice ? (
        <p
          role="status"
          className="mb-5 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900"
        >
          {notice}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card className="overflow-hidden">
          <div className="bg-slate-950 p-6 text-white sm:p-8">
            <div className="flex items-center justify-between gap-5">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
                  Departure
                </p>
                <p className="mt-1 font-display text-5xl font-semibold">
                  {currentFlight.depIcao}
                </p>
                <p className="mt-2 text-sm text-slate-300">
                  {formatUtc(currentFlight.etd)}
                </p>
              </div>
              <div className="flex min-w-16 flex-1 items-center gap-3 text-slate-500">
                <span className="h-px flex-1 bg-slate-700" />
                <Plane aria-hidden className="size-6" />
                <span className="h-px flex-1 bg-slate-700" />
              </div>
              <div className="text-right">
                <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
                  Arrival
                </p>
                <p className="mt-1 font-display text-5xl font-semibold">
                  {currentFlight.arrIcao}
                </p>
                <p className="mt-2 text-sm text-slate-300">
                  {formatUtc(currentFlight.eta)}
                </p>
              </div>
            </div>
          </div>
          <dl className="grid gap-px bg-slate-200 sm:grid-cols-3">
            <div className="bg-white p-5">
              <dt className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Aircraft
              </dt>
              <dd className="mt-1 font-semibold text-slate-950">
                {currentFlight.aircraftType || "TBA"}
              </dd>
            </div>
            <div className="bg-white p-5">
              <dt className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Flight
              </dt>
              <dd className="mt-1 font-semibold text-slate-950">
                {currentFlight.flightNumber}
              </dd>
            </div>
            <div className="bg-white p-5">
              <dt className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Updated
              </dt>
              <dd className="mt-1 font-semibold text-slate-950">
                {formatUtc(currentFlight.updatedAt)}
              </dd>
            </div>
          </dl>
          {currentFlight.dispatcherNotes ? (
            <div className="border-t border-slate-100 p-5">
              <h2 className="font-display text-lg font-semibold">
                Dispatcher notes
              </h2>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                {currentFlight.dispatcherNotes}
              </p>
            </div>
          ) : null}
        </Card>

        <Card className="h-fit overflow-hidden">
          <CardHeader
            title="Your decision"
            description={
              actions.length
                ? "Choose the next action for this flight."
                : "This flight is read-only in its current state."
            }
          />
          <div className="space-y-3 p-5">
            {actions.includes("accept") ? (
              <Button
                className="w-full"
                disabled={transition.isPending}
                onClick={() =>
                  void performAction("accept").catch(() => undefined)
                }
              >
                <Check aria-hidden className="size-4" /> Accept flight
              </Button>
            ) : null}
            {actions.includes("decline") ? (
              <ReasonAction
                trigger={
                  <Button variant="secondary" className="w-full text-red-700">
                    <X aria-hidden className="size-4" /> Decline flight
                  </Button>
                }
                title="Decline this flight?"
                detail="Dispatch will see the decision immediately. You can add an optional reason."
                confirmLabel="Decline flight"
                danger
                onConfirm={(reason) => performAction("decline", reason)}
              />
            ) : null}
            {actions.includes("cancel") ? (
              <ReasonAction
                trigger={
                  <Button variant="secondary" className="w-full text-red-700">
                    <Ban aria-hidden className="size-4" /> Cancel flight
                  </Button>
                }
                title="Cancel this flight?"
                detail="This ends your participation in the accepted or briefed flight. Add context for dispatch if useful."
                confirmLabel="Cancel flight"
                danger
                onConfirm={(reason) => performAction("cancel", reason)}
              />
            ) : null}
            {transition.isError &&
            !(
              transition.error instanceof ApiError &&
              transition.error.status === 409
            ) ? (
              <p
                role="alert"
                className="rounded-lg bg-red-50 p-3 text-sm text-red-800"
              >
                {apiErrorMessage(transition.error)}
              </p>
            ) : null}
            {!actions.length ? (
              <p className="rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">
                No further pilot action is available. Dispatch controls
                operational advancement after briefing.
              </p>
            ) : null}
          </div>
        </Card>
      </div>
    </>
  );
}
