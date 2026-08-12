import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  flightId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
}));

vi.mock("../middleware/auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middleware/auth.js")>();
  return {
    ...actual,
    requireAuth: createMiddleware(async (c, next) => {
      const orgId = c.req.header("X-Test-Clerk-Org") ?? "org_vsas";
      c.set("auth", {
        clerkUserId: "user_dispatcher",
        tenantId:
          orgId === "org_vsas"
            ? fixture.tenantId
            : "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        membershipId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        role: "dispatcher",
        clerkOrgId: orgId,
      });
      await next();
    }),
  };
});

const findFlight = vi.hoisted(() => vi.fn());
const listFlights = vi.hoisted(() => vi.fn());

vi.mock("../db/repositories/flights.js", () => ({
  findFlight,
  listFlights,
}));
vi.mock("../db/repositories/dispatch-releases.js", () => ({
  listDispatchReleaseRevisions: vi.fn().mockResolvedValue([]),
}));
vi.mock("../db/repositories/flight-events.js", () => ({
  listFlightEvents: vi.fn().mockResolvedValue([]),
}));

import { flightRoutes } from "./flights.js";
import { errorHandler } from "../middleware/error.js";

const storedFlight = {
  id: fixture.flightId,
  tenantId: fixture.tenantId,
  scheduleRequestId: null,
  replacesFlightId: null,
  pilotMembershipId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  flightNumber: "SK101",
  depIcao: "EKCH",
  arrIcao: "ENGM",
  etd: new Date("2026-09-10T08:00:00.000Z"),
  eta: new Date("2026-09-10T09:20:00.000Z"),
  aircraftType: "A320",
  version: 1,
  status: "offered" as const,
  cancelReason: null,
  declinedReason: null,
  dispatcherNotes: null,
  assignmentRevision: 1,
  assignmentConfirmedRevision: null,
  assignmentConfirmedAt: null,
  outAt: null,
  offAt: null,
  onAt: null,
  inAt: null,
  createdAt: new Date("2026-08-12T00:00:00.000Z"),
  updatedAt: new Date("2026-08-12T00:00:00.000Z"),
};

findFlight.mockImplementation(async (tenantId: string, id: string) =>
  tenantId === storedFlight.tenantId && id === storedFlight.id
    ? storedFlight
    : null,
);
listFlights.mockImplementation(async ({ tenantId }: { tenantId: string }) => ({
  items: tenantId === storedFlight.tenantId ? [storedFlight] : [],
  nextCursor: null,
}));

const app = new Hono();
app.onError(errorHandler);
app.route("/", flightRoutes);

describe("API tenant isolation", () => {
  it("does not expose a vSAS flight through another Clerk organization", async () => {
    const ownerResponse = await app.request(`/flights/${fixture.flightId}`, {
      headers: { "X-Test-Clerk-Org": "org_vsas" },
    });
    expect(ownerResponse.status).toBe(200);
    await expect(ownerResponse.json()).resolves.toMatchObject({
      flight: { id: fixture.flightId, flightNumber: "SK101" },
    });

    const otherTenantResponse = await app.request(
      `/flights/${fixture.flightId}`,
      { headers: { "X-Test-Clerk-Org": "org_other_va" } },
    );
    expect(otherTenantResponse.status).toBe(404);
    await expect(otherTenantResponse.json()).resolves.toMatchObject({
      error: { code: "NOT_FOUND" },
    });
    expect(findFlight).toHaveBeenLastCalledWith(
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      fixture.flightId,
    );
  });

  it("scopes list results to the active Clerk organization tenant", async () => {
    const ownerResponse = await app.request("/flights?limit=25", {
      headers: { "X-Test-Clerk-Org": "org_vsas" },
    });
    const otherTenantResponse = await app.request("/flights?limit=25", {
      headers: { "X-Test-Clerk-Org": "org_other_va" },
    });

    await expect(ownerResponse.json()).resolves.toMatchObject({
      items: [{ id: fixture.flightId }],
    });
    await expect(otherTenantResponse.json()).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
  });

  it("requires and enforces the flight mutation version contract", async () => {
    const missingVersion = await app.request(
      `/flights/${fixture.flightId}/accept`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Test-Clerk-Org": "org_vsas",
        },
        body: JSON.stringify({}),
      },
    );
    expect(missingVersion.status).toBe(400);

    const staleVersion = await app.request(
      `/flights/${fixture.flightId}/accept`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Test-Clerk-Org": "org_vsas",
        },
        body: JSON.stringify({ expectedVersion: 2 }),
      },
    );
    expect(staleVersion.status).toBe(409);
    await expect(staleVersion.json()).resolves.toMatchObject({
      error: {
        code: "CONFLICT",
        details: { latest: { id: fixture.flightId, version: 1 } },
      },
    });
  });
});
