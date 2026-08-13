import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
import { membersRoutes } from "./members.js";
import { auditRoutes } from "./audit.js";

const app = new Hono();
app.onError(errorHandler);
app.route("/", membersRoutes);
app.route("/", auditRoutes);
app.get("/mounted-after-admin-probe", (c) => c.json({ ok: true }));

describe("admin control-plane routes", () => {
  beforeEach(() => {
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
