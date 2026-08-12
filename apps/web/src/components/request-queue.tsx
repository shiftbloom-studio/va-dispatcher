"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, SearchCheck } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { apiErrorMessage } from "@/lib/api/http";
import {
  membersSchema,
  scheduleRequestPageSchema,
  scheduleRequestResponseSchema,
  scheduleRequestStatusSchema,
  type ScheduleRequestStatus,
} from "@/lib/api/schemas";
import { useApi } from "@/lib/api/use-api";
import { memberLabel } from "@/lib/member";
import { formatUtc } from "@/lib/utc";

const statuses: Array<{ value: ScheduleRequestStatus; label: string }> = [
  { value: "pending", label: "Pending" },
  { value: "in_review", label: "In review" },
  { value: "fulfilled", label: "Fulfilled" },
  { value: "rejected", label: "Rejected" },
  { value: "cancelled", label: "Cancelled" },
  { value: "partially_fulfilled", label: "Historical partial" },
];

export function RequestQueue({ slug }: { slug: string }) {
  const api = useApi();
  const router = useRouter();
  const search = useSearchParams();
  const parsedStatus = scheduleRequestStatusSchema.safeParse(
    search.get("status"),
  );
  const status = parsedStatus.success ? parsedStatus.data : "pending";
  const cursor = search.get("cursor");
  const queryClient = useQueryClient();
  const requests = useQuery({
    queryKey: [slug, "dispatch", "requests", status, cursor],
    queryFn: () =>
      api(
        `/schedule-requests?status=${status}&limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        { schema: scheduleRequestPageSchema },
      ),
  });
  const members = useQuery({
    queryKey: [slug, "members"],
    queryFn: () => api("/members", { schema: membersSchema }),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const review = useMutation({
    mutationFn: (id: string) =>
      api(`/schedule-requests/${id}/review`, {
        method: "POST",
        schema: scheduleRequestResponseSchema,
      }),
    onSuccess: async () =>
      queryClient.invalidateQueries({
        queryKey: [slug, "dispatch", "requests"],
      }),
  });

  function changeStatus(next: ScheduleRequestStatus) {
    const params = new URLSearchParams(search.toString());
    params.set("view", "requests");
    params.set("status", next);
    params.delete("cursor");
    router.replace(`/${slug}/dispatch?${params.toString()}`);
  }

  if (requests.isPending || members.isPending)
    return <LoadingState label="Loading request queue" />;
  if (requests.isError || members.isError)
    return (
      <ErrorState
        message={apiErrorMessage(requests.error ?? members.error)}
        onRetry={() =>
          void Promise.all([requests.refetch(), members.refetch()])
        }
      />
    );
  const memberMap = new Map(
    members.data.items.map((member) => [member.id, member]),
  );
  const nextCursor = requests.data.nextCursor;

  return (
    <>
      <div
        role="tablist"
        aria-label="Request status"
        className="mb-5 flex gap-2 overflow-x-auto pb-2"
      >
        {statuses.map((tab) => (
          <button
            key={tab.value}
            role="tab"
            aria-selected={status === tab.value}
            onClick={() => changeStatus(tab.value)}
            className={`min-h-11 shrink-0 rounded-lg px-4 text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${status === tab.value ? "bg-slate-950 text-white" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <Card className="overflow-hidden">
        {requests.data.items.length ? (
          <div className="divide-y divide-slate-100">
            {requests.data.items.map((request) => (
              <div
                key={request.id}
                className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-display text-lg font-semibold text-slate-950">
                      {request.title ||
                        `${request.desiredFlightCount}-flight request`}
                    </h2>
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700">
                      {request.desiredFlightCount} flights
                    </span>
                  </div>
                  <p className="mt-1 text-sm font-medium text-slate-700">
                    {memberLabel(memberMap.get(request.pilotMembershipId))}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    {formatUtc(request.windowStart)} –{" "}
                    {formatUtc(request.windowEnd)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {request.status === "pending" ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={review.isPending}
                      onClick={() => review.mutate(request.id)}
                    >
                      <SearchCheck aria-hidden className="size-4" /> Start
                      review
                    </Button>
                  ) : null}
                  <Link href={`/${slug}/dispatch/requests/${request.id}`}>
                    <Button size="sm">
                      Open request{" "}
                      <ChevronRight aria-hidden className="size-4" />
                    </Button>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            title={`No ${statuses.find((tab) => tab.value === status)?.label.toLowerCase()} requests`}
            detail="There are no requests in this queue right now."
          />
        )}
      </Card>
      {review.isError ? (
        <p
          role="alert"
          className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800"
        >
          {apiErrorMessage(review.error)}
        </p>
      ) : null}
      {nextCursor ? (
        <div className="mt-4 flex justify-end">
          <Button
            variant="secondary"
            onClick={() => {
              const params = new URLSearchParams(search.toString());
              params.set("cursor", nextCursor);
              router.push(`/${slug}/dispatch?${params.toString()}`);
            }}
          >
            Next page
          </Button>
        </div>
      ) : null}
    </>
  );
}
