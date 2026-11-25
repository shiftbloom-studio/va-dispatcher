import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyAccessToken: vi.fn(),
  findMembership: vi.fn(),
  provisionMembershipWithAudit: vi.fn(),
  recoverMembershipAsTenantAdmin: vi.fn(),
  upsertMembership: vi.fn(),
  findTenantByAuthOrgId: vi.fn(),
  upsertTenantBySlug: vi.fn(),
}));

vi.mock("../auth/token.js", () => ({
  verifyAccessToken: mocks.verifyAccessToken,
}));

vi.mock("../db/client.js", () => ({
  hasDatabase: () => true,
}));

vi.mock("../db/repositories/tenants.js", () => ({
  findTenantByAuthOrgId: mocks.findTenantByAuthOrgId,
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
import { requireAuth, requireUser, type AppVariables } from "./auth.js";

const app = new Hono<{ Variables: AppVariables }>();
app.onError(errorHandler);
app.use("*", requireAuth);
app.get("/", (c) => c.json(c.get("auth")));

const userApp = new Hono<{ Variables: AppVariables }>();
userApp.onError(errorHandler);
userApp.use("*", requireUser);
userApp.get("/", (c) => c.json(c.get("authUser")));

describe("identity organization claims", () => {
  beforeEach(() => {
    loadEnv({
      ...process.env,
      NODE_ENV: "test",
      CRON_SECRET: "test-cron-secret",
    });
    mocks.findTenantByAuthOrgId.mockResolvedValue({ id: "tenant_test" });
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

  it("maps the organization role claim", async () => {
    mocks.verifyAccessToken.mockResolvedValue({
      userId: "user_test",
      orgId: "org_test",
      orgRole: "admin",
    });

    const response = await app.request("/", {
      headers: { Authorization: "Bearer session-token" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      authUserId: "user_test",
      authOrgId: "org_test",
      role: "admin",
    });
    expect(mocks.provisionMembershipWithAudit).toHaveBeenCalledWith({
      tenantId: "tenant_test",
      authUserId: "user_test",
      role: "pilot",
    });
    expect(mocks.upsertMembership).not.toHaveBeenCalled();
    expect(mocks.recoverMembershipAsTenantAdmin).toHaveBeenCalled();
  });

  it("repairs the configured vSAS tenant when its org mapping is stale", async () => {
    loadEnv({
      ...process.env,
      NODE_ENV: "test",
      CRON_SECRET: "test-cron-secret",
      VSAS_AUTH_ORG_ID: "org_vsas",
    });
    mocks.verifyAccessToken.mockResolvedValue({
      userId: "user_test",
      orgId: "org_vsas",
      orgRole: "admin",
    });
    mocks.findTenantByAuthOrgId.mockResolvedValue(null);

    const response = await app.request("/", {
      headers: { Authorization: "Bearer session-token" },
    });

    expect(response.status).toBe(200);
    expect(mocks.upsertTenantBySlug).toHaveBeenCalledWith({
      slug: "vsas",
      name: "vSAS",
      authOrgId: "org_vsas",
    });
    expect(mocks.provisionMembershipWithAudit).toHaveBeenCalledWith({
      tenantId: "tenant_vsas",
      authUserId: "user_test",
      role: "pilot",
    });
  });

  it("does not provision an unconfigured organization", async () => {
    loadEnv({
      ...process.env,
      NODE_ENV: "test",
      CRON_SECRET: "test-cron-secret",
      VSAS_AUTH_ORG_ID: "org_vsas",
    });
    mocks.verifyAccessToken.mockResolvedValue({
      userId: "user_test",
      orgId: "org_other",
      orgRole: "admin",
    });
    mocks.findTenantByAuthOrgId.mockResolvedValue(null);

    const response = await app.request("/", {
      headers: { Authorization: "Bearer session-token" },
    });

    expect(response.status).toBe(403);
    expect(mocks.upsertTenantBySlug).not.toHaveBeenCalled();
    expect(mocks.provisionMembershipWithAudit).not.toHaveBeenCalled();
  });

  it("recovers a verified org admin only through the no-active-admin seam", async () => {
    mocks.verifyAccessToken.mockResolvedValue({
      userId: "user_recovery",
      orgId: "org_test",
      orgRole: "admin",
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

  it("keeps a newly provisioned org admin as pilot when recovery is not eligible", async () => {
    mocks.verifyAccessToken.mockResolvedValue({
      userId: "user_additional_admin",
      orgId: "org_test",
      orgRole: "admin",
    });
    mocks.recoverMembershipAsTenantAdmin.mockResolvedValue(null);

    const response = await app.request("/", {
      headers: { Authorization: "Bearer session-token" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ role: "pilot" });
    expect(mocks.provisionMembershipWithAudit).toHaveBeenCalledWith({
      tenantId: "tenant_test",
      authUserId: "user_additional_admin",
      role: "pilot",
    });
  });

  it("provisions a dispatcher role assigned through tenant administration", async () => {
    mocks.verifyAccessToken.mockResolvedValue({
      userId: "user_new_dispatcher",
      orgId: "org_test",
      orgRole: "dispatcher",
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
      authUserId: "user_new_dispatcher",
      role: "dispatcher",
    });
    expect(mocks.recoverMembershipAsTenantAdmin).not.toHaveBeenCalled();
    expect(mocks.upsertMembership).not.toHaveBeenCalled();
  });

  it("verifies a signed-in applicant without requiring an organization claim", async () => {
    mocks.verifyAccessToken.mockResolvedValue({
      userId: "user_applicant",
      orgId: null,
      orgRole: null,
    });

    const response = await userApp.request("/", {
      headers: { Authorization: "Bearer session-token" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      authUserId: "user_applicant",
    });
    expect(mocks.findTenantByAuthOrgId).not.toHaveBeenCalled();
    expect(mocks.findMembership).not.toHaveBeenCalled();
  });
});
