"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCheck,
  ClipboardCheck,
  Info,
  MessageSquareText,
  PencilLine,
  PlaneTakeoff,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import {
  OperationsBoardSkeleton,
  SimulatorTelemetrySkeleton,
} from "@/components/operations-board-skeleton";
import { FlightPlanningDialog } from "@/components/flight-planning-workspace";
import { StatusBadge } from "@/components/ui/badge";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { apiErrorMessage } from "@/lib/api/http";
import {
  dispatchBoardSchema,
  dispatchTelemetrySchema,
  membersSchema,
  type BoardFlight,
  type Member,
} from "@/lib/api/schemas";
import { useApi } from "@/lib/api/use-api";
import { memberLabel } from "@/lib/member";

const LANES = [
  {
    lane: "overdue",
    label: "Overdue",
    description: "Past ETD; dispatch action required",
    icon: AlertTriangle,
    accent: "#b45309",
  },
  {
    lane: "accepted",
    label: "To schedule",
    description: "Accepted by pilot; release outstanding",
    icon: PencilLine,
    accent: "var(--brand-complement)",
  },
  {
    lane: "briefed",
    label: "Scheduled",
    description: "Dispatch release ready",
    icon: ClipboardCheck,
    accent: "#16834f",
  },
  {
    lane: "active",
    label: "Active",
    description: "Currently being operated",
    icon: PlaneTakeoff,
    accent: "var(--brand)",
  },
  {
    lane: "completed",
    label: "Finished",
    description: "Current UTC month",
    icon: CheckCheck,
    accent: "#64748b",
  },
] as const;

function BoardCard({
  flight,
  pilot,
  slug,
  onModify,
}: {
  flight: BoardFlight;
  pilot: Member | undefined;
  slug: string;
  onModify: () => void;
}) {
  const active = flight.status === "active";
  const pilotStation = pilot?.pilotCallsign;
  return (
    <article
      className={`board-card relative border bg-white py-3.5 pl-4 pr-3 transition-colors duration-200 ease-out hover:border-slate-400 ${
        flight.assignmentConfirmationRequired
          ? "border-amber-400 bg-amber-50/45"
          : "border-slate-200"
      }`}
      style={
        {
          "--lane-accent":
            flight.boardLane === "overdue"
              ? "#b45309"
              : flight.boardLane === "briefed"
                ? "#16834f"
                : flight.boardLane === "completed"
                  ? "#64748b"
                  : flight.boardLane === "accepted"
                    ? "var(--brand-complement)"
                    : "var(--brand)",
        } as React.CSSProperties
      }
    >
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={onModify}
          className="-ml-1 inline-flex min-h-11 items-center gap-1 border border-transparent px-1 text-[11px] font-black uppercase tracking-wide text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-950 focus-visible:outline-2 focus-visible:outline-[var(--brand-action)]"
        >
          <PencilLine aria-hidden className="size-3.5" /> Modify
        </button>
        <StatusBadge status={flight.status} />
      </div>

      {flight.assignmentConfirmationRequired ? (
        <div className="mt-2 flex gap-2 border-y border-amber-300 py-2 text-xs font-bold leading-4 text-amber-950">
          <AlertTriangle aria-hidden className="size-4 shrink-0" />
          Pilot confirmation pending · assignment R{flight.assignmentRevision}
        </div>
      ) : null}

      <Link
        href={`/${slug}/dispatch/flights/${flight.id}`}
        className="mt-3 block focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-action)]"
      >
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-600">
              {flight.flightNumber}
            </p>
            <p className="mt-0.5 font-display text-[1.4rem] font-black tracking-tight text-[#17213d]">
              {flight.depIcao}
              <span className="mx-2 text-base font-normal text-slate-400">
                —
              </span>
              {flight.arrIcao}
            </p>
          </div>
          <ArrowRight aria-hidden className="mb-1 size-4 text-slate-400" />
        </div>
      </Link>

      <div className="mt-3 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 border-t border-slate-200 pt-2 text-xs">
        <span className="font-semibold text-slate-500">ETD / ETA</span>
        <span className="text-right font-mono font-bold text-slate-900">
          {timeOnly(flight.etd)} / {timeOnly(flight.eta)}
        </span>
        <span className="font-semibold text-slate-500">Aircraft</span>
        <span className="text-right font-bold text-slate-800">
          {flight.aircraftType || "TBA"}
        </span>
        <span className="font-semibold text-slate-500">Pilot</span>
        <span className="max-w-40 truncate text-right font-bold text-slate-800">
          {memberLabel(pilot)}
        </span>
        {flight.latestReleaseRevision ? (
          <>
            <span className="font-semibold text-slate-500">Release</span>
            <span className="text-right font-bold text-emerald-800">
              R{flight.latestReleaseRevision}
            </span>
          </>
        ) : null}
      </div>

      {active ? (
        <Link
          href={`/${slug}/dispatch/acars?${new URLSearchParams({
            ...(pilotStation ? { station: pilotStation } : {}),
            flightId: flight.id,
          }).toString()}`}
          className="mt-3 flex min-h-11 items-center justify-center gap-2 border border-[var(--brand-border)] bg-[var(--brand-faint)] px-3 text-xs font-black uppercase tracking-wider text-[var(--brand-action)] transition-colors hover:bg-[var(--brand-soft)] focus-visible:outline-2 focus-visible:outline-[var(--brand-action)]"
        >
          <MessageSquareText aria-hidden className="size-4" /> Open ACARS
        </Link>
      ) : null}
    </article>
  );
}

export function OperationsBoard({ slug }: { slug: string }) {
  const api = useApi();
  const [selectedFlightId, setSelectedFlightId] = useState<string | null>(null);
  const board = useQuery({
    queryKey: [slug, "dispatch", "board"],
    queryFn: () => api("/dispatch/board", { schema: dispatchBoardSchema }),
    refetchInterval: 10_000,
  });
  const members = useQuery({
    queryKey: [slug, "members"],
    queryFn: () => api("/members", { schema: membersSchema }),
    staleTime: 60_000,
  });
  const telemetry = useQuery({
    queryKey: [slug, "dispatch", "telemetry"],
    queryFn: () =>
      api("/dispatch/telemetry", { schema: dispatchTelemetrySchema }),
    refetchInterval: 10_000,
  });

  if (board.isPending || members.isPending) {
    return <OperationsBoardSkeleton />;
  }
  if (board.isError || members.isError) {
    return (
      <ErrorState
        message={apiErrorMessage(board.error ?? members.error)}
        onRetry={() => void Promise.all([board.refetch(), members.refetch()])}
      />
    );
  }

  const memberMap = new Map(
    members.data.items.map((member) => [member.id, member]),
  );

  return (
    <>
      <KpiStrip
        metrics={board.data.metrics}
        pilotPresence={telemetry.data?.summary ?? null}
        pilotPresencePending={telemetry.isPending}
        pilotPresenceError={telemetry.isError}
      />

      <div className="mb-4 mt-7 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-black text-[#17213d]">
            Flight flow
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Accepted assignments enter here after the pilot responds. Offered
            flights remain in{" "}
            <Link
              href={`/${slug}/dispatch?view=flights`}
              className="font-bold text-[var(--brand-action)] underline decoration-[var(--brand-border)] underline-offset-2"
            >
              flight management
            </Link>
            .
          </p>
        </div>
        <button
          type="button"
          onClick={() => void board.refetch()}
          className="inline-flex min-h-11 items-center gap-2 border border-slate-300 bg-white px-3 text-xs font-black uppercase tracking-wider text-slate-700 hover:border-slate-500 focus-visible:outline-2 focus-visible:outline-[var(--brand-action)]"
        >
          <RefreshCw
            aria-hidden
            className={`size-4 ${board.isFetching ? "animate-spin" : ""}`}
          />
          Live · 10s
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
        {LANES.map((lane) => {
          const flights = sortLane(
            board.data.flights.filter(
              (flight) => flight.boardLane === lane.lane,
            ),
            lane.lane,
          );
          const Icon = lane.icon;
          return (
            <section
              key={lane.lane}
              aria-labelledby={`board-${lane.lane}`}
              className="min-w-0 border-t-2 bg-[#f2f3f2]"
              style={{ borderTopColor: lane.accent }}
            >
              <div className="flex min-h-18 items-center border-x border-b border-slate-200 bg-white px-4 py-3">
                <Icon
                  aria-hidden
                  className="mr-3 size-5"
                  style={{ color: lane.accent }}
                />
                <div className="min-w-0">
                  <h3
                    id={`board-${lane.lane}`}
                    className="font-display text-base font-black uppercase tracking-wide text-[#17213d]"
                  >
                    {lane.label}
                  </h3>
                  <p className="truncate text-[11px] text-slate-500">
                    {lane.description}
                  </p>
                </div>
                <span className="ml-auto min-w-8 border border-slate-200 bg-slate-50 px-2 py-1 text-center font-mono text-xs font-black text-slate-700">
                  {flights.length}
                </span>
              </div>
              <div className="min-h-52 space-y-2 border-x border-slate-200 p-2.5 2xl:min-h-[34rem]">
                {flights.length ? (
                  flights.map((flight) => (
                    <BoardCard
                      key={flight.id}
                      flight={flight}
                      pilot={
                        flight.pilotMembershipId
                          ? memberMap.get(flight.pilotMembershipId)
                          : undefined
                      }
                      slug={slug}
                      onModify={() => setSelectedFlightId(flight.id)}
                    />
                  ))
                ) : (
                  <div className="border border-dashed border-slate-300 bg-white/65">
                    <EmptyState
                      title={`No ${lane.label.toLowerCase()} flights`}
                      detail={
                        lane.lane === "completed"
                          ? "No flight has finished in the current UTC month."
                          : lane.lane === "overdue"
                            ? "No accepted or scheduled flight has passed ETD inside the live window."
                            : "This operational lane is clear."
                      }
                    />
                  </div>
                )}
              </div>
              <div className="border border-slate-200 bg-white px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wider text-slate-400">
                {lane.lane === "completed"
                  ? "Newest finished first"
                  : "Earliest ETD first"}
              </div>
            </section>
          );
        })}
      </div>
      {selectedFlightId ? (
        <FlightPlanningDialog
          key={selectedFlightId}
          slug={slug}
          flightId={selectedFlightId}
          members={members.data.items}
          onClose={() => setSelectedFlightId(null)}
        />
      ) : null}
      <div className="mt-4 flex flex-col gap-2 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-2">
          <PlaneTakeoff aria-hidden className="size-4" /> The board refreshes
          every 10 seconds while this tab is visible and online.
        </p>
        <p>
          Live window: {board.data.boardWindow.overdueLookbackHours} hours
          overdue through {board.data.boardWindow.upcomingHorizonDays} days
          ahead. Older records remain in{" "}
          <Link
            href={`/${slug}/dispatch?view=flights`}
            className="font-semibold text-slate-700 underline underline-offset-2"
          >
            open flight management
          </Link>
          .
        </p>
      </div>

      <section className="mt-8" aria-labelledby="live-telemetry-heading">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2
              id="live-telemetry-heading"
              className="font-display text-xl font-semibold text-slate-950"
            >
              Simulator monitoring
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Precise MSFS 2024 position and heartbeat data. Operational
              awareness only; not a real-world safety service.
            </p>
          </div>
          <Activity aria-hidden className="size-6 text-slate-500" />
        </div>
        {telemetry.isPending ? (
          <SimulatorTelemetrySkeleton />
        ) : telemetry.isError ? (
          <ErrorState
            message={apiErrorMessage(telemetry.error)}
            onRetry={() => void telemetry.refetch()}
          />
        ) : telemetry.data.items.length ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {telemetry.data.items.map((item) => {
              const boardFlight = board.data.flights.find(
                (flight) => flight.id === item.flightId,
              );
              const member = memberMap.get(item.membershipId);
              return (
                <Link
                  key={item.flightId}
                  href={`/${slug}/dispatch/flights/${item.flightId}`}
                  className="rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-300 hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-slate-950">
                      {boardFlight?.flightNumber || "Assigned flight"}
                    </p>
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                      <span
                        aria-hidden
                        className={`size-2 rounded-full ${
                          item.presence === "online"
                            ? "bg-emerald-500"
                            : item.presence === "stale"
                              ? "bg-amber-500"
                              : "bg-slate-400"
                        }`}
                      />
                      {item.presence}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">
                    {memberLabel(member)} · {item.phase.replace("_", " ")}
                  </p>
                  <p className="mt-3 font-mono text-xs text-slate-700">
                    {item.latitude.toFixed(3)}, {item.longitude.toFixed(3)} ·{" "}
                    {item.altitudeFeet.toLocaleString()} ft ·{" "}
                    {item.groundSpeedKnots} kt
                  </p>
                </Link>
              );
            })}
          </div>
        ) : (
          <EmptyState
            title="No simulator heartbeats"
            detail="Assigned pilots appear here after an authenticated MSFS 2024 client reports telemetry."
          />
        )}
      </section>
    </>
  );
}

function KpiStrip({
  metrics,
  pilotPresence,
  pilotPresencePending,
  pilotPresenceError,
}: {
  metrics: ReturnType<typeof dispatchBoardSchema.parse>["metrics"];
  pilotPresence:
    ReturnType<typeof dispatchTelemetrySchema.parse>["summary"] | null;
  pilotPresencePending: boolean;
  pilotPresenceError: boolean;
}) {
  const otp = metrics.onTimePerformance;
  const progress = metrics.scheduledVsFinished;
  return (
    <section
      aria-label="Operational KPIs"
      className="border-y border-slate-300 bg-white"
    >
      <div className="grid snap-x snap-mandatory grid-flow-col auto-cols-[85%] divide-x divide-slate-200 overflow-x-auto md:grid-flow-row md:auto-cols-auto md:grid-cols-4 md:overflow-visible">
        <Kpi
          label="Active flights"
          value={String(metrics.activeFlights.value)}
          supporting="Live current count"
          definition={metrics.activeFlights.definition}
        />
        <Kpi
          label="On-time performance"
          value={formatRatio(otp.value)}
          supporting={`${otp.onTime} on time · ${otp.tracked}/${otp.eligible} departures tracked`}
          definition={otp.definition}
          warning={otp.eligible > otp.tracked}
        />
        <Kpi
          label="Scheduled vs Finished"
          value={`${progress.finished} / ${progress.scheduled}`}
          supporting={`${formatRatio(progress.value)} finished · ${metrics.window.label}`}
          definition={progress.definition}
        />
        <Kpi
          label="Pilots online"
          value={
            pilotPresencePending || pilotPresenceError || !pilotPresence
              ? "—"
              : String(pilotPresence.onlinePilots)
          }
          supporting={
            pilotPresencePending
              ? "Checking simulator presence…"
              : pilotPresenceError || !pilotPresence
                ? "Presence unavailable"
                : `${pilotPresence.flyingPilots} airborne · ${pilotPresence.stalePilots} stale`
          }
          definition={
            pilotPresence?.definition ??
            "Distinct pilots classified from each pilot's newest trusted simulator receipt."
          }
          warning={pilotPresenceError}
        />
      </div>
    </section>
  );
}

function Kpi({
  label,
  value,
  supporting,
  definition,
  warning = false,
}: {
  label: string;
  value: string;
  supporting: string;
  definition: string;
  warning?: boolean;
}) {
  return (
    <div className="relative min-h-32 snap-start px-5 py-4 sm:px-6">
      <p className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-600">
        {label}
      </p>
      <p className="mt-1.5 font-display text-4xl font-semibold tracking-tight text-[var(--foreground)]">
        {value}
      </p>
      <p
        className={`mt-2 text-xs font-bold ${warning ? "text-amber-800" : "text-slate-500"}`}
      >
        {warning ? (
          <AlertTriangle aria-hidden className="mr-1 inline size-3.5" />
        ) : null}
        {supporting}
      </p>
      <details className="group mt-3 text-xs text-slate-500">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 font-bold hover:text-slate-900">
          <Info aria-hidden className="size-3.5" /> Definition
        </summary>
        <p className="mt-2 max-w-md leading-5">{definition}</p>
      </details>
    </div>
  );
}

function sortLane(flights: BoardFlight[], status: string): BoardFlight[] {
  return [...flights].sort((a, b) =>
    status === "completed"
      ? new Date(b.inAt ?? b.etd).getTime() -
        new Date(a.inAt ?? a.etd).getTime()
      : new Date(a.etd).getTime() - new Date(b.etd).getTime(),
  );
}

function timeOnly(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Invalid time";
  return `${new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date)}Z`;
}

function formatRatio(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}
