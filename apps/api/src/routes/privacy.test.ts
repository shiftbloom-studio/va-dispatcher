import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  approveHold: vi.fn(),
  approvePolicy: vi.fn(),
  approveSubjectRequest: vi.fn(),
  createHold: vi.fn(),
  createPolicy: vi.fn(),
  createSubjectRequest: vi.fn(),
  exportPrivacyRequestPage: vi.fn(),
  getActivePolicy: vi.fn(),
  getRetentionRun: vi.fn(),
  getSubjectRequest: vi.fn(),
  processSubjectRequest: vi.fn(),
  queueRetentionRun: vi.fn(),
  releaseHold: vi.fn(),
  retrySubjectRequest: vi.fn(),
  retryRun: vi.fn(),
  updateExternalTask: vi.fn(),
  verifySubjectRequest: vi.fn(),
}));

vi.mock("../middleware/auth.js", async () => {
  const { createMiddleware } = await import("hono/factory");
  const { AppError } = await import("../lib/errors.js");
  const rank = { pilot: 1, dispatcher: 2, admin: 3 } as const;
  // The check itself is covered in middleware/auth.step-up.test.ts; here
  // `x-test-stale-sign-in: 1` stands for a sign-in that fails it.
  const stale = new Set<string>();
  const assertRecentPasskey = (auth: { authUserId: string }) => {
    if (stale.has(auth.authUserId)) {
      throw new AppError("STEP_UP_REQUIRED", "Confirm with your passkey", {
        details: { stepUp: { reason: "stale", maxAge: 600 } },
      });
    }
  };
  return {
    assertRecentPasskey,
    requireRecentPasskey: createMiddleware(async (context, next) => {
      assertRecentPasskey(context.get("auth"));
      await next();
    }),
    requireAuth: createMiddleware(async (context, next) => {
      const role = (context.req.header("x-test-role") ??
        "pilot") as keyof typeof rank;
      const authUserId =
        context.req.header("x-test-stale-sign-in") === "1"
          ? "user-stale"
          : "user-test";
      if (authUserId === "user-stale") stale.add(authUserId);
      context.set("auth", {
        authUserId,
        tenantId: context.req.header("x-test-tenant") ?? "tenant-a",
        membershipId: "27000000-0000-4000-8000-000000000011",
        role,
        authOrgId: "org-test",
      });
      await next();
    }),
    requireRole: (required: keyof typeof rank) =>
      createMiddleware(async (context, next) => {
        const actual = context.get("auth").role as keyof typeof rank;
        if (rank[actual] < rank[required]) {
          return context.json(
            { error: { code: "FORBIDDEN", message: "Insufficient role" } },
            403,
          );
        }
        await next();
      }),
  };
});

vi.mock("../domain/privacy/service.js", async () => {
  const actual = await vi.importActual<
    typeof import("../domain/privacy/service.js")
  >("../domain/privacy/service.js");
  return { ...actual, ...mocks };
});

import { errorHandler } from "../middleware/error.js";
import { privacyRoutes } from "./privacy.js";

const app = new Hono();
app.onError(errorHandler);
app.route("/", privacyRoutes);
app.get("/non-privacy-probe", (context) => context.json({ ok: true }));

const config = {
  classes: {
    memberships: { retentionDays: 730, action: "anonymize" },
    scheduleRequests: { retentionDays: 730, action: "delete" },
    flights: { retentionDays: 2_555, action: "delete" },
    telemetry: { retentionDays: 1, action: "delete" },
    simbrief: { retentionDays: 90, action: "delete" },
    acars: { retentionDays: 30, action: "delete" },
    oauth: { retentionDays: 1, action: "delete" },
    audit: { retentionDays: 365, action: "delete" },
    logs: { retentionDays: 30, action: "external" },
    backups: { retentionDays: 30, action: "external" },
  },
  batchSize: 100,
  intervalHours: 24,
  automaticExecution: false,
  minimumDryRunAgeHours: 24,
} as const;

describe("privacy control-plane routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createPolicy.mockResolvedValue({ id: "policy-a" });
    mocks.getActivePolicy.mockResolvedValue(null);
    mocks.queueRetentionRun.mockResolvedValue({ id: "run-a" });
    mocks.createSubjectRequest.mockResolvedValue({ id: "request-a" });
    mocks.exportPrivacyRequestPage.mockResolvedValue({
      requestId: "27000000-0000-4000-8000-000000000041",
      scope: "member",
      items: [],
      nextCursor: null,
      manifest: { stores: [], externalSystems: [], omittedSecurityFields: [] },
      generatedAt: "2026-08-12T00:00:00.000Z",
    });
  });

  it("keeps the entire control plane admin-only and no-store", async () => {
    const forbidden = await app.request("/privacy/policies/active", {
      headers: { "x-test-role": "dispatcher" },
    });
    expect(forbidden.status).toBe(403);
    expect(forbidden.headers.get("cache-control")).toBe("private, no-store");

    const allowed = await app.request("/privacy/policies/active", {
      headers: { "x-test-role": "admin" },
    });
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("cache-control")).toBe("private, no-store");
  });

  it("does not leak admin middleware onto routes mounted after privacy", async () => {
    const response = await app.request("/non-privacy-probe", {
      headers: { "x-test-role": "pilot" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBeNull();
  });

  it("derives tenant and actor identity when creating a policy", async () => {
    const response = await app.request("/privacy/policies", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-test-role": "admin",
        "x-test-tenant": "tenant-b",
      },
      body: JSON.stringify({ config }),
    });
    expect(response.status).toBe(201);
    expect(mocks.createPolicy).toHaveBeenCalledWith({
      tenantId: "tenant-b",
      actorMembershipId: "27000000-0000-4000-8000-000000000011",
      config,
    });
  });

  it("queues an execution only with the explicit request fields", async () => {
    const response = await app.request("/privacy/retention/runs", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-test-role": "admin",
      },
      body: JSON.stringify({
        mode: "execute",
        idempotencyKey: "retention-2026-08",
        dryRunId: "27000000-0000-4000-8000-000000000031",
        confirmation: "EXECUTE APPROVED RETENTION",
      }),
    });
    expect(response.status).toBe(202);
    expect(mocks.queueRetentionRun).toHaveBeenCalledWith({
      tenantId: "tenant-a",
      actorMembershipId: "27000000-0000-4000-8000-000000000011",
      mode: "execute",
      idempotencyKey: "retention-2026-08",
      dryRunId: "27000000-0000-4000-8000-000000000031",
      confirmation: "EXECUTE APPROVED RETENTION",
    });
  });

  it("returns bounded verified exports as private attachments", async () => {
    const requestId = "27000000-0000-4000-8000-000000000041";
    const response = await app.request(
      `/privacy/requests/${requestId}/export?limit=250&cursor=next`,
      { headers: { "x-test-role": "admin", "x-test-tenant": "tenant-b" } },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).toContain(requestId);
    expect(mocks.exportPrivacyRequestPage).toHaveBeenCalledWith({
      tenantId: "tenant-b",
      actorMembershipId: "27000000-0000-4000-8000-000000000011",
      requestId,
      limit: 250,
      cursor: "next",
    });
  });

  it("needs a recent passkey for deleting and releasing actions", async () => {
    const stale = { "x-test-role": "admin", "x-test-stale-sign-in": "1" };
    const id = "27000000-0000-4000-8000-000000000041";
    const json = (body: unknown) => ({
      method: "POST",
      headers: { ...stale, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const guarded: Array<[string, RequestInit]> = [
      [`/privacy/policies/${id}/approve`, { method: "POST", headers: stale }],
      [
        "/privacy/retention/runs",
        json({ mode: "execute", idempotencyKey: "execute-run-1" }),
      ],
      [
        `/privacy/retention/runs/${id}/retry`,
        { method: "POST", headers: stale },
      ],
      [
        `/privacy/legal-holds/${id}/release`,
        { method: "POST", headers: stale },
      ],
      [`/privacy/requests/${id}/process`, json({})],
      [`/privacy/requests/${id}/export`, { headers: stale }],
    ];
    for (const [path, init] of guarded) {
      const response = await app.request(path, init);
      expect(response.status, path).toBe(403);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code, path).toBe("STEP_UP_REQUIRED");
    }
    expect(mocks.approvePolicy).not.toHaveBeenCalled();
    expect(mocks.queueRetentionRun).not.toHaveBeenCalled();
    expect(mocks.retryRun).not.toHaveBeenCalled();
    expect(mocks.releaseHold).not.toHaveBeenCalled();
    expect(mocks.processSubjectRequest).not.toHaveBeenCalled();
    expect(mocks.exportPrivacyRequestPage).not.toHaveBeenCalled();

    // A dry run only reports, so it stays available.
    const dryRun = await app.request(
      "/privacy/retention/runs",
      json({ mode: "dry_run", idempotencyKey: "dry-run-0001" }),
    );
    expect(dryRun.status).toBe(202);
  });

  it("rejects member workflows without a member subject", async () => {
    const response = await app.request("/privacy/requests", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-test-role": "admin",
      },
      body: JSON.stringify({
        kind: "restriction",
        scope: "member",
        payload: { reason: "verified request" },
      }),
    });
    expect(response.status).toBe(400);
    expect(mocks.createSubjectRequest).not.toHaveBeenCalled();
  });
});
