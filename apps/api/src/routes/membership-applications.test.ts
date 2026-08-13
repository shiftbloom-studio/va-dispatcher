import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMembership: vi.fn(),
  submitMembershipApplicationWithAudit: vi.fn(),
  cancelMembershipApplicationWithAudit: vi.fn(),
  findTenantBySlug: vi.fn(),
  getClerkClient: vi.fn(),
}));

vi.mock("../middleware/auth.js", async () => {
  const { createMiddleware: middleware } = await import("hono/factory");
  return {
    requireClerkUser: middleware(async (c, next) => {
      c.set("clerkUser", { clerkUserId: "user-applicant" });
      await next();
    }),
    getClerkClient: mocks.getClerkClient,
  };
});

vi.mock("../db/repositories/memberships.js", () => ({
  findMembership: mocks.findMembership,
  submitMembershipApplicationWithAudit:
    mocks.submitMembershipApplicationWithAudit,
  cancelMembershipApplicationWithAudit:
    mocks.cancelMembershipApplicationWithAudit,
}));

vi.mock("../db/repositories/tenants.js", () => ({
  findTenantBySlug: mocks.findTenantBySlug,
}));

import { errorHandler } from "../middleware/error.js";
import { membershipApplicationRoutes } from "./membership-applications.js";

const app = new Hono();
app.onError(errorHandler);
app.route("/", membershipApplicationRoutes);

const pendingMembership = {
  id: "27000000-0000-4000-8000-000000000001",
  tenantId: "tenant-vsas",
  clerkUserId: "user-applicant",
  role: "dispatcher" as const,
  displayName: "Verified Applicant",
  pilotCallsign: null,
  status: "invited" as const,
  settings: {},
  createdAt: new Date("2026-08-13T08:00:00.000Z"),
  updatedAt: new Date("2026-08-13T08:00:00.000Z"),
};

describe("membership application routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findTenantBySlug.mockImplementation(async (slug: string) =>
      slug === "vsas"
        ? {
            id: "tenant-vsas",
            slug: "vsas",
            settings: {
              memberAccess: {
                applicationsEnabled: true,
                pilotApplicationsEnabled: true,
                dispatcherApplicationsEnabled: true,
                invitationExpiryDays: 14,
              },
            },
          }
        : null,
    );
    mocks.findMembership.mockResolvedValue(null);
    mocks.getClerkClient.mockReturnValue({
      users: {
        getUser: vi.fn().mockResolvedValue({
          fullName: "Verified Applicant",
          primaryEmailAddress: {
            emailAddress: "applicant@example.test",
            verification: { status: "verified" },
          },
        }),
      },
    });
    mocks.submitMembershipApplicationWithAudit.mockResolvedValue({
      membership: pendingMembership,
      submitted: true,
    });
    mocks.cancelMembershipApplicationWithAudit.mockResolvedValue({
      ...pendingMembership,
      status: "disabled",
      updatedAt: new Date("2026-08-13T09:00:00.000Z"),
    });
  });

  it("submits for a server-resolved tenant without requiring organization context", async () => {
    const response = await app.request("/membership-application", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tenantSlug: "VSAS",
        requestedRole: "dispatcher",
        tenantId: "attacker-controlled",
        clerkUserId: "attacker-controlled",
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.findTenantBySlug).toHaveBeenCalledWith("vsas");
    expect(mocks.submitMembershipApplicationWithAudit).toHaveBeenCalledWith({
      tenantId: "tenant-vsas",
      clerkUserId: "user-applicant",
      requestedRole: "dispatcher",
      displayName: "Verified Applicant",
    });
    await expect(response.json()).resolves.toMatchObject({
      applicationsEnabled: true,
      allowedRoles: ["pilot", "dispatcher"],
      application: {
        state: "pending",
        requestedRole: "dispatcher",
      },
      submitted: true,
    });
  });

  it("does not expose another tenant's membership through a caller-supplied ID", async () => {
    const response = await app.request(
      "/membership-application?tenantSlug=other&tenantId=tenant-vsas",
    );

    expect(response.status).toBe(404);
    expect(mocks.findMembership).not.toHaveBeenCalled();
  });

  it("blocks roles disabled by tenant policy before storing an application", async () => {
    mocks.findTenantBySlug.mockResolvedValue({
      id: "tenant-vsas",
      slug: "vsas",
      settings: {
        memberAccess: {
          applicationsEnabled: true,
          pilotApplicationsEnabled: true,
          dispatcherApplicationsEnabled: false,
          invitationExpiryDays: 30,
        },
      },
    });

    const response = await app.request("/membership-application", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tenantSlug: "vsas",
        requestedRole: "dispatcher",
      }),
    });

    expect(response.status).toBe(403);
    expect(mocks.getClerkClient).not.toHaveBeenCalled();
    expect(mocks.submitMembershipApplicationWithAudit).not.toHaveBeenCalled();
  });

  it("cancels only the caller's pending application in the resolved tenant", async () => {
    const response = await app.request(
      "/membership-application?tenantSlug=vsas",
      { method: "DELETE" },
    );

    expect(response.status).toBe(200);
    expect(mocks.cancelMembershipApplicationWithAudit).toHaveBeenCalledWith({
      tenantId: "tenant-vsas",
      clerkUserId: "user-applicant",
    });
    await expect(response.json()).resolves.toMatchObject({
      application: { state: "closed", requestedRole: "dispatcher" },
    });
  });
});
