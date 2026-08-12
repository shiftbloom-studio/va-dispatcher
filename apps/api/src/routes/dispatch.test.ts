import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDispatchBoard: vi.fn(),
  countScheduleRequestsByStatus: vi.fn(),
  listAcarsMessages: vi.fn(),
}));

vi.mock("../middleware/auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middleware/auth.js")>();
  return {
    ...actual,
    requireAuth: createMiddleware(async (c, next) => {
      c.set("auth", {
        clerkUserId: "user_test",
        tenantId: "20000000-0000-4000-8000-000000000001",
        membershipId: "10000000-0000-4000-8000-000000000001",
        role: c.req.header("X-Test-Role") ?? "dispatcher",
        clerkOrgId: "org_test",
      });
      await next();
    }),
  };
});
vi.mock("../domain/flights/service.js", () => ({
  getDispatchBoard: mocks.getDispatchBoard,
}));
vi.mock("../db/repositories/schedule-requests.js", () => ({
  countScheduleRequestsByStatus: mocks.countScheduleRequestsByStatus,
}));
vi.mock("../db/repositories/acars.js", () => ({
  listAcarsMessages: mocks.listAcarsMessages,
}));

import { errorHandler } from "../middleware/error.js";
import { dispatchRoutes } from "./dispatch.js";

const generatedAt = new Date("2026-08-12T12:00:00.000Z");
const flight = {
  id: "30000000-0000-4000-8000-000000000001",
  flightNumber: "SK101",
  depIcao: "EKCH",
  arrIcao: "ENGM",
  etd: new Date("2026-08-12T11:30:00.000Z"),
  eta: new Date("2026-08-12T12:50:00.000Z"),
  status: "accepted",
  pilotMembershipId: "10000000-0000-4000-8000-000000000002",
  aircraftType: "A320",
  dispatcherNotes: "Confirm stand before release.",
  assignmentRevision: 2,
  assignmentConfirmedRevision: 1,
  assignmentConfirmedAt: new Date("2026-08-12T10:00:00.000Z"),
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

const app = new Hono();
app.onError(errorHandler);
app.route("/", dispatchRoutes);

describe("dispatch board route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDispatchBoard.mockResolvedValue({
      flights: [
        {
          flight,
          lane: "overdue",
          assignmentConfirmationRequired: true,
          latestReleaseRevision: null,
        },
      ],
      window: {
        generatedAt,
        overdueFrom: new Date("2026-08-11T12:00:00.000Z"),
        upcomingTo: new Date("2026-08-19T12:00:00.000Z"),
        overdueLookbackHours: 24,
        upcomingHorizonDays: 7,
      },
      metrics,
    });
    mocks.countScheduleRequestsByStatus.mockResolvedValue({ pending: 2 });
    mocks.listAcarsMessages.mockResolvedValue({ items: [], nextCursor: null });
  });

  it("serializes the exact live window and server-classified overdue lane", async () => {
    const response = await app.request("/dispatch/board");

    expect(response.status).toBe(200);
    expect(mocks.getDispatchBoard).toHaveBeenCalledWith(
      "20000000-0000-4000-8000-000000000001",
    );
    await expect(response.json()).resolves.toEqual({
      flights: [
        {
          id: flight.id,
          flightNumber: "SK101",
          depIcao: "EKCH",
          arrIcao: "ENGM",
          etd: "2026-08-12T11:30:00.000Z",
          eta: "2026-08-12T12:50:00.000Z",
          status: "accepted",
          boardLane: "overdue",
          pilotMembershipId: flight.pilotMembershipId,
          aircraftType: "A320",
          dispatcherNotes: "Confirm stand before release.",
          assignmentRevision: 2,
          assignmentConfirmedRevision: 1,
          assignmentConfirmedAt: "2026-08-12T10:00:00.000Z",
          assignmentConfirmationRequired: true,
          latestReleaseRevision: null,
          outAt: null,
          inAt: null,
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
      scheduleRequestCounts: { pending: 2 },
    });
  });

  it("denies pilots before querying the dispatcher board", async () => {
    const response = await app.request("/dispatch/board", {
      headers: { "X-Test-Role": "pilot" },
    });

    expect(response.status).toBe(403);
    expect(mocks.getDispatchBoard).not.toHaveBeenCalled();
  });

  it("keeps the dispatcher inbox out of shared caches", async () => {
    const response = await app.request("/dispatch/inbox");

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
