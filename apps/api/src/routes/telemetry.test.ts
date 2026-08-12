import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createDevice: vi.fn(),
  listDevices: vi.fn(),
  revokeDevice: vi.fn(),
  ingestTelemetry: vi.fn(),
  getFlightTelemetry: vi.fn(),
  listLiveTelemetry: vi.fn(),
  correctOooi: vi.fn(),
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
vi.mock("../domain/telemetry/service.js", () => mocks);

import { errorHandler } from "../middleware/error.js";
import { telemetryClientRoutes, telemetryRoutes } from "./telemetry.js";

const now = new Date("2026-08-12T12:00:00.000Z");
const flightId = "30000000-0000-4000-8000-000000000001";
const membershipId = "10000000-0000-4000-8000-000000000001";
const deviceId = "60000000-0000-4000-8000-000000000001";
const current = {
  flightId,
  membershipId,
  phase: "airborne",
  latitude: 55.618,
  longitude: 12.656,
  altitudeFeet: 10_000,
  groundSpeedKnots: 280,
  headingDegrees: 274,
  simulatorTime: now,
  sampleAt: now,
  sequence: 3,
};

const app = new Hono();
app.onError(errorHandler);
app.route("/", telemetryClientRoutes);
app.route("/", telemetryRoutes);

describe("telemetry routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ingestTelemetry.mockResolvedValue({
      current,
      presence: "online",
      oooiEvents: [],
    });
    mocks.createDevice.mockResolvedValue({
      token: `v1.${deviceId}.${"a".repeat(43)}`,
      device: {
        id: deviceId,
        name: "Home cockpit",
        status: "active",
        lastSeenAt: null,
        revokedAt: null,
        createdAt: now,
      },
    });
    mocks.listDevices.mockResolvedValue([]);
    mocks.listLiveTelemetry.mockResolvedValue([
      { ...current, presence: "online" },
    ]);
    mocks.getFlightTelemetry.mockResolvedValue({
      presence: "online",
      current,
      track: [current],
      oooiEvents: [],
    });
  });

  it("accepts a bounded simulator payload through device bearer authentication", async () => {
    const response = await app.request("/telemetry/ingest", {
      method: "POST",
      headers: {
        Authorization: `Bearer v1.${deviceId}.${"a".repeat(43)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        flightId,
        sequence: 3,
        simulatorTime: now.toISOString(),
        phase: "airborne",
        latitude: 55.618,
        longitude: 12.656,
        altitudeFeet: 10_000,
        groundSpeedKnots: 280,
        headingDegrees: 274,
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.ingestTelemetry).toHaveBeenCalledWith(
      expect.stringContaining("Bearer v1."),
      expect.objectContaining({
        flightId,
        simulatorTime: now,
        phase: "airborne",
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      accepted: true,
      flightId,
      sequence: 3,
      presence: "online",
    });
  });

  it("rejects out-of-bounds telemetry before the service", async () => {
    const response = await app.request("/telemetry/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        flightId,
        sequence: 3,
        simulatorTime: now.toISOString(),
        phase: "airborne",
        latitude: 95,
        longitude: 12,
        altitudeFeet: 10_000,
        groundSpeedKnots: 280,
        headingDegrees: 274,
      }),
    });
    expect(response.status).toBe(400);
    expect(mocks.ingestTelemetry).not.toHaveBeenCalled();
  });

  it("shows a device token once without returning its stored authenticator", async () => {
    const response = await app.request("/telemetry/devices", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Test-Role": "pilot",
      },
      body: JSON.stringify({ name: "Home cockpit" }),
    });
    const body = (await response.json()) as Record<string, unknown>;
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.token).toMatch(/^v1\./);
    expect(JSON.stringify(body)).not.toContain("tokenMac");
  });

  it("denies device issuance to dispatch roles but keeps cleanup reads available", async () => {
    const denied = await app.request("/telemetry/devices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Dispatch workstation" }),
    });
    expect(denied.status).toBe(403);
    expect(denied.headers.get("cache-control")).toBe("no-store");
    expect(mocks.createDevice).not.toHaveBeenCalled();

    const cleanup = await app.request("/telemetry/devices");
    expect(cleanup.status).toBe(200);
    expect(cleanup.headers.get("cache-control")).toBe("private, no-store");
  });

  it("exposes tenant-scoped live telemetry only to dispatch roles", async () => {
    const pilot = await app.request("/dispatch/telemetry", {
      headers: { "X-Test-Role": "pilot" },
    });
    expect(pilot.status).toBe(403);

    const dispatcher = await app.request("/dispatch/telemetry");
    expect(dispatcher.status).toBe(200);
    expect(dispatcher.headers.get("cache-control")).toBe("private, no-store");
    await expect(dispatcher.json()).resolves.toMatchObject({
      items: [{ flightId, presence: "online", phase: "airborne" }],
    });
  });

  it("marks precise flight telemetry responses private and non-cacheable", async () => {
    const response = await app.request(`/flights/${flightId}/telemetry`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({
      current: { flightId, latitude: 55.618, longitude: 12.656 },
    });
  });
});
