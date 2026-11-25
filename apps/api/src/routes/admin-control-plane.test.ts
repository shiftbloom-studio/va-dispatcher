import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listMemberships: vi.fn(),
  findMembershipById: vi.fn(),
  getAdministrativeMemberImpact: vi.fn(),
  syncMembersFromDirectory: vi.fn(),
  updateMemberAsAdministrator: vi.fn(),
  setMembershipRole: vi.fn(),
  removeMembership: vi.fn(),
  listDirectoryMemberships: vi.fn(),
  listInvitations: vi.fn(),
  createInvitation: vi.fn(),
  revokeInvitation: vi.fn(),
  queryAuditEvents: vi.fn(),
  writeAudit: vi.fn(),
}));

vi.mock("../middleware/auth.js", async () => {
  const { createMiddleware: middleware } = await import("hono/factory");
  const rank = { pilot: 1, dispatcher: 2, admin: 3 } as const;
  return {
    requireAuth: middleware(async (c, next) => {
      const role = (c.req.header("x-test-role") ??
        "pilot") as keyof typeof rank;
      c.set("auth", {
        authUserId: "user-test",
        tenantId: c.req.header("x-test-tenant") ?? "tenant-a",
        membershipId: "26000000-0000-4000-8000-000000000011",
        role,
        authOrgId: "org-test",
        tenant: {
          id: c.req.header("x-test-tenant") ?? "tenant-a",
          slug: "vsas",
          settings: {},
        },
      });
      await next();
    }),
    requireRole: (required: keyof typeof rank) =>
      middleware(async (c, next) => {
        const actual = c.get("auth").role as keyof typeof rank;
        if (rank[actual] < rank[required]) {
          return c.json(
            { error: { code: "FORBIDDEN", message: "Insufficient role" } },
            403,
          );
        }
        await next();
      }),
  };
});

vi.mock("../auth/directory.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../auth/directory.js")>();
  return {
    ...actual,
    getDirectory: () => ({
      setMembershipRole: mocks.setMembershipRole,
      removeMembership: mocks.removeMembership,
      listMemberships: mocks.listDirectoryMemberships,
      listInvitations: mocks.listInvitations,
      createInvitation: mocks.createInvitation,
      revokeInvitation: mocks.revokeInvitation,
    }),
  };
});

vi.mock("../db/repositories/memberships.js", () => ({
  listMemberships: mocks.listMemberships,
  findMembershipById: mocks.findMembershipById,
}));
vi.mock("../domain/members/service.js", () => ({
  getAdministrativeMemberImpact: mocks.getAdministrativeMemberImpact,
  syncMembersFromDirectory: mocks.syncMembersFromDirectory,
  updateMemberAsAdministrator: mocks.updateMemberAsAdministrator,
}));
vi.mock("../domain/audit/service.js", () => ({
  queryAuditEvents: mocks.queryAuditEvents,
}));
vi.mock("../db/repositories/audit.js", () => ({
  writeAudit: mocks.writeAudit,
}));

import { errorHandler } from "../middleware/error.js";
import { loadEnv, resetEnvCache } from "../env.js";
import { membersRoutes } from "./members.js";
import { DirectoryError } from "../auth/directory.js";
import { auditRoutes } from "./audit.js";

const app = new Hono();
app.onError(errorHandler);
app.route("/", membersRoutes);
app.route("/", auditRoutes);
app.get("/mounted-after-admin-probe", (c) => c.json({ ok: true }));

describe("admin control-plane routes", () => {
  beforeEach(() => {
    resetEnvCache();
    loadEnv({
      NODE_ENV: "test",
      APP_ORIGIN: "https://app.example.test",
    });
    vi.clearAllMocks();
    mocks.listMemberships.mockResolvedValue({ items: [], nextCursor: null });
    mocks.findMembershipById.mockResolvedValue({
      id: "26000000-0000-4000-8000-000000000021",
      authUserId: "user-pilot",
      role: "pilot",
      status: "active",
    });
    mocks.getAdministrativeMemberImpact.mockResolvedValue({
      openFlightCount: 0,
      activeFlightCount: 0,
      openScheduleRequestCount: 0,
      terminalRequestLinkedFlightCount: 0,
    });
    mocks.updateMemberAsAdministrator.mockResolvedValue({
      membership: {
        id: "26000000-0000-4000-8000-000000000021",
        authUserId: "user-pilot",
        role: "pilot",
        displayName: "Pilot",
        pilotCallsign: "SAS101",
        status: "active",
        createdAt: new Date("2026-08-01T00:00:00.000Z"),
        updatedAt: new Date("2026-08-12T00:00:00.000Z"),
      },
      reassignedFlightCount: 0,
      reassignedScheduleRequestCount: 0,
    });
    mocks.queryAuditEvents.mockResolvedValue({ items: [], nextCursor: null });
    mocks.writeAudit.mockResolvedValue(undefined);
    mocks.setMembershipRole.mockResolvedValue(undefined);
    mocks.removeMembership.mockResolvedValue(undefined);
    mocks.listInvitations.mockResolvedValue({
      data: [],
      totalCount: 0,
    });
    mocks.syncMembersFromDirectory.mockResolvedValue({
      complete: true,
      summaryAuditRecorded: true,
      pages: 1,
      seen: 0,
      created: 0,
      updated: 0,
      unchanged: 0,
      skipped: 0,
      failed: 0,
      failures: [],
    });
  });

  afterEach(() => resetEnvCache());

  it("permits dispatcher roster reads but reserves mutations for admins", async () => {
    const list = await app.request("/members?search=SAS&role=pilot&limit=10", {
      headers: { "x-test-role": "dispatcher" },
    });
    expect(list.status).toBe(200);
    expect(list.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.listMemberships).toHaveBeenCalledWith({
      tenantId: "tenant-a",
      search: "SAS",
      role: "pilot",
      limit: 10,
    });

    const patch = await app.request(
      "/members/26000000-0000-4000-8000-000000000021",
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-test-role": "dispatcher",
        },
        body: JSON.stringify({ status: "disabled" }),
      },
    );
    expect(patch.status).toBe(403);
    expect(patch.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.updateMemberAsAdministrator).not.toHaveBeenCalled();
  });

  it("does not leak member caching or audit authorization onto later routers", async () => {
    const response = await app.request("/mounted-after-admin-probe", {
      headers: { "x-test-role": "pilot" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBeNull();
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("derives tenant and actor from auth and never from the request payload", async () => {
    const response = await app.request(
      "/members/26000000-0000-4000-8000-000000000021",
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-test-role": "admin",
          "x-test-tenant": "tenant-a",
        },
        body: JSON.stringify({ role: "dispatcher" }),
      },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.updateMemberAsAdministrator).toHaveBeenCalledWith({
      tenantId: "tenant-a",
      actorMembershipId: "26000000-0000-4000-8000-000000000011",
      membershipId: "26000000-0000-4000-8000-000000000021",
      patch: { role: "dispatcher" },
    });
  });

  it("requires the explicit review action for pending applications", async () => {
    mocks.findMembershipById.mockResolvedValue({
      id: "26000000-0000-4000-8000-000000000021",
      authUserId: "user-applicant",
      role: "dispatcher",
      status: "invited",
    });

    const response = await app.request(
      "/members/26000000-0000-4000-8000-000000000021",
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-test-role": "admin",
        },
        body: JSON.stringify({ role: "admin", status: "active" }),
      },
    );

    expect(response.status).toBe(409);
    expect(mocks.setMembershipRole).not.toHaveBeenCalled();
    expect(mocks.updateMemberAsAdministrator).not.toHaveBeenCalled();
  });

  it("does not let administrators manufacture pending application status", async () => {
    const response = await app.request(
      "/members/26000000-0000-4000-8000-000000000021",
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-test-role": "admin",
        },
        body: JSON.stringify({ status: "invited" }),
      },
    );

    expect(response.status).toBe(422);
    expect(mocks.updateMemberAsAdministrator).not.toHaveBeenCalled();
  });

  it("approves only tenant-scoped pending applications after directory synchronization", async () => {
    mocks.findMembershipById.mockResolvedValue({
      id: "26000000-0000-4000-8000-000000000021",
      authUserId: "user-applicant",
      role: "dispatcher",
      displayName: "Applicant",
      pilotCallsign: null,
      status: "invited",
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      updatedAt: new Date("2026-08-12T00:00:00.000Z"),
    });
    mocks.updateMemberAsAdministrator.mockResolvedValue({
      membership: {
        id: "26000000-0000-4000-8000-000000000021",
        authUserId: "user-applicant",
        role: "dispatcher",
        displayName: "Applicant",
        pilotCallsign: null,
        status: "active",
        createdAt: new Date("2026-08-01T00:00:00.000Z"),
        updatedAt: new Date("2026-08-13T00:00:00.000Z"),
      },
      reassignedFlightCount: 0,
      reassignedScheduleRequestCount: 0,
    });

    const response = await app.request(
      "/members/26000000-0000-4000-8000-000000000021/application/approve",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-test-role": "admin",
          "x-test-tenant": "tenant-b",
        },
        body: JSON.stringify({}),
      },
    );

    expect(response.status).toBe(200);
    expect(mocks.findMembershipById).toHaveBeenCalledWith(
      "tenant-b",
      "26000000-0000-4000-8000-000000000021",
    );
    expect(mocks.setMembershipRole).toHaveBeenCalledWith({
      orgId: "org-test",
      userId: "user-applicant",
      role: "dispatcher",
    });
    expect(mocks.updateMemberAsAdministrator).toHaveBeenCalledWith({
      tenantId: "tenant-b",
      actorMembershipId: "26000000-0000-4000-8000-000000000011",
      membershipId: "26000000-0000-4000-8000-000000000021",
      patch: {
        role: "dispatcher",
        status: "active",
        reassignToMembershipId: undefined,
      },
      auditAction: "membership.application_approved",
    });
    expect(mocks.setMembershipRole.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.updateMemberAsAdministrator.mock.invocationCallOrder[0]!,
    );
  });

  it("disables application access before attempting to remove the directory membership", async () => {
    mocks.removeMembership.mockRejectedValue(
      new Error("Identity provider unavailable"),
    );
    mocks.updateMemberAsAdministrator.mockResolvedValue({
      membership: {
        id: "26000000-0000-4000-8000-000000000021",
        authUserId: "user-pilot",
        role: "pilot",
        displayName: "Pilot",
        pilotCallsign: "SAS101",
        status: "disabled",
        createdAt: new Date("2026-08-01T00:00:00.000Z"),
        updatedAt: new Date("2026-08-13T00:00:00.000Z"),
      },
      reassignedFlightCount: 0,
      reassignedScheduleRequestCount: 0,
    });

    const response = await app.request(
      "/members/26000000-0000-4000-8000-000000000021",
      {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
          "x-test-role": "admin",
        },
        body: JSON.stringify({}),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "disabled",
      directorySynchronized: false,
      completionAuditRecorded: false,
    });
    expect(mocks.updateMemberAsAdministrator).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-a",
        auditAction: "membership.kick_requested",
      }),
    );
    expect(
      mocks.updateMemberAsAdministrator.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.removeMembership.mock.invocationCallOrder[0]!);
  });

  it("keeps invitations and application decisions admin-only", async () => {
    const invitations = await app.request("/members/invitations", {
      headers: { "x-test-role": "dispatcher" },
    });
    const approval = await app.request(
      "/members/26000000-0000-4000-8000-000000000021/application/approve",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-test-role": "dispatcher",
        },
        body: JSON.stringify({}),
      },
    );

    expect(invitations.status).toBe(403);
    expect(approval.status).toBe(403);
    expect(mocks.listInvitations).not.toHaveBeenCalled();
    expect(mocks.updateMemberAsAdministrator).not.toHaveBeenCalled();
  });

  it("creates a tenant invitation that returns through a fresh sign-in", async () => {
    const createdAt = new Date("2026-08-18T10:00:00.000Z").getTime();
    const expiresAt = new Date("2026-09-17T10:00:00.000Z").getTime();
    mocks.createInvitation.mockResolvedValue({
      id: "orginv-test",
      emailAddress: "new-pilot@example.test",
      role: "org:pilot",
      status: "pending",
      createdAt,
      updatedAt: createdAt,
      expiresAt,
    });

    const response = await app.request("/members/invitations", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-test-role": "admin",
      },
      body: JSON.stringify({
        emailAddress: "new-pilot@example.test",
        role: "pilot",
      }),
    });

    expect(response.status).toBe(200);
    expect(mocks.createInvitation).toHaveBeenCalledWith({
      orgId: "org-test",
      inviterUserId: "user-test",
      emailAddress: "new-pilot@example.test",
      role: "pilot",
      expiresInDays: 30,
      redirectUrl: "https://app.example.test/auth/login?returnTo=%2Fvsas",
      metadata: {
        vaDispatchRole: "pilot",
        tenantSlug: "vsas",
      },
    });
    expect(mocks.writeAudit).toHaveBeenCalledWith({
      tenantId: "tenant-a",
      actorMembershipId: "26000000-0000-4000-8000-000000000011",
      action: "membership.invitation_created",
      entityType: "organization_invitation",
      entityId: "orginv-test",
      meta: {
        role: "pilot",
        expiresAt: "2026-09-17T10:00:00.000Z",
      },
    });
    await expect(response.json()).resolves.toEqual({
      invitation: {
        id: "orginv-test",
        emailAddress: "new-pilot@example.test",
        role: "org:pilot",
        status: "pending",
        createdAt: "2026-08-18T10:00:00.000Z",
        updatedAt: "2026-08-18T10:00:00.000Z",
        expiresAt: "2026-09-17T10:00:00.000Z",
      },
      auditRecorded: true,
    });
  });

  it("uses the configured origin for preview tenant invitations", async () => {
    resetEnvCache();
    loadEnv({
      NODE_ENV: "test",
      APP_ENV: "preview",
      APP_ORIGIN: "https://preview-origin.example.test",
    });
    const createdAt = new Date("2026-08-18T10:00:00.000Z").getTime();
    mocks.createInvitation.mockResolvedValue({
      id: "orginv-preview",
      emailAddress: "preview-pilot@example.test",
      role: "org:pilot",
      status: "pending",
      createdAt,
      updatedAt: createdAt,
      expiresAt: new Date("2026-09-17T10:00:00.000Z").getTime(),
    });

    const response = await app.request("/members/invitations", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-test-role": "admin",
      },
      body: JSON.stringify({
        emailAddress: "preview-pilot@example.test",
        role: "pilot",
      }),
    });

    expect(response.status).toBe(200);
    expect(mocks.createInvitation).toHaveBeenCalledWith(
      expect.objectContaining({
        redirectUrl:
          "https://preview-origin.example.test/auth/login?returnTo=%2Fvsas",
      }),
    );
  });

  it("fails a Preview invitation safely when no trusted origin is available", async () => {
    resetEnvCache();
    loadEnv({ NODE_ENV: "test", APP_ENV: "preview" });

    const response = await app.request("/members/invitations", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-test-role": "admin",
      },
      body: JSON.stringify({
        emailAddress: "preview-pilot@example.test",
        role: "pilot",
      }),
    });

    expect(response.status).toBe(503);
    expect(mocks.createInvitation).not.toHaveBeenCalled();
  });

  it.each([
    {
      providerStatus: 400,
      responseStatus: 409,
      providerCode: "organization_invitation_not_unique",
      code: "CONFLICT",
      message:
        "This email already has a pending invitation or organization membership",
    },
    {
      providerStatus: 403,
      responseStatus: 422,
      providerCode: "invitations_not_supported_in_organization",
      code: "UNPROCESSABLE",
      message:
        "The identity provider does not allow this invitation. Verify the tenant role configuration and membership capacity",
    },
    {
      providerStatus: 422,
      responseStatus: 422,
      providerCode: "form_param_value_invalid",
      code: "UNPROCESSABLE",
      message:
        "The identity provider rejected the invitation. Verify that the selected tenant role exists and the invitation return URL is allowed",
    },
    {
      providerStatus: 429,
      responseStatus: 429,
      providerCode: "rate_limit_exceeded",
      code: "UPSTREAM",
      message: "Identity provider rate limit reached; try later",
    },
  ])(
    "maps a provider $providerStatus invitation failure to a safe actionable response",
    async ({ providerStatus, responseStatus, providerCode, code, message }) => {
      mocks.createInvitation.mockRejectedValue(
        new DirectoryError(
          providerStatus,
          providerCode,
          "sensitive upstream detail",
        ),
      );

      const response = await app.request("/members/invitations", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-test-role": "admin",
        },
        body: JSON.stringify({
          emailAddress: "new-pilot@example.test",
          role: "pilot",
        }),
      });

      expect(response.status).toBe(responseStatus);
      const body = await response.json();
      expect(body).toEqual({ error: { code, message } });
      expect(JSON.stringify(body)).not.toContain("sensitive upstream detail");
      expect(JSON.stringify(body)).not.toContain(providerCode);
    },
  );

  it("makes live invitation and sync behavior explicit in auth-bypass mode", async () => {
    resetEnvCache();
    loadEnv({ NODE_ENV: "test", AUTH_DEV_BYPASS: "true" });

    const invitation = await app.request("/members/invitations", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-test-role": "admin",
      },
      body: JSON.stringify({
        emailAddress: "new-pilot@example.test",
        role: "pilot",
      }),
    });
    const sync = await app.request("/members/sync", {
      method: "POST",
      headers: { "x-test-role": "admin" },
    });

    expect(invitation.status).toBe(422);
    await expect(invitation.json()).resolves.toEqual({
      error: {
        code: "UNPROCESSABLE",
        message: "Invitations are unavailable in development auth-bypass mode",
      },
    });
    expect(sync.status).toBe(200);
    await expect(sync.json()).resolves.toMatchObject({
      complete: true,
      seen: 0,
      created: 0,
      note: "Dev bypass - no directory sync",
    });
    expect(mocks.createInvitation).not.toHaveBeenCalled();
    expect(mocks.syncMembersFromDirectory).not.toHaveBeenCalled();
  });

  it("marks member impact and directory sync responses private and no-store", async () => {
    const headers = { "x-test-role": "admin" };
    const impact = await app.request(
      "/members/26000000-0000-4000-8000-000000000021/impact",
      { headers },
    );
    expect(impact.status).toBe(200);
    expect(impact.headers.get("cache-control")).toBe("private, no-store");

    const sync = await app.request("/members/sync", {
      method: "POST",
      headers,
    });
    expect(sync.status).toBe(200);
    expect(sync.headers.get("cache-control")).toBe("private, no-store");
  });

  it("passes opaque cursors through deterministic member pagination", async () => {
    mocks.listMemberships.mockResolvedValue({
      items: [],
      nextCursor: "next-page",
    });
    const response = await app.request(
      "/members?cursor=previous-page&limit=1",
      {
        headers: { "x-test-role": "dispatcher" },
      },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      items: [],
      nextCursor: "next-page",
    });
    expect(mocks.listMemberships).toHaveBeenCalledWith({
      tenantId: "tenant-a",
      cursor: "previous-page",
      limit: 1,
    });
  });

  it("keeps audit list/export admin-only, tenant-scoped, bounded, and no-store", async () => {
    const forbidden = await app.request("/audit-events", {
      headers: { "x-test-role": "dispatcher" },
    });
    expect(forbidden.status).toBe(403);

    const list = await app.request("/audit-events?limit=25", {
      headers: {
        "x-test-role": "admin",
        "x-test-tenant": "tenant-b",
      },
    });
    expect(list.status).toBe(200);
    expect(list.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.queryAuditEvents).toHaveBeenCalledWith({
      tenantId: "tenant-b",
      filters: {},
      cursor: undefined,
      limit: 25,
    });

    const exported = await app.request("/audit-events/export?limit=1000", {
      headers: {
        "x-test-role": "admin",
        "x-test-tenant": "tenant-b",
      },
    });
    expect(exported.status).toBe(200);
    expect(exported.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-b",
        action: "audit.exported",
        meta: expect.objectContaining({ requestedLimit: 1000 }),
      }),
    );
  });

  it("rejects inverted audit ranges before querying the repository", async () => {
    const response = await app.request(
      "/audit-events?from=2026-08-13T00%3A00%3A00Z&to=2026-08-12T00%3A00%3A00Z",
      { headers: { "x-test-role": "admin" } },
    );
    expect(response.status).toBe(400);
    expect(mocks.queryAuditEvents).not.toHaveBeenCalled();
  });
});
