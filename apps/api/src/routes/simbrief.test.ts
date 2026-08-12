import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SimbriefDispatch } from "../db/schema.js";

const mocks = vi.hoisted(() => ({
  getConnection: vi.fn(),
  connectAccount: vi.fn(),
  disconnectAccount: vi.fn(),
  createDispatch: vi.fn(),
  getLatestDispatch: vi.fn(),
  getDispatch: vi.fn(),
  syncDispatch: vi.fn(),
  completeDispatchCallback: vi.fn(),
  startNavigraphOauth: vi.fn(),
  completeNavigraphOauth: vi.fn(),
  isNavigraphOauthConfigured: vi.fn(),
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

import { errorHandler } from "../middleware/error.js";
import { simbriefPublicRoutes, simbriefRoutes } from "./simbrief.js";

const now = new Date("2026-08-12T12:00:00.000Z");
const dispatch: SimbriefDispatch = {
  id: "40000000-0000-4000-8000-000000000001",
  tenantId: "20000000-0000-4000-8000-000000000001",
  flightId: "30000000-0000-4000-8000-000000000001",
  createdByMembershipId: "10000000-0000-4000-8000-000000000001",
  simbriefUserId: "123456",
  staticId: "VAD_40000000000040008000000000000001",
  callbackTokenMac: "mac-is-never-serialized",
  status: "pending",
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
app.route("/", simbriefRoutes);

describe("SimBrief routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createDispatch.mockResolvedValue({
      dispatch,
      dispatchUrl: "https://www.simbrief.com/ofp/ofp.loader.api.php?signed=1",
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
      simbriefUserId: "123456",
      simbriefVerifiedAt: null,
      navigraphSubject: "navigraph-subject",
      navigraphUsername: "TestPilot",
      navigraphConnectedAt: now,
    });
    mocks.isNavigraphOauthConfigured.mockReturnValue(true);
  });

  it("allows an authenticated pilot to create a dispatch and hides internal identifiers", async () => {
    const response = await app.request(
      `/flights/${dispatch.flightId}/simbrief/dispatches`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notams: true }),
      },
    );
    const body = (await response.json()) as {
      dispatchUrl: string;
      dispatch: {
        request: Record<string, string>;
        [key: string]: unknown;
      };
    };

    expect(response.status).toBe(201);
    expect(mocks.createDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ role: "pilot" }),
      dispatch.flightId,
      expect.objectContaining({ notams: true, units: "KGS" }),
    );
    expect(body.dispatchUrl).toContain("simbrief.com");
    expect(body.dispatch).not.toHaveProperty("callbackTokenMac");
    expect(body.dispatch.request).not.toHaveProperty("userid");
    expect(body.dispatch.request).not.toHaveProperty("pid");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("uses flight defaults when the dispatch request has no body", async () => {
    const response = await app.request(
      `/flights/${dispatch.flightId}/simbrief/dispatches`,
      { method: "POST" },
    );

    expect(response.status).toBe(201);
    expect(mocks.createDispatch).toHaveBeenCalledWith(
      expect.anything(),
      dispatch.flightId,
      expect.objectContaining({ units: "KGS" }),
    );
  });

  it("rejects unknown or reserved-looking dispatch options", async () => {
    const response = await app.request(
      `/flights/${dispatch.flightId}/simbrief/dispatches`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apicode: "attacker-controlled" }),
      },
    );

    expect(response.status).toBe(400);
    expect(mocks.createDispatch).not.toHaveBeenCalled();
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
});
