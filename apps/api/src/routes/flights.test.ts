import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  dispatcherMembershipId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  pilotMembershipId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  requestId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
}));

vi.mock("../middleware/auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middleware/auth.js")>();
  return {
    ...actual,
    requireAuth: createMiddleware(async (c, next) => {
      c.set("auth", {
        clerkUserId: "user_dispatcher",
        tenantId: fixture.tenantId,
        membershipId: fixture.dispatcherMembershipId,
        role: "dispatcher",
        clerkOrgId: "org_vsas",
      });
      await next();
    }),
  };
});

const flightService = vi.hoisted(() => ({
  createFlight: vi.fn(),
  bulkCreateFlights: vi.fn(),
  listFlightsForActor: vi.fn(),
  getFlight: vi.fn(),
  transitionFlight: vi.fn(),
  patchFlight: vi.fn(),
  reofferDeclinedFlight: vi.fn(),
}));
vi.mock("../domain/flights/service.js", () => flightService);

import { errorHandler } from "../middleware/error.js";
import { flightRoutes } from "./flights.js";

const app = new Hono();
app.onError(errorHandler);
app.route("/", flightRoutes);

const validAdHocFlight = {
  pilotMembershipId: fixture.pilotMembershipId,
  flightNumber: "SK101",
  depIcao: "EKCH",
  arrIcao: "ENGM",
  etd: "2026-09-10T08:30:00.000Z",
  eta: "2026-09-10T10:00:00.000Z",
  status: "offered",
};

describe("flight HTTP creation contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects schedule-linked fields on the ad-hoc create endpoint", async () => {
    const response = await app.request("/flights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...validAdHocFlight,
        scheduleRequestId: fixture.requestId,
      }),
    });

    expect(response.status).toBe(400);
    expect(flightService.createFlight).not.toHaveBeenCalled();
  });
});
