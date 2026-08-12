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
  assignmentNeedsConfirmation: vi.fn(() => false),
}));
vi.mock("../domain/flights/service.js", () => flightService);

import { errorHandler } from "../middleware/error.js";
import { encodeCursor, encodeFlightCursor } from "../lib/pagination.js";
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
const storedFlight = {
  id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  tenantId: fixture.tenantId,
  scheduleRequestId: fixture.requestId,
  replacesFlightId: null,
  pilotMembershipId: fixture.pilotMembershipId,
  flightNumber: "SK101",
  depIcao: "EKCH",
  arrIcao: "ENGM",
  etd: new Date(validAdHocFlight.etd),
  eta: new Date(validAdHocFlight.eta),
  aircraftType: null,
  version: 1,
  status: "offered" as const,
  cancelReason: null,
  declinedReason: null,
  dispatcherNotes: null,
  outAt: null,
  offAt: null,
  onAt: null,
  inAt: null,
  createdAt: new Date("2026-08-12T00:00:00.000Z"),
  updatedAt: new Date("2026-08-12T00:00:00.000Z"),
};
const validBulkBody = {
  scheduleRequestId: fixture.requestId,
  expectedRequestVersion: 1,
  flights: [
    {
      flightNumber: "SK101",
      depIcao: "EKCH",
      arrIcao: "ENGM",
      etd: validAdHocFlight.etd,
      eta: validAdHocFlight.eta,
    },
  ],
};

describe("flight HTTP creation contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    flightService.bulkCreateFlights.mockResolvedValue({
      flights: [storedFlight],
      fulfillment: {
        scheduleRequestId: fixture.requestId,
        requestStatus: "fulfilled",
        requestVersion: 2,
        linkedFlightCount: 1,
        remainingFlightCount: 0,
        flightIds: [storedFlight.id],
      },
    });
    flightService.listFlightsForActor.mockResolvedValue({
      items: [],
      nextCursor: null,
    });
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

  it("requires a caller idempotency key before bulk fulfillment", async () => {
    const response = await app.request("/flights/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBulkBody),
    });

    expect(response.status).toBe(400);
    expect(flightService.bulkCreateFlights).not.toHaveBeenCalled();
  });

  it("passes the normalized idempotency key and returns the durable outcome", async () => {
    const response = await app.request("/flights/bulk", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "  batch-001  ",
      },
      body: JSON.stringify(validBulkBody),
    });

    expect(response.status).toBe(201);
    expect(flightService.bulkCreateFlights).toHaveBeenCalledWith(
      expect.objectContaining({ role: "dispatcher" }),
      expect.objectContaining({
        idempotencyKey: "batch-001",
        scheduleRequestId: fixture.requestId,
        expectedRequestVersion: 1,
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      flights: [{ id: storedFlight.id }],
      fulfillment: {
        requestStatus: "fulfilled",
        requestVersion: 2,
        flightIds: [storedFlight.id],
      },
    });
  });
});

describe("flight list query contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    flightService.listFlightsForActor.mockResolvedValue({
      items: [],
      nextCursor: null,
    });
  });

  it("decodes a versioned cursor and deduplicates valid status filters", async () => {
    const cursor = encodeFlightCursor({
      etd: validAdHocFlight.etd,
      id: storedFlight.id,
    });
    const query = new URLSearchParams({
      status: "offered,accepted,offered",
      cursor,
      fromEtd: "2026-09-10T08:00:00.000Z",
      toEtd: "2026-09-10T18:00:00.000Z",
      scheduleRequestId: fixture.requestId,
    });
    const response = await app.request(`/flights?${query}`);

    expect(response.status).toBe(200);
    expect(flightService.listFlightsForActor).toHaveBeenCalledWith(
      expect.objectContaining({ role: "dispatcher" }),
      expect.objectContaining({
        status: ["offered", "accepted"],
        fromEtd: new Date("2026-09-10T08:00:00.000Z"),
        toEtd: new Date("2026-09-10T18:00:00.000Z"),
        scheduleRequestId: fixture.requestId,
        cursor: {
          v: 1,
          kind: "flight-etd-desc",
          etd: validAdHocFlight.etd,
          id: storedFlight.id,
        },
      }),
    );
  });

  it.each(["", "offered,,accepted", "offered,unknown"])(
    "rejects an invalid status set (%s)",
    async (status) => {
      const response = await app.request(
        `/flights?status=${encodeURIComponent(status)}`,
      );

      expect(response.status).toBe(400);
      expect(flightService.listFlightsForActor).not.toHaveBeenCalled();
    },
  );

  it("rejects an unversioned cursor from the former creation-time contract", async () => {
    const oldCursor = encodeCursor({
      sortAt: storedFlight.createdAt.toISOString(),
      id: storedFlight.id,
    });
    const response = await app.request(
      `/flights?cursor=${encodeURIComponent(oldCursor)}`,
    );

    expect(response.status).toBe(400);
    expect(flightService.listFlightsForActor).not.toHaveBeenCalled();
  });
});
