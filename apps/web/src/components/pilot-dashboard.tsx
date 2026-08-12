"use client";

import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import Link from "next/link";

import { FlightCard } from "@/components/flight-card";
import { PageHeading } from "@/components/page-heading";
import { ScheduleRequestCard } from "@/components/schedule-request-card";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { apiErrorMessage } from "@/lib/api/http";
import { flightPageSchema, scheduleRequestPageSchema } from "@/lib/api/schemas";
import { useApi } from "@/lib/api/use-api";

const activeRequestStatuses = new Set([
  "pending",
  "in_review",
  "partially_fulfilled",
]);
const terminalFlightStatuses = new Set(["completed", "cancelled", "declined"]);

export function PilotDashboard({ slug }: { slug: string }) {
  const api = useApi();
  const requests = useQuery({
    queryKey: [slug, "pilot", "schedule-requests"],
    queryFn: () =>
      api("/schedule-requests?limit=50", { schema: scheduleRequestPageSchema }),
    refetchInterval: 30_000,
  });
  const flights = useQuery({
    queryKey: [slug, "pilot", "flights"],
    queryFn: () => api("/flights?limit=100", { schema: flightPageSchema }),
    refetchInterval: 30_000,
  });

  if (requests.isPending || flights.isPending)
    return <LoadingState label="Loading your schedule" />;
  if (requests.isError || flights.isError) {
    const error = requests.error ?? flights.error;
    return (
      <ErrorState
        message={apiErrorMessage(error)}
        onRetry={() =>
          void Promise.all([requests.refetch(), flights.refetch()])
        }
      />
    );
  }

  const offered = flights.data.items.filter(
    (flight) => flight.status === "offered",
  );
  const upcoming = flights.data.items.filter((flight) =>
    ["accepted", "briefed"].includes(flight.status),
  );
  const activeRequests = requests.data.items.filter((request) =>
    activeRequestStatuses.has(request.status),
  );
  const recentTerminalFlights = flights.data.items
    .filter((flight) => terminalFlightStatuses.has(flight.status))
    .slice(0, 4);
  const recentTerminalRequests = requests.data.items
    .filter((request) => !activeRequestStatuses.has(request.status))
    .slice(0, 4);

  return (
    <>
      <PageHeading
        eyebrow="Pilot portal"
        title="Your operation"
        description="Review flight offers, manage your upcoming sectors, and request a schedule around your UTC availability."
        action={
          <Link href={`/${slug}/portal/schedule-requests/new`}>
            <Button>
              <Plus aria-hidden className="size-4" /> Request schedule
            </Button>
          </Link>
        }
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader
            title="Flight offers"
            description="These flights need your decision."
          />
          <div className="grid gap-3 p-4 sm:grid-cols-2">
            {offered.length ? (
              offered.map((flight) => (
                <FlightCard
                  key={flight.id}
                  flight={flight}
                  href={`/${slug}/portal/flights/${flight.id}`}
                />
              ))
            ) : (
              <div className="sm:col-span-2">
                <EmptyState
                  title="No offers waiting"
                  detail="New offers appear here automatically while this page is open."
                />
              </div>
            )}
          </div>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader
            title="Upcoming flights"
            description="Accepted and scheduled sectors."
          />
          <div className="grid gap-3 p-4 sm:grid-cols-2">
            {upcoming.length ? (
              upcoming.map((flight) => (
                <FlightCard
                  key={flight.id}
                  flight={flight}
                  href={`/${slug}/portal/flights/${flight.id}`}
                />
              ))
            ) : (
              <div className="sm:col-span-2">
                <EmptyState
                  title="No upcoming flights"
                  detail="Accepted offers and dispatcher briefings will appear here."
                />
              </div>
            )}
          </div>
        </Card>
      </div>

      <Card className="mt-6 overflow-hidden">
        <CardHeader
          title="Active schedule requests"
          description="Requests still being handled by dispatch."
        />
        <div className="grid gap-3 p-4 lg:grid-cols-2">
          {activeRequests.length ? (
            activeRequests.map((request) => (
              <ScheduleRequestCard
                key={request.id}
                request={request}
                href={`/${slug}/portal/schedule-requests/${request.id}`}
              />
            ))
          ) : (
            <div className="lg:col-span-2">
              <EmptyState
                title="No active requests"
                detail="Create a schedule request when you are ready to plan your next flights."
              />
            </div>
          )}
        </div>
      </Card>

      <section className="mt-8" aria-labelledby="recent-heading">
        <h2
          id="recent-heading"
          className="font-display text-xl font-semibold text-slate-950"
        >
          Recent history
        </h2>
        <div className="mt-3 grid gap-6 xl:grid-cols-2">
          <Card className="p-4">
            <h3 className="mb-3 text-sm font-bold uppercase tracking-wider text-slate-500">
              Flights
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {recentTerminalFlights.length ? (
                recentTerminalFlights.map((flight) => (
                  <FlightCard
                    key={flight.id}
                    flight={flight}
                    href={`/${slug}/portal/flights/${flight.id}`}
                  />
                ))
              ) : (
                <p className="py-6 text-center text-sm text-slate-500 sm:col-span-2">
                  No terminal flights yet.
                </p>
              )}
            </div>
          </Card>
          <Card className="p-4">
            <h3 className="mb-3 text-sm font-bold uppercase tracking-wider text-slate-500">
              Requests
            </h3>
            <div className="space-y-3">
              {recentTerminalRequests.length ? (
                recentTerminalRequests.map((request) => (
                  <ScheduleRequestCard
                    key={request.id}
                    request={request}
                    href={`/${slug}/portal/schedule-requests/${request.id}`}
                  />
                ))
              ) : (
                <p className="py-6 text-center text-sm text-slate-500">
                  No terminal requests yet.
                </p>
              )}
            </div>
          </Card>
        </div>
      </section>
      <p aria-live="polite" className="sr-only">
        {offered.length} flight offers require a response.
      </p>
    </>
  );
}
