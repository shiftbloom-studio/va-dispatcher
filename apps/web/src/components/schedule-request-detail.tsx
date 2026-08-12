"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { ArrowLeft, Ban, CalendarDays, Pencil } from "lucide-react";
import Link from "next/link";

import { FlightCard } from "@/components/flight-card";
import { PageHeading } from "@/components/page-heading";
import {
  ScheduleCancellationAction,
  type LinkedFlightCancellationAction,
} from "@/components/schedule-cancellation-action";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { ApiError, apiErrorMessage } from "@/lib/api/http";
import {
  flightPageSchema,
  scheduleRequestDetailResponseSchema,
  scheduleRequestResponseSchema,
} from "@/lib/api/schemas";
import { jsonBody, useApi } from "@/lib/api/use-api";
import { canCancelScheduleRequest } from "@/lib/status";
import { availabilityFromPreferences, formatUtc } from "@/lib/utc";

export function ScheduleRequestDetail({
  slug,
  requestId,
}: {
  slug: string;
  requestId: string;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const request = useQuery({
    queryKey: [slug, "schedule-request", requestId],
    queryFn: () =>
      api(`/schedule-requests/${requestId}`, {
        schema: scheduleRequestDetailResponseSchema,
      }),
  });
  const flights = useInfiniteQuery({
    queryKey: [slug, "schedule-request", requestId, "flights"],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api(
        `/flights?scheduleRequestId=${encodeURIComponent(requestId)}&limit=50${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`,
        { schema: flightPageSchema },
      ),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
  const cancel = useMutation({
    mutationFn: ({
      linkedFlightAction,
      reason,
    }: {
      linkedFlightAction: LinkedFlightCancellationAction;
      reason: string;
    }) =>
      api(`/schedule-requests/${requestId}/cancel`, {
        method: "POST",
        schema: scheduleRequestResponseSchema,
        ...jsonBody({
          expectedVersion: request.data?.request.version,
          linkedFlightAction,
          reason: reason || undefined,
        }),
      }),
    onSuccess: async () => {
      await Promise.all([
        request.refetch(),
        flights.refetch(),
        queryClient.invalidateQueries({
          queryKey: [slug, "pilot", "schedule-requests"],
        }),
        queryClient.invalidateQueries({
          queryKey: [slug, "pilot", "flights"],
        }),
        queryClient.invalidateQueries({
          queryKey: [slug, "dispatch", "board"],
        }),
      ]);
    },
    onError: async (error) => {
      if (error instanceof ApiError && error.status === 409) {
        await Promise.all([request.refetch(), flights.refetch()]);
      }
    },
  });

  if (request.isPending || flights.isPending)
    return <LoadingState label="Loading schedule request" />;
  if (request.isError || flights.isError) {
    return (
      <ErrorState
        message={apiErrorMessage(request.error ?? flights.error)}
        onRetry={() => void Promise.all([request.refetch(), flights.refetch()])}
      />
    );
  }

  const scheduleRequest = request.data.request;
  const fulfillment = request.data.fulfillment;
  const linkedFlights = flights.data.pages.flatMap((page) => page.items);
  const availability = availabilityFromPreferences(scheduleRequest.preferences);

  return (
    <>
      <Link
        href={`/${slug}/portal`}
        className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-950"
      >
        <ArrowLeft aria-hidden className="size-4" /> Back to portal
      </Link>
      <PageHeading
        eyebrow="Schedule request"
        title={
          scheduleRequest.title ||
          `${scheduleRequest.desiredFlightCount}-flight request`
        }
        description={`Submitted ${formatUtc(scheduleRequest.createdAt)} · ${scheduleRequest.desiredFlightCount} flight${scheduleRequest.desiredFlightCount === 1 ? "" : "s"} requested`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {scheduleRequest.status === "pending" ? (
              <Link
                href={`/${slug}/portal/schedule-requests/${requestId}/edit`}
              >
                <Button variant="secondary" size="sm">
                  <Pencil aria-hidden className="size-4" /> Edit request
                </Button>
              </Link>
            ) : null}
            <StatusBadge status={scheduleRequest.status} />
          </div>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Card className="overflow-hidden">
          <CardHeader
            title="Proposed flights"
            description="Canonical flight records linked to this request."
          />
          <div className="grid gap-3 p-4 md:grid-cols-2">
            {linkedFlights.length ? (
              linkedFlights.map((flight) => (
                <FlightCard
                  key={flight.id}
                  flight={flight}
                  href={`/${slug}/portal/flights/${flight.id}`}
                />
              ))
            ) : (
              <div className="md:col-span-2">
                <EmptyState
                  title="No flights proposed yet"
                  detail="Dispatch is still preparing this request. New offers appear automatically on your portal dashboard."
                />
              </div>
            )}
          </div>
          {flights.hasNextPage ? (
            <div className="border-t border-slate-100 p-4 text-center">
              <Button
                variant="secondary"
                disabled={flights.isFetchingNextPage}
                onClick={() => void flights.fetchNextPage()}
              >
                {flights.isFetchingNextPage
                  ? "Loading history…"
                  : "Load more linked flights"}
              </Button>
            </div>
          ) : null}
        </Card>

        <div className="space-y-6">
          <Card className="p-5">
            <h2 className="font-display text-lg font-semibold">
              Fulfillment progress
            </h2>
            <p className="mt-2 text-sm text-slate-700">
              {fulfillment.linkedFlightCount} of{" "}
              {scheduleRequest.desiredFlightCount} requested flight
              {scheduleRequest.desiredFlightCount === 1 ? "" : "s"} linked.
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {fulfillment.remainingFlightCount} remaining.
            </p>
          </Card>
          <Card className="overflow-hidden">
            <CardHeader title="Availability" />
            <div className="space-y-3 p-5">
              {(availability.length
                ? availability
                : [
                    {
                      startAt: scheduleRequest.windowStart,
                      endAt: scheduleRequest.windowEnd,
                    },
                  ]
              ).map((interval, index) => (
                <div
                  key={`${interval.startAt}-${index}`}
                  className="flex gap-3 rounded-[2px] bg-slate-50 p-3"
                >
                  <CalendarDays
                    aria-hidden
                    className="mt-0.5 size-5 shrink-0 text-[var(--accent)]"
                  />
                  <div>
                    <p className="text-sm font-semibold text-slate-950">
                      Interval {index + 1}
                    </p>
                    <p className="mt-1 text-sm text-slate-600">
                      {formatUtc(interval.startAt)}
                      <br />
                      to {formatUtc(interval.endAt)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </Card>
          {scheduleRequest.notes ? (
            <Card className="p-5">
              <h2 className="font-display text-lg font-semibold">
                Pilot notes
              </h2>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                {scheduleRequest.notes}
              </p>
            </Card>
          ) : null}
          {scheduleRequest.rejectReason ? (
            <div
              role="status"
              className="rounded-[2px] border border-red-200 bg-red-50 p-4 text-sm text-red-900"
            >
              <strong>Dispatch response:</strong> {scheduleRequest.rejectReason}
            </div>
          ) : null}
          {scheduleRequest.cancelReason ? (
            <div
              role="status"
              className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-800"
            >
              <strong>Cancellation reason:</strong>{" "}
              {scheduleRequest.cancelReason}
            </div>
          ) : null}
          {canCancelScheduleRequest(scheduleRequest.status) ? (
            <ScheduleCancellationAction
              trigger={
                <Button variant="secondary" className="w-full text-red-700">
                  <Ban aria-hidden className="size-4" /> Cancel request
                </Button>
              }
              onConfirm={async (linkedFlightAction, reason) => {
                await cancel.mutateAsync({ linkedFlightAction, reason });
              }}
            />
          ) : null}
        </div>
      </div>
    </>
  );
}
