import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyToken: vi.fn(),
  findMembership: vi.fn(),
  provisionMembershipWithAudit: vi.fn(),
  recoverMembershipAsTenantAdmin: vi.fn(),
  upsertMembership: vi.fn(),
  findTenantByClerkOrgId: vi.fn(),
  upsertTenantBySlug: vi.fn(),
}));

vi.mock("@clerk/backend", () => ({
  createClerkClient: vi.fn(),
  verifyToken: mocks.verifyToken,
}));

vi.mock("../db/client.js", () => ({
  hasDatabase: () => true,
}));

vi.mock("../db/repositories/tenants.js", () => ({
  findTenantByClerkOrgId: mocks.findTenantByClerkOrgId,
  upsertTenantBySlug: mocks.upsertTenantBySlug,
}));

vi.mock("../db/repositories/memberships.js", () => ({
  findMembership: mocks.findMembership,
  provisionMembershipWithAudit: mocks.provisionMembershipWithAudit,
  recoverMembershipAsTenantAdmin: mocks.recoverMembershipAsTenantAdmin,
  upsertMembership: mocks.upsertMembership,
}));

import { loadEnv, resetEnvCache } from "../env.js";
import { errorHandler } from "./error.js";
import { requireAuth, requireClerkUser, type AppVariables } from "./auth.js";

const app = new Hono<{ Variables: AppVariables }>();
app.onError(errorHandler);
app.use("*", requireAuth);
app.get("/", (c) => c.json(c.get("auth")));

const clerkUserApp = new Hono<{ Variables: AppVariables }>();
clerkUserApp.onError(errorHandler);
clerkUserApp.use("*", requireClerkUser);
clerkUserApp.get("/", (c) => c.json(c.get("clerkUser")));

describe("Clerk organization claims", () => {
  beforeEach(() => {
    loadEnv({
      ...process.env,
      NODE_ENV: "test",
      DATABASE_URL: "test-database",
      CLERK_SECRET_KEY: "test-clerk-secret",
      CRON_SECRET: "test-cron-secret",
    });
    mocks.findTenantByClerkOrgId.mockResolvedValue({ id: "tenant_test" });
    mocks.upsertTenantBySlug.mockResolvedValue({ id: "tenant_vsas" });
    mocks.findMembership.mockResolvedValue(null);
    mocks.recoverMembershipAsTenantAdmin.mockImplementation(
      async ({ membershipId }) => ({
        id: membershipId,
        role: "admin",
        status: "active",
      }),
    );
    mocks.provisionMembershipWithAudit.mockImplementation(async (input) => ({
      id: "membership_test",
      role: input.role,
      status: "active",
    }));
    mocks.upsertMembership.mockImplementation(async (input) => ({
      id: "membership_test",
      role: input.role,
      status: "active",
    }));
  });

  afterEach(() => {
    vi.clearAllMocks();
    resetEnvCache();
  });

  it("maps Clerk's compact organization role claim", async () => {
    mocks.verifyToken.mockResolvedValue({
      sub: "user_test",
      o: { id: "org_test", rol: "admin", slg: "vsas" },
    });

    const response = await app.request("/", {
      headers: { Authorization: "Bearer session-token" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      clerkUserId: "user_test",
      clerkOrgId: "org_test",
      role: "admin",
    });
    expect(mocks.provisionMembershipWithAudit).toHaveBeenCalledWith({
      tenantId: "tenant_test",
      clerkUserId: "user_test",
      role: "pilot",
    });
    expect(mocks.upsertMembership).not.toHaveBeenCalled();
    expect(mocks.recoverMembershipAsTenantAdmin).toHaveBeenCalled();
  });

  it("repairs the configured vSAS tenant when its Clerk org mapping is stale", async () => {
    loadEnv({
      ...process.env,
      NODE_ENV: "test",
      DATABASE_URL: "test-database",
      CLERK_SECRET_KEY: "test-clerk-secret",
      CRON_SECRET: "test-cron-secret",
      VSAS_CLERK_ORG_ID: "org_vsas",
    });
    mocks.verifyToken.mockResolvedValue({
      sub: "user_test",
      o: { id: "org_vsas", rol: "admin", slg: "vsas" },
    });
    mocks.findTenantByClerkOrgId.mockResolvedValue(null);

    const response = await app.request("/", {
      headers: { Authorization: "Bearer session-token" },
    });

    expect(response.status).toBe(200);
    expect(mocks.upsertTenantBySlug).toHaveBeenCalledWith({
      slug: "vsas",
      name: "vSAS",
      clerkOrgId: "org_vsas",
    });
    expect(mocks.provisionMembershipWithAudit).toHaveBeenCalledWith({
      tenantId: "tenant_vsas",
      clerkUserId: "user_test",
      role: "pilot",
    });
  });

  it("does not provision an unconfigured Clerk organization", async () => {
    loadEnv({
      ...process.env,
      NODE_ENV: "test",
      DATABASE_URL: "test-database",
      CLERK_SECRET_KEY: "test-clerk-secret",
      CRON_SECRET: "test-cron-secret",
      VSAS_CLERK_ORG_ID: "org_vsas",
    });
    mocks.verifyToken.mockResolvedValue({
      sub: "user_test",
      o: { id: "org_other", rol: "admin", slg: "other" },
    });
    mocks.findTenantByClerkOrgId.mockResolvedValue(null);

    const response = await app.request("/", {
      headers: { Authorization: "Bearer session-token" },
    });

    expect(response.status).toBe(403);
    expect(mocks.upsertTenantBySlug).not.toHaveBeenCalled();
    expect(mocks.provisionMembershipWithAudit).not.toHaveBeenCalled();
  });

  it("recovers a verified Clerk admin only through the no-active-admin seam", async () => {
    mocks.verifyToken.mockResolvedValue({
      sub: "user_recovery",
      o: { id: "org_test", rol: "admin" },
    });
    mocks.findMembership.mockResolvedValue({
      id: "membership_recovery",
      role: "pilot",
      status: "disabled",
    });
    mocks.recoverMembershipAsTenantAdmin.mockResolvedValue({
      id: "membership_recovery",
      role: "admin",
      status: "active",
    });

    const response = await app.request("/", {
      headers: { Authorization: "Bearer session-token" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      membershipId: "membership_recovery",
      role: "admin",
    });
    expect(mocks.recoverMembershipAsTenantAdmin).toHaveBeenCalledWith({
      tenantId: "tenant_test",
      membershipId: "membership_recovery",
    });
  });

  it("keeps a newly provisioned Clerk admin as pilot when recovery is not eligible", async () => {
    mocks.verifyToken.mockResolvedValue({
      sub: "user_additional_admin",
      o: { id: "org_test", rol: "admin" },
    });
    mocks.recoverMembershipAsTenantAdmin.mockResolvedValue(null);

    const response = await app.request("/", {
      headers: { Authorization: "Bearer session-token" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ role: "pilot" });
    expect(mocks.provisionMembershipWithAudit).toHaveBeenCalledWith({
      tenantId: "tenant_test",
      clerkUserId: "user_additional_admin",
      role: "pilot",
    });
  });

  it("provisions a dispatcher role assigned through Clerk tenant administration", async () => {
    mocks.verifyToken.mockResolvedValue({
      sub: "user_new_dispatcher",
      o: { id: "org_test", rol: "dispatcher" },
    });

    const response = await app.request("/", {
      headers: { Authorization: "Bearer session-token" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      role: "dispatcher",
    });
    expect(mocks.provisionMembershipWithAudit).toHaveBeenCalledWith({
      tenantId: "tenant_test",
      clerkUserId: "user_new_dispatcher",
      role: "dispatcher",
    });
    expect(mocks.recoverMembershipAsTenantAdmin).not.toHaveBeenCalled();
    expect(mocks.upsertMembership).not.toHaveBeenCalled();
  });

  it("verifies a signed-in applicant without requiring an organization claim", async () => {
    mocks.verifyToken.mockResolvedValue({ sub: "user_applicant" });

    const response = await clerkUserApp.request("/", {
      headers: { Authorization: "Bearer session-token" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      clerkUserId: "user_applicant",
    });
    expect(mocks.findTenantByClerkOrgId).not.toHaveBeenCalled();
    expect(mocks.findMembership).not.toHaveBeenCalled();
  });
});
