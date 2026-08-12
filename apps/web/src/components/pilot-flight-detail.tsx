"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  Check,
  CheckCheck,
  Plane,
  PlaneTakeoff,
  RadioTower,
  X,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { ReasonAction } from "@/components/action-dialog";
import { DispatchReleaseSnapshot } from "@/components/flight-planning-workspace";
import { PageHeading } from "@/components/page-heading";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { ApiError, apiErrorMessage } from "@/lib/api/http";
import {
  flightDetailResponseSchema,
  flightResponseSchema,
} from "@/lib/api/schemas";
import { jsonBody, useApi } from "@/lib/api/use-api";
import { formatUtc } from "@/lib/utc";

type PilotDecision = "accept" | "decline" | "cancel";

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
  const detail = useQuery({
    queryKey: [slug, "flight", flightId],
    queryFn: () =>
      api(`/flights/${flightId}`, { schema: flightDetailResponseSchema }),
  });

  async function refresh(message: string) {
    await Promise.all([
      detail.refetch(),
      queryClient.invalidateQueries({ queryKey: [slug, "pilot", "flights"] }),
    ]);
    setNotice(message);
  }

  const decision = useMutation({
    mutationFn: ({
      action,
      reason,
    }: {
      action: PilotDecision;
      reason?: string;
    }) =>
      api(`/flights/${flightId}/${action}`, {
        method: "POST",
        schema: flightResponseSchema,
        ...jsonBody({
          expectedVersion: detail.data?.flight.version,
          reason: action === "accept" ? undefined : reason || undefined,
        }),
      }),
    onSuccess: (_data, input) =>
      refresh(
        input.action === "accept"
          ? "Assignment accepted and confirmed."
          : "Flight state updated.",
      ),
  });
  const confirm = useMutation({
    mutationFn: () =>
      api(`/flights/${flightId}/confirm-assignment`, {
        method: "POST",
        schema: flightResponseSchema,
        ...jsonBody({ expectedVersion: detail.data?.flight.version }),
      }),
    onSuccess: () => refresh("Current assignment revision confirmed."),
  });
  const progress = useMutation({
    mutationFn: (action: "start" | "finish") =>
      api(`/flights/${flightId}/${action}`, {
        method: "POST",
        schema: flightResponseSchema,
        ...jsonBody({ expectedVersion: detail.data?.flight.version }),
      }),
    onSuccess: (_data, action) =>
      refresh(
        action === "start"
          ? "Flight started. Actual OUT time was recorded from the pilot portal."
          : "Flight finished. Actual IN time was recorded from the pilot portal.",
      ),
  });

  async function act(action: PilotDecision, reason?: string) {
    setNotice(null);
    try {
      await decision.mutateAsync({ action, reason });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        await detail.refetch();
        setNotice("This flight changed. The current state has been reloaded.");
      }
      throw error;
    }
  }

  if (detail.isPending)
    return <LoadingState label="Loading flight workspace" />;
  if (detail.isError) {
    return (
      <ErrorState
        message={apiErrorMessage(detail.error)}
        onRetry={() => void detail.refetch()}
      />
    );
  }

  const flight = detail.data.flight;
  const mutationError = decision.error ?? confirm.error ?? progress.error;
  const busy = decision.isPending || confirm.isPending || progress.isPending;
  const mayCancel = ["offered", "accepted", "briefed"].includes(flight.status);

  return (
    <>
      <Link
        href={`/${slug}/portal`}
        className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-slate-600 hover:text-slate-950"
      >
        <ArrowLeft aria-hidden className="size-4" /> Back to portal
      </Link>
      <PageHeading
        eyebrow="Pilot flight workspace"
        title={flight.flightNumber}
        description={`${flight.depIcao} to ${flight.arrIcao} · all operational times UTC / Zulu`}
        action={<StatusBadge status={flight.status} />}
      />

      {notice ? (
        <p
          role="status"
          className="mb-5 border border-sky-300 bg-sky-50 p-3 text-sm text-sky-900"
        >
          {notice}
        </p>
      ) : null}
      {flight.assignmentConfirmationRequired ? (
        <div className="mb-5 flex gap-3 border border-amber-400 bg-amber-50 p-4 text-amber-950">
          <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0" />
          <div>
            <p className="font-black">Your assignment changed</p>
            <p className="mt-1 text-sm leading-6">
              Review revision {flight.assignmentRevision}: {flight.flightNumber}{" "}
              · {flight.depIcao}—{flight.arrIcao} · ETD {formatUtc(flight.etd)}.
              Confirm it below. Starting the flight also confirms the current
              revision.
            </p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-5">
          <Card className="overflow-hidden">
            <div className="bg-[#17213d] p-6 text-white sm:p-8">
              <div className="flex items-center justify-between gap-5">
                <AirportTime
                  label="Departure"
                  icao={flight.depIcao}
                  time={flight.etd}
                />
                <div className="flex min-w-16 flex-1 items-center gap-3 text-slate-400">
                  <span className="h-px flex-1 bg-slate-600" />
                  <Plane
                    aria-hidden
                    className="size-6 text-[var(--brand-border)]"
                  />
                  <span className="h-px flex-1 bg-slate-600" />
                </div>
                <AirportTime
                  label="Arrival"
                  icao={flight.arrIcao}
                  time={flight.eta}
                  align="right"
                />
              </div>
            </div>
            <dl className="grid gap-px bg-slate-200 sm:grid-cols-4">
              <FlightDatum
                label="Aircraft"
                value={flight.aircraftType || "TBA"}
              />
              <FlightDatum
                label="Assignment"
                value={`R${flight.assignmentRevision}`}
              />
              <FlightDatum
                label="Actual OUT"
                value={flight.outAt ? formatUtc(flight.outAt) : "Not recorded"}
              />
              <FlightDatum
                label="Actual IN"
                value={flight.inAt ? formatUtc(flight.inAt) : "Not recorded"}
              />
            </dl>
            {flight.dispatcherNotes ? (
              <div className="border-t border-slate-200 p-5">
                <h2 className="font-display text-lg font-black">
                  Planning notes
                </h2>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                  {flight.dispatcherNotes}
                </p>
              </div>
            ) : null}
          </Card>

          {detail.data.release ? (
            <Card className="overflow-hidden">
              <CardHeader
                title="Current dispatch release"
                description="Review the complete, immutable release revision before flight."
                action={<ClipboardCheckIcon />}
              />
              <DispatchReleaseSnapshot release={detail.data.release} />
            </Card>
          ) : (
            <div className="border border-slate-300 bg-white p-5 text-sm text-slate-600">
              No dispatch release has been published. The flight cannot be
              started from the portal until dispatch schedules it.
            </div>
          )}

          {detail.data.events.length ? (
            <Card className="overflow-hidden">
              <CardHeader
                title="Tracked progress"
                description="Events show whether flight progress came from Hoppie, the pilot portal, or dispatcher fallback."
              />
              <ol className="grid gap-px bg-slate-200 sm:grid-cols-2">
                {detail.data.events.slice(0, 8).map((event) => (
                  <li key={event.id} className="bg-white p-4 text-sm">
                    <p className="font-black uppercase tracking-wide text-slate-900">
                      {event.kind.replaceAll("_", " ")}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {event.source.replaceAll("_", " ")} ·{" "}
                      {formatUtc(event.occurredAt)}
                    </p>
                  </li>
                ))}
              </ol>
            </Card>
          ) : null}
        </div>

        <Card className="h-fit overflow-hidden xl:sticky xl:top-22">
          <CardHeader
            title="Flight actions"
            description="Hoppie progress may update the same state automatically; these controls remain the reliable web fallback."
            action={
              <RadioTower aria-hidden className="size-5 text-slate-500" />
            }
          />
          <div className="space-y-3 p-5">
            {flight.status === "offered" ? (
              <>
                <Button
                  className="w-full"
                  disabled={busy}
                  onClick={() => void act("accept").catch(() => undefined)}
                >
                  <Check aria-hidden className="size-4" /> Accept flight
                </Button>
                <ReasonAction
                  trigger={
                    <Button variant="secondary" className="w-full text-red-700">
                      <X aria-hidden className="size-4" /> Decline flight
                    </Button>
                  }
                  title="Decline this flight?"
                  detail="Dispatch will see the decision immediately. Add an operational reason if useful."
                  confirmLabel="Decline flight"
                  danger
                  onConfirm={(reason) => act("decline", reason)}
                />
              </>
            ) : null}
            {flight.assignmentConfirmationRequired ? (
              <Button
                className="w-full"
                disabled={busy}
                onClick={() => confirm.mutate()}
              >
                <CheckCheck aria-hidden className="size-4" /> Confirm revision{" "}
                {flight.assignmentRevision}
              </Button>
            ) : null}
            {flight.status === "briefed" ? (
              <Button
                className="w-full"
                disabled={busy}
                onClick={() => progress.mutate("start")}
              >
                <PlaneTakeoff aria-hidden className="size-4" /> Start flight
              </Button>
            ) : null}
            {flight.status === "active" ? (
              <Button
                className="w-full"
                disabled={busy}
                onClick={() => progress.mutate("finish")}
              >
                <CheckCheck aria-hidden className="size-4" /> Finish flight
              </Button>
            ) : null}
            {mayCancel ? (
              <ReasonAction
                trigger={
                  <Button variant="ghost" className="w-full text-red-700">
                    <Ban aria-hidden className="size-4" /> Cancel flight
                  </Button>
                }
                title="Cancel this flight?"
                detail="Cancellation is terminal. Add context for dispatch if useful."
                confirmLabel="Cancel flight"
                danger
                onConfirm={(reason) => act("cancel", reason)}
              />
            ) : null}
            {flight.status === "completed" ? (
              <p className="border border-emerald-300 bg-emerald-50 p-3 text-sm font-bold text-emerald-900">
                This flight is finished and read-only.
              </p>
            ) : null}
            {flight.status === "declined" || flight.status === "cancelled" ? (
              <p className="border border-slate-300 bg-slate-50 p-3 text-sm text-slate-600">
                This flight is read-only in its current state.
              </p>
            ) : null}
            {mutationError ? (
              <p
                role="alert"
                className="border border-red-300 bg-red-50 p-3 text-sm text-red-800"
              >
                {apiErrorMessage(mutationError)}
              </p>
            ) : null}
            <p className="border-t border-slate-200 pt-4 text-xs leading-5 text-slate-500">
              An exact, safely matched FLT INIT confirms the current assignment
              and returns its release summary; OUT or OFF starts the flight. A
              successful outbound Hoppie response is not a delivery or read
              receipt.
            </p>
          </div>
        </Card>
      </div>
    </>
  );
}

function AirportTime({
  label,
  icao,
  time,
  align = "left",
}: {
  label: string;
  icao: string;
  time: string;
  align?: "left" | "right";
}) {
  return (
    <div className={align === "right" ? "text-right" : undefined}>
      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
        {label}
      </p>
      <p className="mt-1 font-display text-4xl font-black sm:text-5xl">
        {icao}
      </p>
      <p className="mt-2 text-xs text-slate-300 sm:text-sm">
        {formatUtc(time)}
      </p>
    </div>
  );
}

function FlightDatum({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white p-4">
      <dt className="text-[10px] font-black uppercase tracking-wider text-slate-500">
        {label}
      </dt>
      <dd className="mt-1 text-sm font-bold text-slate-950">{value}</dd>
    </div>
  );
}

function ClipboardCheckIcon() {
  return (
    <span className="border border-emerald-300 bg-emerald-50 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-emerald-800">
      Released
    </span>
  );
}
