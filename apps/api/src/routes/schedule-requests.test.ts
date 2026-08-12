import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  pilotMembershipId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  dispatcherMembershipId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
}));

vi.mock("../middleware/auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middleware/auth.js")>();
  return {
    ...actual,
    requireAuth: createMiddleware(async (c, next) => {
      const role =
        c.req.header("X-Test-Role") === "dispatcher" ? "dispatcher" : "pilot";
      c.set("auth", {
        clerkUserId: `user_${role}`,
        tenantId: fixture.tenantId,
        membershipId:
          role === "dispatcher"
            ? fixture.dispatcherMembershipId
            : fixture.pilotMembershipId,
        role,
        clerkOrgId: "org_vsas",
      });
      await next();
    }),
  };
});

const scheduleService = vi.hoisted(() => ({
  createRequest: vi.fn(),
  listRequests: vi.fn(),
  getRequest: vi.fn(),
  editRequest: vi.fn(),
  cancelRequest: vi.fn(),
  transitionRequest: vi.fn(),
}));
vi.mock("../domain/schedule-requests/service.js", () => scheduleService);

import { errorHandler } from "../middleware/error.js";
import { scheduleRequestRoutes } from "./schedule-requests.js";

const storedRequest = {
  id: fixture.requestId,
  tenantId: fixture.tenantId,
  pilotMembershipId: fixture.pilotMembershipId,
  title: "September request",
  notes: null,
  windowStart: new Date("2026-09-10T08:00:00.000Z"),
  windowEnd: new Date("2026-09-10T12:00:00.000Z"),
  desiredFlightCount: 2,
  preferences: {
    availability: [
      {
        startAt: "2026-09-10T08:00:00.000Z",
        endAt: "2026-09-10T12:00:00.000Z",
      },
    ],
  },
  version: 3,
  status: "pending" as const,
  rejectReason: null,
  cancelReason: null,
  createdAt: new Date("2026-08-12T00:00:00.000Z"),
  updatedAt: new Date("2026-08-12T00:00:00.000Z"),
};

const app = new Hono();
app.onError(errorHandler);
app.route("/", scheduleRequestRoutes);

describe("schedule request HTTP lifecycle contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scheduleService.editRequest.mockResolvedValue({
      ...storedRequest,
      version: 4,
    });
    scheduleService.cancelRequest.mockResolvedValue({
      ...storedRequest,
      version: 4,
      status: "cancelled",
    });
    scheduleService.transitionRequest.mockResolvedValue({
      ...storedRequest,
      version: 4,
      status: "in_review",
    });
  });

  it("requires optimistic concurrency for pilot edits", async () => {
    const missingVersion = await app.request(
      `/schedule-requests/${fixture.requestId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          windowStart: storedRequest.windowStart.toISOString(),
          windowEnd: storedRequest.windowEnd.toISOString(),
          desiredFlightCount: 2,
          preferences: storedRequest.preferences,
        }),
      },
    );
    expect(missingVersion.status).toBe(400);

    const response = await app.request(
      `/schedule-requests/${fixture.requestId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedVersion: 3,
          title: "Revised request",
          windowStart: storedRequest.windowStart.toISOString(),
          windowEnd: storedRequest.windowEnd.toISOString(),
          desiredFlightCount: 2,
          preferences: storedRequest.preferences,
        }),
      },
    );
    expect(response.status).toBe(200);
    expect(scheduleService.editRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: fixture.tenantId,
        membershipId: fixture.pilotMembershipId,
        role: "pilot",
      }),
      fixture.requestId,
      3,
      expect.objectContaining({ title: "Revised request" }),
    );
  });

  it.each([
    { role: "pilot", membershipId: fixture.pilotMembershipId },
    { role: "dispatcher", membershipId: fixture.dispatcherMembershipId },
  ])(
    "passes the explicit linked-flight outcome for $role cancellation",
    async ({ role, membershipId }) => {
      const response = await app.request(
        `/schedule-requests/${fixture.requestId}/cancel`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Test-Role": role,
          },
          body: JSON.stringify({
            expectedVersion: 3,
            linkedFlightAction: "cancel_predeparture",
            reason: "Availability withdrawn",
          }),
        },
      );
      expect(response.status).toBe(200);
      expect(scheduleService.cancelRequest).toHaveBeenCalledWith(
        expect.objectContaining({ membershipId, role }),
        fixture.requestId,
        {
          expectedVersion: 3,
          linkedFlightAction: "cancel_predeparture",
          reason: "Availability withdrawn",
        },
      );
    },
  );

  it("requires the loaded version when dispatch starts review", async () => {
    const missing = await app.request(
      `/schedule-requests/${fixture.requestId}/review`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Test-Role": "dispatcher",
        },
        body: JSON.stringify({}),
      },
    );
    expect(missing.status).toBe(400);

    const response = await app.request(
      `/schedule-requests/${fixture.requestId}/review`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Test-Role": "dispatcher",
        },
        body: JSON.stringify({ expectedVersion: 3 }),
      },
    );
    expect(response.status).toBe(200);
    expect(scheduleService.transitionRequest).toHaveBeenCalledWith(
      expect.objectContaining({ role: "dispatcher" }),
      fixture.requestId,
      "in_review",
      { expectedVersion: 3 },
    );
  });
});
