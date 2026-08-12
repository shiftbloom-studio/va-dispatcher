"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  CalendarClock,
  ClipboardList,
  PlaneTakeoff,
  UsersRound,
} from "lucide-react";
import Link from "next/link";

import { StatusBadge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { apiErrorMessage } from "@/lib/api/http";
import {
  dispatchBoardSchema,
  membersSchema,
  type BoardFlight,
} from "@/lib/api/schemas";
import { useApi } from "@/lib/api/use-api";
import { memberLabel } from "@/lib/member";
import { formatUtc } from "@/lib/utc";

const groups = ["offered", "accepted", "briefed", "active"] as const;

function BoardCard({
  flight,
  pilot,
  href,
}: {
  flight: BoardFlight;
  pilot: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="block rounded-xl border border-slate-200 bg-white p-4 transition hover:border-slate-300 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="font-display font-bold text-slate-950">
          {flight.flightNumber}
        </p>
        <StatusBadge status={flight.status} />
      </div>
      <div className="mt-4 flex items-center gap-2">
        <span className="text-xl font-bold">{flight.depIcao}</span>
        <ArrowRight aria-hidden className="size-4 flex-1 text-slate-400" />
        <span className="text-xl font-bold">{flight.arrIcao}</span>
      </div>
      <p className="mt-2 text-sm font-medium text-slate-700">
        {formatUtc(flight.etd, {
          month: "short",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        })}
      </p>
      <p className="mt-1 truncate text-xs text-slate-500">{pilot}</p>
    </Link>
  );
}

export function OperationsBoard({ slug }: { slug: string }) {
  const api = useApi();
  const board = useQuery({
    queryKey: [slug, "dispatch", "board"],
    queryFn: () => api("/dispatch/board", { schema: dispatchBoardSchema }),
    refetchInterval: 10_000,
  });
  const members = useQuery({
    queryKey: [slug, "members"],
    queryFn: () => api("/members", { schema: membersSchema }),
    staleTime: Number.POSITIVE_INFINITY,
  });

  if (board.isPending || members.isPending)
    return <LoadingState label="Loading operations board" />;
  if (board.isError || members.isError)
    return (
      <ErrorState
        message={apiErrorMessage(board.error ?? members.error)}
        onRetry={() => void Promise.all([board.refetch(), members.refetch()])}
      />
    );

  const memberMap = new Map(
    members.data.items.map((member) => [member.id, member]),
  );
  const counts = board.data.scheduleRequestCounts;

  return (
    <>
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Card className="flex items-center gap-4 p-4">
          <span className="grid size-11 place-items-center rounded-xl bg-amber-100 text-amber-900">
            <ClipboardList aria-hidden className="size-5" />
          </span>
          <div>
            <p className="text-2xl font-bold text-slate-950">
              {counts.pending ?? 0}
            </p>
            <p className="text-sm text-slate-600">Pending requests</p>
          </div>
        </Card>
        <Card className="flex items-center gap-4 p-4">
          <span className="grid size-11 place-items-center rounded-xl bg-sky-100 text-sky-800">
            <CalendarClock aria-hidden className="size-5" />
          </span>
          <div>
            <p className="text-2xl font-bold text-slate-950">
              {counts.in_review ?? 0}
            </p>
            <p className="text-sm text-slate-600">In review</p>
          </div>
        </Card>
        <Card className="flex items-center gap-4 p-4">
          <span className="grid size-11 place-items-center rounded-xl bg-emerald-100 text-emerald-800">
            <UsersRound aria-hidden className="size-5" />
          </span>
          <div>
            <p className="text-2xl font-bold text-slate-950">
              {
                members.data.items.filter(
                  (member) =>
                    member.role === "pilot" && member.status === "active",
                ).length
              }
            </p>
            <p className="text-sm text-slate-600">Active pilots</p>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-4">
        {groups.map((status) => {
          const flights = board.data.flights.filter(
            (flight) => flight.status === status,
          );
          return (
            <section
              key={status}
              aria-labelledby={`board-${status}`}
              className="rounded-2xl border border-slate-200 bg-slate-100/70 p-3"
            >
              <div className="mb-3 flex items-center justify-between px-1">
                <h2
                  id={`board-${status}`}
                  className="font-display text-lg font-semibold text-slate-950"
                >
                  {status.charAt(0).toUpperCase() + status.slice(1)}
                </h2>
                <span className="rounded-full bg-white px-2 py-0.5 text-xs font-bold text-slate-600">
                  {flights.length}
                </span>
              </div>
              <div className="space-y-3">
                {flights.length ? (
                  flights.map((flight) => (
                    <BoardCard
                      key={flight.id}
                      flight={flight}
                      pilot={memberLabel(
                        flight.pilotMembershipId
                          ? memberMap.get(flight.pilotMembershipId)
                          : undefined,
                      )}
                      href={`/${slug}/dispatch/flights/${flight.id}`}
                    />
                  ))
                ) : (
                  <div className="rounded-xl bg-white">
                    <EmptyState
                      title={`No ${status} flights`}
                      detail="This column is clear for the next seven days."
                    />
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>
      <p className="mt-4 flex items-center gap-2 text-xs text-slate-500">
        <PlaneTakeoff aria-hidden className="size-4" /> The board refreshes
        every 10 seconds while this tab is visible and online.
      </p>
    </>
  );
}
