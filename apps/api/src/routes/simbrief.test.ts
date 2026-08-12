import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SimbriefDispatch } from "../db/schema.js";
import { AppError } from "../lib/errors.js";

const mocks = vi.hoisted(() => ({
  getConnection: vi.fn(),
  connectAccount: vi.fn(),
  disconnectAccount: vi.fn(),
  prepareDispatch: vi.fn(),
  generateDispatch: vi.fn(),
  listDispatches: vi.fn(),
  getLatestDispatch: vi.fn(),
  getDispatch: vi.fn(),
  syncDispatch: vi.fn(),
  completeDispatchCallback: vi.fn(),
  startNavigraphOauth: vi.fn(),
  completeNavigraphOauth: vi.fn(),
  isNavigraphOauthConfigured: vi.fn(),
  findTenantById: vi.fn(),
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
        role: "pilot",
        clerkOrgId: "org_test",
      });
      await next();
    }),
  };
});
vi.mock("../domain/simbrief/service.js", () => mocks);
vi.mock("../domain/simbrief/oauth-service.js", () => ({
  startNavigraphOauth: mocks.startNavigraphOauth,
  completeNavigraphOauth: mocks.completeNavigraphOauth,
  isNavigraphOauthConfigured: mocks.isNavigraphOauthConfigured,
}));
vi.mock("../db/repositories/tenants.js", () => ({
  findTenantById: mocks.findTenantById,
}));

import { loadEnv, resetEnvCache } from "../env.js";
import { errorHandler } from "../middleware/error.js";
import { dispatchRoutes } from "./dispatch.js";
import { simbriefPublicRoutes, simbriefRoutes } from "./simbrief.js";

const now = new Date("2026-08-12T12:00:00.000Z");
const dispatch: SimbriefDispatch = {
  id: "40000000-0000-4000-8000-000000000001",
  tenantId: "20000000-0000-4000-8000-000000000001",
  flightId: "30000000-0000-4000-8000-000000000001",
  createdByMembershipId: "10000000-0000-4000-8000-000000000001",
  generatedByMembershipId: "10000000-0000-4000-8000-000000000001",
  simbriefUserId: "123456",
  staticId: "VAD_40000000000040008000000000000001",
  callbackTokenMac: "mac-is-never-serialized",
  callbackExpiresAt: new Date("2026-08-12T14:00:00.000Z"),
  status: "pending",
  revision: 1,
  flightSnapshot: {
    flightVersion: 3,
    assignmentRevision: 2,
    dispatchReleaseId: "35000000-0000-4000-8000-000000000001",
    dispatchReleaseRevision: 4,
    pilotMembershipId: "10000000-0000-4000-8000-000000000001",
    flightNumber: "SK935",
    depIcao: "EKCH",
    arrIcao: "KSFO",
    etd: "2026-08-13T10:05:00.000Z",
    eta: "2026-08-13T21:35:00.000Z",
    aircraftType: "A359",
  },
  request: {
    orig: "EKCH",
    dest: "KSFO",
    type: "A359",
    userid: "123456",
    pid: "123456",
  },
  ofp: null,
  simbriefRequestId: null,
  generatedAt: null,
  syncedAt: null,
  lastError: null,
  createdAt: now,
  updatedAt: now,
};

const app = new Hono();
app.onError(errorHandler);
app.route("/", simbriefPublicRoutes);
app.route("/", dispatchRoutes);
app.route("/", simbriefRoutes);
app.get("/mounted-after-simbrief-probe", (c) => c.json({ ok: true }));

describe("SimBrief routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetEnvCache();
    loadEnv({ NODE_ENV: "test" });
    mocks.prepareDispatch.mockResolvedValue({
      ...dispatch,
      status: "prepared",
      generatedByMembershipId: null,
      simbriefUserId: null,
      callbackTokenMac: null,
      callbackExpiresAt: null,
    });
    mocks.generateDispatch.mockResolvedValue({
      dispatch,
      dispatchUrl: "https://www.simbrief.com/ofp/ofp.loader.api.php?signed=1",
    });
    mocks.listDispatches.mockResolvedValue({
      items: [dispatch],
      currentDispatchId: dispatch.id,
    });
    mocks.completeDispatchCallback.mockResolvedValue({
      ...dispatch,
      status: "ready",
      ofp: { params: { request_id: "request_123" } },
      generatedAt: now,
    });
    mocks.connectAccount.mockResolvedValue({
      simbriefUserId: "123456",
      simbriefVerifiedAt: null,
      navigraphSubject: null,
      navigraphUsername: null,
      navigraphConnectedAt: null,
    });
    mocks.startNavigraphOauth.mockResolvedValue({
      authorizationUrl:
        "https://identity.api.navigraph.com/connect/authorize?client_id=client-id",
      redirectUri:
        "https://www.va-dispatcher.world/api/v1/simbrief/oauth/callback",
      expiresAt: new Date("2026-08-12T12:10:00.000Z"),
    });
    mocks.completeNavigraphOauth.mockResolvedValue({
      tenantId: dispatch.tenantId,
      simbriefUserId: "123456",
      simbriefVerifiedAt: null,
      navigraphSubject: "navigraph-subject",
      navigraphUsername: "TestPilot",
      navigraphConnectedAt: now,
    });
    mocks.isNavigraphOauthConfigured.mockReturnValue(true);
    mocks.findTenantById.mockResolvedValue({ slug: "vsas" });
  });

  it("saves a preparation and hides internal identifiers", async () => {
    const response = await app.request(
      `/flights/${dispatch.flightId}/simbrief/dispatches`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedFlightVersion: 3,
          expectedAssignmentRevision: 2,
          releaseId: "35000000-0000-4000-8000-000000000001",
          releaseRevision: 4,
        }),
      },
    );
    const body = (await response.json()) as {
      dispatch: {
        request: Record<string, string>;
        [key: string]: unknown;
      };
    };

    expect(response.status).toBe(201);
    expect(mocks.prepareDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ role: "pilot" }),
      dispatch.flightId,
      {
        expectedFlightVersion: 3,
        expectedAssignmentRevision: 2,
        releaseId: "35000000-0000-4000-8000-000000000001",
        releaseRevision: 4,
      },
    );
    expect(body.dispatch).not.toHaveProperty("callbackTokenMac");
    expect(body.dispatch).not.toHaveProperty("callbackExpiresAt");
    expect(body.dispatch).not.toHaveProperty("flightSnapshot");
    expect(body.dispatch).toHaveProperty("revision", 1);
    expect(body.dispatch).toHaveProperty("flightVersion", 3);
    expect(body.dispatch).toHaveProperty("releaseRevision", 4);
    expect(body.dispatch.request).not.toHaveProperty("userid");
    expect(body.dispatch.request).not.toHaveProperty("pid");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("requires an explicit flight, assignment, and release compare-and-set", async () => {
    const response = await app.request(
      `/flights/${dispatch.flightId}/simbrief/dispatches`,
      { method: "POST" },
    );

    expect(response.status).toBe(400);
    expect(mocks.prepareDispatch).not.toHaveBeenCalled();
  });

  it("rejects unknown or reserved-looking dispatch options", async () => {
    const response = await app.request(
      `/flights/${dispatch.flightId}/simbrief/dispatches`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedFlightVersion: 3,
          expectedAssignmentRevision: 2,
          releaseId: "35000000-0000-4000-8000-000000000001",
          releaseRevision: 4,
          apicode: "attacker-controlled",
        }),
      },
    );

    expect(response.status).toBe(400);
    expect(mocks.prepareDispatch).not.toHaveBeenCalled();
  });

  it("launches a prepared revision through the assigned-pilot generation endpoint", async () => {
    const response = await app.request(
      `/flights/${dispatch.flightId}/simbrief/dispatches/${dispatch.id}/generate`,
      { method: "POST" },
    );
    const body = (await response.json()) as { dispatchUrl: string };

    expect(response.status).toBe(200);
    expect(mocks.generateDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ membershipId: expect.any(String) }),
      dispatch.flightId,
      dispatch.id,
    );
    expect(body.dispatchUrl).toContain("simbrief.com");
  });

  it("returns the server-derived canonical current planning revision", async () => {
    const response = await app.request(
      `/flights/${dispatch.flightId}/simbrief/dispatches`,
    );
    const body = (await response.json()) as {
      currentDispatchId: string | null;
      items: Array<{ id: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.currentDispatchId).toBe(dispatch.id);
    expect(body.items).toEqual([expect.objectContaining({ id: dispatch.id })]);
  });

  it("returns a conflict and canonical revision id for a direct obsolete launch", async () => {
    const latestDispatchId = "40000000-0000-4000-8000-000000000099";
    mocks.generateDispatch.mockRejectedValueOnce(
      new AppError(
        "CONFLICT",
        "A newer SimBrief planning revision is available. Reload before generating.",
        { details: { latestDispatchId } },
      ),
    );

    const response = await app.request(
      `/flights/${dispatch.flightId}/simbrief/dispatches/${dispatch.id}/generate`,
      { method: "POST" },
    );
    const body = (await response.json()) as {
      error: { code: string; details: { latestDispatchId: string } };
    };

    expect(response.status).toBe(409);
    expect(body.error).toMatchObject({
      code: "CONFLICT",
      details: { latestDispatchId },
    });
  });

  it("accepts only a numeric SimBrief Pilot ID for connection", async () => {
    const invalid = await app.request("/simbrief/connection", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "PilotName" }),
    });
    expect(invalid.status).toBe(400);

    const valid = await app.request("/simbrief/connection", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "123456" }),
    });
    expect(valid.status).toBe(200);
  });

  it("does not leak dispatch roles or SimBrief cache policy onto later routers", async () => {
    const response = await app.request("/mounted-after-simbrief-probe");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBeNull();
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("starts Navigraph OAuth for the authenticated member without exposing credentials", async () => {
    const response = await app.request("/simbrief/oauth/start", {
      method: "POST",
    });
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(mocks.startNavigraphOauth).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "20000000-0000-4000-8000-000000000001",
        membershipId: "10000000-0000-4000-8000-000000000001",
      }),
    );
    expect(body).toEqual({
      authorizationUrl:
        "https://identity.api.navigraph.com/connect/authorize?client_id=client-id",
      redirectUri:
        "https://www.va-dispatcher.world/api/v1/simbrief/oauth/callback",
      expiresAt: "2026-08-12T12:10:00.000Z",
    });
    expect(JSON.stringify(body)).not.toContain("secret");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("completes the public OAuth callback and returns only connection metadata", async () => {
    const state = `v2.${"i".repeat(16)}.${"t".repeat(22)}.${"c".repeat(58)}`;
    const response = await app.request(
      `/simbrief/oauth/callback?state=${state}&code=authorization-code`,
    );
    const body = (await response.json()) as {
      connection: Record<string, unknown>;
    };

    expect(response.status).toBe(200);
    expect(mocks.completeNavigraphOauth).toHaveBeenCalledWith({
      state,
      code: "authorization-code",
    });
    expect(body.connection).toEqual({
      connected: true,
      userId: "123456",
      verified: false,
      verifiedAt: null,
      oauth: {
        configured: true,
        connected: true,
        username: "TestPilot",
        connectedAt: now.toISOString(),
      },
    });
    expect(body.connection).not.toHaveProperty("navigraphSubject");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("keeps the one-time SimBrief callback public but returns only status metadata", async () => {
    const token = "a".repeat(43);
    const response = await app.request(
      `/simbrief/callback?dispatchId=${dispatch.id}&token=${token}`,
    );
    const body = (await response.json()) as {
      dispatch: Record<string, unknown> & {
        id: string;
        flightId: string;
        status: string;
        generatedAt: string | null;
      };
    };

    expect(response.status).toBe(200);
    expect(mocks.completeDispatchCallback).toHaveBeenCalledWith(
      dispatch.id,
      token,
    );
    expect(body).toEqual({
      dispatch: {
        id: dispatch.id,
        flightId: dispatch.flightId,
        status: "ready",
        generatedAt: now.toISOString(),
      },
    });
    expect(body.dispatch).not.toHaveProperty("ofp");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("redirects successful provider callbacks to visible tenant recovery states", async () => {
    loadEnv({
      NODE_ENV: "test",
      APP_ORIGIN: "https://app.example.test",
    });
    const token = "a".repeat(43);
    const dispatchResponse = await app.request(
      `/simbrief/callback?dispatchId=${dispatch.id}&token=${token}`,
    );
    const state = `v2.${"i".repeat(16)}.${"t".repeat(22)}.${"c".repeat(58)}`;
    const oauthResponse = await app.request(
      `/simbrief/oauth/callback?state=${state}&code=authorization-code`,
    );

    expect(dispatchResponse.status).toBe(303);
    expect(dispatchResponse.headers.get("location")).toBe(
      `https://app.example.test/vsas/portal/flights/${dispatch.flightId}?simbrief=ready`,
    );
    expect(oauthResponse.status).toBe(303);
    expect(oauthResponse.headers.get("location")).toBe(
      "https://app.example.test/vsas/settings?simbrief=navigraph-connected",
    );
    expect(dispatchResponse.headers.get("cache-control")).toBe("no-store");
    expect(oauthResponse.headers.get("cache-control")).toBe("no-store");
  });
});
