"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { AdHocFlightForm } from "@/components/ad-hoc-flight-form";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { apiErrorMessage } from "@/lib/api/http";
import {
  flightPageSchema,
  flightStatusSchema,
  membersSchema,
  type FlightStatus,
} from "@/lib/api/schemas";
import { useApi } from "@/lib/api/use-api";
import { memberLabel } from "@/lib/member";
import { formatUtc } from "@/lib/utc";

const statuses: Array<{ value: "all" | FlightStatus; label: string }> = [
  { value: "all", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "offered", label: "Offered" },
  { value: "accepted", label: "Accepted" },
  { value: "briefed", label: "Briefed" },
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "declined", label: "Declined" },
  { value: "cancelled", label: "Cancelled" },
];

export function DispatcherFlightList({ slug }: { slug: string }) {
  const api = useApi();
  const router = useRouter();
  const search = useSearchParams();
  const parsed = flightStatusSchema.safeParse(search.get("flightStatus"));
  const status: "all" | FlightStatus = parsed.success ? parsed.data : "all";
  const cursor = search.get("cursor");
  const flights = useQuery({
    queryKey: [slug, "dispatch", "flights", status, cursor],
    queryFn: () =>
      api(
        `/flights?limit=50${status === "all" ? "" : `&status=${status}`}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        { schema: flightPageSchema },
      ),
  });
  const members = useQuery({
    queryKey: [slug, "members"],
    queryFn: () => api("/members", { schema: membersSchema }),
    staleTime: Number.POSITIVE_INFINITY,
  });

  function changeStatus(next: "all" | FlightStatus) {
    const params = new URLSearchParams(search.toString());
    params.set("view", "flights");
    if (next === "all") params.delete("flightStatus");
    else params.set("flightStatus", next);
    params.delete("cursor");
    router.replace(`/${slug}/dispatch?${params.toString()}`);
  }

  if (flights.isPending || members.isPending)
    return <LoadingState label="Loading flight workspace" />;
  if (flights.isError || members.isError)
    return (
      <ErrorState
        message={apiErrorMessage(flights.error ?? members.error)}
        onRetry={() => void Promise.all([flights.refetch(), members.refetch()])}
      />
    );
  const memberMap = new Map(
    members.data.items.map((member) => [member.id, member]),
  );
  const nextCursor = flights.data.nextCursor;

  return (
    <>
      <details className="mb-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <summary className="flex min-h-14 cursor-pointer list-none items-center gap-2 px-5 font-bold text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--accent)]">
          <Plus aria-hidden className="size-5 text-[var(--accent)]" /> Create
          ad-hoc flight
        </summary>
        <div className="border-t border-slate-100">
          <AdHocFlightForm slug={slug} members={members.data.items} />
        </div>
      </details>
      <div
        role="tablist"
        aria-label="Flight status"
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
        <CardHeader
          title="Flights"
          description="Open a flight to edit details or advance its explicit operational state."
        />
        {flights.data.items.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-5 py-3">Flight</th>
                  <th className="px-5 py-3">Route</th>
                  <th className="px-5 py-3">ETD Z</th>
                  <th className="px-5 py-3">Pilot</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {flights.data.items.map((flight) => (
                  <tr key={flight.id} className="hover:bg-slate-50">
                    <td className="px-5 py-4 font-bold text-slate-950">
                      {flight.flightNumber}
                      <span className="block text-xs font-normal text-slate-500">
                        {flight.aircraftType || "TBA"}
                      </span>
                    </td>
                    <td className="px-5 py-4 font-semibold">
                      {flight.depIcao} → {flight.arrIcao}
                    </td>
                    <td className="px-5 py-4 text-slate-600">
                      {formatUtc(flight.etd)}
                    </td>
                    <td className="max-w-52 truncate px-5 py-4 text-slate-600">
                      {memberLabel(
                        flight.pilotMembershipId
                          ? memberMap.get(flight.pilotMembershipId)
                          : undefined,
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <StatusBadge status={flight.status} />
                    </td>
                    <td className="px-5 py-4 text-right">
                      <Link
                        href={`/${slug}/dispatch/flights/${flight.id}`}
                        aria-label={`Open ${flight.flightNumber}`}
                        className="inline-flex size-10 items-center justify-center rounded-lg hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                      >
                        <ChevronRight aria-hidden className="size-5" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No matching flights"
            detail="Change the status filter or create an ad-hoc flight."
          />
        )}
      </Card>
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
