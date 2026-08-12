"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Ban, CalendarDays } from "lucide-react";
import Link from "next/link";

import { ConfirmAction } from "@/components/action-dialog";
import { FlightCard } from "@/components/flight-card";
import { PageHeading } from "@/components/page-heading";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { apiErrorMessage } from "@/lib/api/http";
import {
  flightPageSchema,
  scheduleRequestDetailResponseSchema,
  scheduleRequestResponseSchema,
} from "@/lib/api/schemas";
import { useApi } from "@/lib/api/use-api";
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
  const flights = useQuery({
    queryKey: [slug, "schedule-request", requestId, "flights"],
    queryFn: () =>
      api(
        `/flights?scheduleRequestId=${encodeURIComponent(requestId)}&limit=50`,
        { schema: flightPageSchema },
      ),
  });
  const cancel = useMutation({
    mutationFn: () =>
      api(`/schedule-requests/${requestId}/cancel`, {
        method: "POST",
        schema: scheduleRequestResponseSchema,
      }),
    onSuccess: async () => {
      await Promise.all([
        request.refetch(),
        queryClient.invalidateQueries({
          queryKey: [slug, "pilot", "schedule-requests"],
        }),
      ]);
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

  const item = request.data.request;
  const availability = availabilityFromPreferences(item.preferences);

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
        title={item.title || `${item.desiredFlightCount}-flight request`}
        description={`Submitted ${formatUtc(item.createdAt)} · ${item.desiredFlightCount} flight${item.desiredFlightCount === 1 ? "" : "s"} requested`}
        action={<StatusBadge status={item.status} />}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Card className="overflow-hidden">
          <CardHeader
            title="Proposed flights"
            description="Canonical flight records linked to this request."
          />
          <div className="grid gap-3 p-4 md:grid-cols-2">
            {flights.data.items.length ? (
              flights.data.items.map((flight) => (
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
        </Card>

        <div className="space-y-6">
          <Card className="overflow-hidden">
            <CardHeader title="Availability" />
            <div className="space-y-3 p-5">
              {(availability.length
                ? availability
                : [{ startAt: item.windowStart, endAt: item.windowEnd }]
              ).map((interval, index) => (
                <div
                  key={`${interval.startAt}-${index}`}
                  className="flex gap-3 rounded-xl bg-slate-50 p-3"
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
          {item.notes ? (
            <Card className="p-5">
              <h2 className="font-display text-lg font-semibold">
                Pilot notes
              </h2>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                {item.notes}
              </p>
            </Card>
          ) : null}
          {item.rejectReason ? (
            <div
              role="status"
              className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900"
            >
              <strong>Dispatch response:</strong> {item.rejectReason}
            </div>
          ) : null}
          {canCancelScheduleRequest(item.status) ? (
            <ConfirmAction
              trigger={
                <Button variant="secondary" className="w-full text-red-700">
                  <Ban aria-hidden className="size-4" /> Cancel request
                </Button>
              }
              title="Cancel this schedule request?"
              detail="Dispatch will stop working on this request. Existing flight records are not changed by this action."
              confirmLabel="Cancel request"
              danger
              onConfirm={() => cancel.mutateAsync().then(() => undefined)}
            />
          ) : null}
        </div>
      </div>
    </>
  );
}
