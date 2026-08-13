import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OperationsBoard } from "@/components/operations-board";
import { TestQueryProvider } from "@/test/test-query-provider";

const apiMock = vi.fn();

vi.mock("@/lib/api/use-api", () => ({ useApi: () => apiMock }));

const pilot = {
  id: "pilot-1",
  clerkUserId: "user-pilot-1",
  role: "pilot",
  pilotCallsign: "SAS101",
  displayName: "Test Pilot",
  status: "active",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

const boardFlight = {
  id: "flight-overdue",
  flightNumber: "SK900",
  depIcao: "EKCH",
  arrIcao: "ENGM",
  etd: "2026-08-12T11:00:00.000Z",
  eta: "2026-08-12T12:20:00.000Z",
  aircraftType: "A320",
  status: "accepted",
  boardLane: "overdue",
  pilotMembershipId: pilot.id,
  dispatcherNotes: null,
  assignmentRevision: 1,
  assignmentConfirmedRevision: 1,
  assignmentConfirmedAt: "2026-08-12T10:00:00.000Z",
  assignmentConfirmationRequired: false,
  latestReleaseRevision: null,
  outAt: null,
  inAt: null,
};

const metrics = {
  window: {
    from: "2026-08-01T00:00:00.000Z",
    toExclusive: "2026-09-01T00:00:00.000Z",
    label: "Current UTC calendar month",
  },
  activeFlights: {
    value: 0,
    definition: "Flights currently in Active status.",
  },
  onTimePerformance: {
    value: null,
    onTime: 0,
    tracked: 0,
    eligible: 1,
    definition: "Actual OUT at or before ETD + 15 minutes.",
  },
  scheduledVsFinished: {
    scheduled: 1,
    finished: 0,
    value: 0,
    definition: "Finished flights divided by scheduled flights.",
  },
};

describe("dispatcher operations board", () => {
  beforeEach(() => {
    apiMock.mockReset();
    apiMock.mockImplementation((path: string) => {
      if (path === "/dispatch/board") {
        return Promise.resolve({
          flights: [
            boardFlight,
            {
              ...boardFlight,
              id: "flight-upcoming",
              flightNumber: "SK901",
              etd: "2026-08-13T11:00:00.000Z",
              boardLane: "accepted",
            },
          ],
          metrics,
          boardWindow: {
            generatedAt: "2026-08-12T12:00:00.000Z",
            overdueFrom: "2026-08-11T12:00:00.000Z",
            upcomingTo: "2026-08-19T12:00:00.000Z",
            overdueLookbackHours: 24,
            upcomingHorizonDays: 7,
          },
          scheduleRequestCounts: { pending: 1, in_review: 2 },
        });
      }
      if (path === "/members") {
        return Promise.resolve({ items: [pilot], nextCursor: null });
      }
      if (path === "/dispatch/telemetry") {
        return Promise.resolve({
          items: [
            {
              flightId: "flight-upcoming",
              membershipId: pilot.id,
              phase: "airborne",
              latitude: 55.618,
              longitude: 12.656,
              altitudeFeet: 10_000,
              groundSpeedKnots: 280,
              headingDegrees: 274,
              simulatorTime: "2026-08-12T11:59:55.000Z",
              sampleAt: "2026-08-12T11:59:55.000Z",
              sequence: 3,
              presence: "online",
            },
          ],
          summary: {
            onlinePilots: 2,
            flyingPilots: 1,
            stalePilots: 1,
            definition: "Synthetic trusted receipt summary",
          },
          generatedAt: "2026-08-12T12:00:00.000Z",
        });
      }
      throw new Error(`Unexpected API call: ${path}`);
    });
  });

  it("reserves the board and telemetry geometry while initial data loads", () => {
    apiMock.mockImplementation(() => new Promise(() => undefined));

    render(
      <TestQueryProvider>
        <OperationsBoard slug="vsas" />
      </TestQueryProvider>,
    );

    const loadingBoard = screen.getByRole("status", {
      name: "Loading live operations board",
    });
    expect(loadingBoard).toHaveClass("animate-pulse");
    expect(loadingBoard.querySelector(".animate-spin")).toBeNull();
    expect(loadingBoard.querySelectorAll(".min-h-52")).toHaveLength(5);
    expect(
      screen.getByRole("status", {
        name: "Loading live simulator telemetry",
      }),
    ).toBeInTheDocument();
  });

  it("uses true presence metrics and keeps overdue counts aligned with the visible lane", async () => {
    render(
      <TestQueryProvider>
        <OperationsBoard slug="vsas" />
      </TestQueryProvider>,
    );

    const presenceLabel = await screen.findByText("Pilots online");
    expect(presenceLabel.nextElementSibling).toHaveTextContent("2");
    expect(screen.getByText("1 airborne · 1 stale")).toBeVisible();
    expect(screen.queryByText("Active pilots")).not.toBeInTheDocument();

    const overdue = screen.getByRole("region", { name: "Overdue" });
    expect(within(overdue).getByText("1")).toBeVisible();
    expect(within(overdue).getByText("SK900")).toBeVisible();
    expect(within(overdue).queryByText("SK901")).not.toBeInTheDocument();

    const accepted = screen.getByRole("region", { name: "To schedule" });
    expect(within(accepted).getByText("SK901")).toBeVisible();
    expect(
      screen.getByText(/Live window: 24 hours overdue through 7 days ahead/),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "flight management" }),
    ).toHaveAttribute("href", "/vsas/dispatch?view=flights");
  });
});
