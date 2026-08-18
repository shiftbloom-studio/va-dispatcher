import { Hono } from "hono";
import { ClerkAPIResponseError } from "@clerk/backend/errors";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listMemberships: vi.fn(),
  findMembershipById: vi.fn(),
  getAdministrativeMemberImpact: vi.fn(),
  syncMembersFromDirectory: vi.fn(),
  updateMemberAsAdministrator: vi.fn(),
  getClerkClient: vi.fn(),
  getOrganizationMembershipList: vi.fn(),
  createOrganizationMembership: vi.fn(),
  updateOrganizationMembership: vi.fn(),
  deleteOrganizationMembership: vi.fn(),
  getOrganizationInvitationList: vi.fn(),
  createOrganizationInvitation: vi.fn(),
  revokeOrganizationInvitation: vi.fn(),
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
        clerkUserId: "user-test",
        tenantId: c.req.header("x-test-tenant") ?? "tenant-a",
        membershipId: "26000000-0000-4000-8000-000000000011",
        role,
        clerkOrgId: "org-test",
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
    getClerkClient: mocks.getClerkClient,
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
      clerkUserId: "user-pilot",
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
        clerkUserId: "user-pilot",
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
    mocks.getClerkClient.mockReturnValue({
      organizations: {
        getOrganizationMembershipList: mocks.getOrganizationMembershipList,
        createOrganizationMembership: mocks.createOrganizationMembership,
        updateOrganizationMembership: mocks.updateOrganizationMembership,
        deleteOrganizationMembership: mocks.deleteOrganizationMembership,
        getOrganizationInvitationList: mocks.getOrganizationInvitationList,
        createOrganizationInvitation: mocks.createOrganizationInvitation,
        revokeOrganizationInvitation: mocks.revokeOrganizationInvitation,
      },
    });
    mocks.getOrganizationMembershipList.mockResolvedValue({
      data: [{}],
      totalCount: 1,
    });
    mocks.createOrganizationMembership.mockResolvedValue({});
    mocks.updateOrganizationMembership.mockResolvedValue({});
    mocks.deleteOrganizationMembership.mockResolvedValue({});
    mocks.getOrganizationInvitationList.mockResolvedValue({
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
      clerkUserId: "user-applicant",
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
    expect(mocks.updateOrganizationMembership).not.toHaveBeenCalled();
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

  it("approves only tenant-scoped pending applications after Clerk synchronization", async () => {
    mocks.findMembershipById.mockResolvedValue({
      id: "26000000-0000-4000-8000-000000000021",
      clerkUserId: "user-applicant",
      role: "dispatcher",
      displayName: "Applicant",
      pilotCallsign: null,
      status: "invited",
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      updatedAt: new Date("2026-08-12T00:00:00.000Z"),
    });
    mocks.getOrganizationMembershipList.mockResolvedValue({
      data: [],
      totalCount: 0,
    });
    mocks.updateMemberAsAdministrator.mockResolvedValue({
      membership: {
        id: "26000000-0000-4000-8000-000000000021",
        clerkUserId: "user-applicant",
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
    expect(mocks.createOrganizationMembership).toHaveBeenCalledWith({
      organizationId: "org-test",
      userId: "user-applicant",
      role: "org:dispatcher",
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
    expect(
      mocks.createOrganizationMembership.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.updateMemberAsAdministrator.mock.invocationCallOrder[0]!,
    );
  });

  it("disables application access before attempting to remove Clerk membership", async () => {
    mocks.deleteOrganizationMembership.mockRejectedValue(
      new Error("Clerk unavailable"),
    );
    mocks.updateMemberAsAdministrator.mockResolvedValue({
      membership: {
        id: "26000000-0000-4000-8000-000000000021",
        clerkUserId: "user-pilot",
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
      clerkSynchronized: false,
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
    ).toBeLessThan(
      mocks.deleteOrganizationMembership.mock.invocationCallOrder[0]!,
    );
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
    expect(mocks.getOrganizationInvitationList).not.toHaveBeenCalled();
    expect(mocks.updateMemberAsAdministrator).not.toHaveBeenCalled();
  });

  it("creates a tenant invitation that returns through the public Clerk sign-in flow", async () => {
    const createdAt = new Date("2026-08-18T10:00:00.000Z").getTime();
    const expiresAt = new Date("2026-09-17T10:00:00.000Z").getTime();
    mocks.createOrganizationInvitation.mockResolvedValue({
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
    expect(mocks.createOrganizationInvitation).toHaveBeenCalledWith({
      organizationId: "org-test",
      inviterUserId: "user-test",
      emailAddress: "new-pilot@example.test",
      role: "org:pilot",
      expiresInDays: 30,
      redirectUrl: "https://app.example.test/vsas/sign-in",
      publicMetadata: {
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

  it.each([
    {
      providerStatus: 400,
      responseStatus: 409,
      providerCode: "organization_invitation_not_unique",
      code: "CONFLICT",
      message:
        "Clerk already has a pending invitation or organization membership for this email",
    },
    {
      providerStatus: 403,
      responseStatus: 422,
      providerCode: "invitations_not_supported_in_organization",
      code: "UNPROCESSABLE",
      message:
        "Clerk does not allow this organization invitation. Verify organization invitation support, tenant role configuration, and membership capacity",
    },
    {
      providerStatus: 422,
      responseStatus: 422,
      providerCode: "form_param_value_invalid",
      code: "UNPROCESSABLE",
      message:
        "Clerk rejected the invitation. Verify that organization invitations are enabled, the selected tenant role exists, and the invitation return URL is allowed",
    },
    {
      providerStatus: 429,
      responseStatus: 429,
      providerCode: "rate_limit_exceeded",
      code: "UPSTREAM",
      message: "Clerk rate limit reached; try later",
    },
  ])(
    "maps a Clerk $providerStatus invitation failure to a safe actionable response",
    async ({ providerStatus, responseStatus, providerCode, code, message }) => {
      mocks.createOrganizationInvitation.mockRejectedValue(
        new ClerkAPIResponseError("raw provider response", {
          status: providerStatus,
          data: [
            {
              code: providerCode,
              message: "sensitive upstream detail",
            },
          ],
        }),
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

  it("makes live Clerk invitation and sync behavior explicit in auth-bypass mode", async () => {
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
        message:
          "Clerk invitations are unavailable in development auth-bypass mode",
      },
    });
    expect(sync.status).toBe(200);
    await expect(sync.json()).resolves.toMatchObject({
      complete: true,
      seen: 0,
      created: 0,
      note: "Dev bypass — no Clerk org sync",
    });
    expect(mocks.createOrganizationInvitation).not.toHaveBeenCalled();
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
