"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { ArrowLeft, Ban, SearchCheck, XOctagon } from "lucide-react";
import Link from "next/link";

import { ReasonAction } from "@/components/action-dialog";
import { FlightCard } from "@/components/flight-card";
import { OfferBuilder } from "@/components/offer-builder";
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
  membersSchema,
  scheduleRequestDetailResponseSchema,
  scheduleRequestResponseSchema,
} from "@/lib/api/schemas";
import { jsonBody, useApi } from "@/lib/api/use-api";
import { memberLabel } from "@/lib/member";
import { canCancelScheduleRequest } from "@/lib/status";
import { availabilityFromPreferences, formatUtc } from "@/lib/utc";

export function DispatcherRequestDetail({
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
  const members = useQuery({
    queryKey: [slug, "members"],
    queryFn: () => api("/members", { schema: membersSchema }),
    staleTime: Number.POSITIVE_INFINITY,
  });

  async function refresh() {
    await Promise.all([request.refetch(), flights.refetch()]);
  }

  const transition = useMutation({
    mutationFn: ({
      action,
      reason,
      linkedFlightAction,
    }: {
      action: "review" | "reject" | "cancel";
      reason?: string;
      linkedFlightAction?: LinkedFlightCancellationAction;
    }) =>
      api(`/schedule-requests/${requestId}/${action}`, {
        method: "POST",
        schema: scheduleRequestResponseSchema,
        ...jsonBody({
          expectedVersion: request.data?.request.version,
          ...(action === "reject" ? { reason: reason || undefined } : {}),
          ...(action === "cancel"
            ? {
                linkedFlightAction,
                reason: reason || undefined,
              }
            : {}),
        }),
      }),
    onSuccess: async () => {
      await Promise.all([
        refresh(),
        queryClient.invalidateQueries({
          queryKey: [slug, "dispatch", "requests"],
        }),
        queryClient.invalidateQueries({
          queryKey: [slug, "dispatch", "board"],
        }),
        queryClient.invalidateQueries({
          queryKey: [slug, "dispatch", "flights"],
        }),
        queryClient.invalidateQueries({
          queryKey: [slug, "pilot"],
        }),
      ]);
    },
    onError: async (error) => {
      if (error instanceof ApiError && error.status === 409) await refresh();
    },
  });

  if (request.isPending || flights.isPending || members.isPending)
    return <LoadingState label="Loading request workspace" />;
  if (request.isError || flights.isError || members.isError)
    return (
      <ErrorState
        message={apiErrorMessage(
          request.error ?? flights.error ?? members.error,
        )}
        onRetry={() =>
          void Promise.all([
            request.refetch(),
            flights.refetch(),
            members.refetch(),
          ])
        }
      />
    );

  const scheduleRequest = request.data.request;
  const fulfillment = request.data.fulfillment;
  const linkedFlights = flights.data.pages.flatMap((page) => page.items);
  const pilot = members.data.items.find(
    (member) => member.id === scheduleRequest.pilotMembershipId,
  );
  const availability = availabilityFromPreferences(scheduleRequest.preferences);
  const canBuild =
    (scheduleRequest.status === "in_review" ||
      scheduleRequest.status === "partially_fulfilled") &&
    fulfillment.remainingFlightCount > 0;

  return (
    <>
      <Link
        href={`/${slug}/dispatch?view=requests&status=${scheduleRequest.status}`}
        className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-950"
      >
        <ArrowLeft aria-hidden className="size-4" /> Back to queue
      </Link>
      <PageHeading
        eyebrow="Dispatcher request"
        title={
          scheduleRequest.title ||
          `${scheduleRequest.desiredFlightCount}-flight request`
        }
        description={`${memberLabel(pilot)} · submitted ${formatUtc(scheduleRequest.createdAt)}`}
        action={<StatusBadge status={scheduleRequest.status} />}
      />

      <div className="mb-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card className="p-5">
          <h2 className="font-display text-lg font-semibold">
            Pilot requirements
          </h2>
          <dl className="mt-4 grid gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Flight count
              </dt>
              <dd className="mt-1 text-lg font-bold text-slate-950">
                {fulfillment.linkedFlightCount} /{" "}
                {scheduleRequest.desiredFlightCount}
              </dd>
              <p className="mt-1 text-xs text-slate-500">
                {fulfillment.remainingFlightCount} remaining
              </p>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Overall UTC window
              </dt>
              <dd className="mt-1 font-semibold text-slate-950">
                {formatUtc(scheduleRequest.windowStart)} –{" "}
                {formatUtc(scheduleRequest.windowEnd)}
              </dd>
            </div>
          </dl>
          <div className="mt-5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Detailed availability
            </h3>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
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
                  className="rounded-[2px] bg-slate-50 p-3 text-sm text-slate-700"
                >
                  <strong>Slot {index + 1}:</strong>
                  <br />
                  {formatUtc(interval.startAt)} – {formatUtc(interval.endAt)}
                </div>
              ))}
            </div>
          </div>
          {scheduleRequest.notes ? (
            <div className="mt-5 border-t border-slate-100 pt-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Notes
              </h3>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                {scheduleRequest.notes}
              </p>
            </div>
          ) : null}
          {scheduleRequest.rejectReason || scheduleRequest.cancelReason ? (
            <div className="mt-5 border-t border-slate-100 pt-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Terminal reason
              </h3>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                {scheduleRequest.rejectReason ?? scheduleRequest.cancelReason}
              </p>
            </div>
          ) : null}
        </Card>
        <Card className="h-fit overflow-hidden">
          <CardHeader title="Request actions" />
          <div className="space-y-3 p-5">
            {scheduleRequest.status === "pending" ? (
              <Button
                className="w-full"
                disabled={transition.isPending}
                onClick={() => transition.mutate({ action: "review" })}
              >
                <SearchCheck aria-hidden className="size-4" /> Start review
              </Button>
            ) : null}
            {scheduleRequest.status === "pending" ||
            scheduleRequest.status === "in_review" ? (
              <ReasonAction
                trigger={
                  <Button variant="secondary" className="w-full text-red-700">
                    <XOctagon aria-hidden className="size-4" /> Reject request
                  </Button>
                }
                title="Reject this request?"
                detail="The pilot will see this as a terminal decision. Add an optional explanation."
                confirmLabel="Reject request"
                danger
                onConfirm={async (reason) => {
                  await transition.mutateAsync({ action: "reject", reason });
                }}
              />
            ) : null}
            {canCancelScheduleRequest(scheduleRequest.status) ? (
              <ScheduleCancellationAction
                trigger={
                  <Button variant="secondary" className="w-full text-red-700">
                    <Ban aria-hidden className="size-4" /> Cancel request
                  </Button>
                }
                onConfirm={async (linkedFlightAction, reason) => {
                  await transition.mutateAsync({
                    action: "cancel",
                    linkedFlightAction,
                    reason,
                  });
                }}
              />
            ) : null}
            {!canBuild &&
            !canCancelScheduleRequest(scheduleRequest.status) &&
            scheduleRequest.status !== "pending" ? (
              <p className="rounded-[2px] bg-slate-50 p-3 text-sm text-slate-600">
                This request is read-only in its current state.
              </p>
            ) : null}
          </div>
        </Card>
      </div>

      {canBuild ? (
        <OfferBuilder
          key={`${scheduleRequest.version}:${fulfillment.remainingFlightCount}`}
          slug={slug}
          requestId={requestId}
          desiredFlightCount={scheduleRequest.desiredFlightCount}
          flightCount={fulfillment.remainingFlightCount}
          expectedRequestVersion={scheduleRequest.version}
          onOffered={refresh}
        />
      ) : null}
      {scheduleRequest.status === "partially_fulfilled" ? (
        <p
          role="status"
          className="mb-6 rounded-[2px] border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
        >
          {fulfillment.remainingFlightCount > 0
            ? `${fulfillment.linkedFlightCount} of ${scheduleRequest.desiredFlightCount} flights are linked. Build the ${fulfillment.remainingFlightCount} remaining offer${fulfillment.remainingFlightCount === 1 ? "" : "s"} above.`
            : "The requested flight count is fully allocated; no further offers can be appended."}
        </p>
      ) : null}

      <Card className={`${canBuild ? "mt-6" : ""} overflow-hidden`}>
        <CardHeader
          title="Linked flights"
          description="Canonical serialized flight records; the embedded raw request payload is intentionally ignored."
        />
        <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
          {linkedFlights.length ? (
            linkedFlights.map((flight) => (
              <FlightCard
                key={flight.id}
                flight={flight}
                href={`/${slug}/dispatch/flights/${flight.id}`}
              />
            ))
          ) : (
            <div className="md:col-span-2 xl:col-span-3">
              <EmptyState
                title="No linked flights"
                detail="Build the complete offer above when the request is ready."
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
    </>
  );
}
