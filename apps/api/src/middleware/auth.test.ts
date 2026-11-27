import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyAccessToken: vi.fn(),
  findMembership: vi.fn(),
  provisionMembershipWithAudit: vi.fn(),
  recoverMembershipAsTenantAdmin: vi.fn(),
  upsertMembership: vi.fn(),
  findTenantByAuthOrgId: vi.fn(),
  findTenantBySlug: vi.fn(),
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
  findTenantBySlug: mocks.findTenantBySlug,
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
    mocks.findTenantByAuthOrgId.mockImplementation(async (orgId: string) =>
      orgId === "org_test"
        ? { id: "tenant_test", slug: "test", authOrgId: "org_test" }
        : null,
    );
    mocks.findTenantBySlug.mockImplementation(async (slug: string) =>
      slug === "test"
        ? { id: "tenant_test", slug: "test", authOrgId: "org_test" }
        : slug === "other"
          ? { id: "tenant_other", slug: "other", authOrgId: "org_other" }
          : null,
    );
    mocks.upsertTenantBySlug.mockResolvedValue({
      id: "tenant_vsas",
      slug: "vsas",
      authOrgId: "org_vsas",
    });
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
      orgs: { org_test: "admin" },
      email: null,
      emailVerified: false,
      name: null,
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
      orgs: { org_vsas: "admin" },
      email: null,
      emailVerified: false,
      name: null,
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
      orgs: { org_other: "admin" },
      email: null,
      emailVerified: false,
      name: null,
    });
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
      orgs: { org_test: "admin" },
      email: null,
      emailVerified: false,
      name: null,
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
      orgs: { org_test: "admin" },
      email: null,
      emailVerified: false,
      name: null,
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
      orgs: { org_test: "dispatcher" },
      email: null,
      emailVerified: false,
      name: null,
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
      orgs: {},
      email: "applicant@example.test",
      emailVerified: true,
      name: "Applicant",
    });

    const response = await userApp.request("/", {
      headers: { Authorization: "Bearer session-token" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      authUserId: "user_applicant",
      email: "applicant@example.test",
      emailVerified: true,
      name: "Applicant",
    });
    expect(mocks.findTenantByAuthOrgId).not.toHaveBeenCalled();
    expect(mocks.findMembership).not.toHaveBeenCalled();
  });

  it("picks the tenant from the slug header and checks the orgs claim", async () => {
    mocks.verifyAccessToken.mockResolvedValue({
      userId: "user_multi",
      orgs: { org_test: "member", org_other: "dispatcher" },
      email: null,
      emailVerified: false,
      name: null,
    });

    const response = await app.request("/", {
      headers: {
        Authorization: "Bearer session-token",
        "X-Tenant-Slug": "Other",
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      tenantId: "tenant_other",
      authOrgId: "org_other",
      role: "dispatcher",
    });
  });

  it("rejects a tenant the caller does not belong to", async () => {
    mocks.verifyAccessToken.mockResolvedValue({
      userId: "user_test",
      orgs: { org_test: "admin" },
      email: null,
      emailVerified: false,
      name: null,
    });

    const response = await app.request("/", {
      headers: {
        Authorization: "Bearer session-token",
        "X-Tenant-Slug": "other",
      },
    });

    expect(response.status).toBe(403);
    expect(mocks.findMembership).not.toHaveBeenCalled();
  });

  it("asks for a tenant when the token holds several organizations", async () => {
    mocks.findTenantByAuthOrgId.mockImplementation(async (orgId: string) =>
      orgId === "org_test"
        ? { id: "tenant_test", slug: "test", authOrgId: "org_test" }
        : orgId === "org_other"
          ? { id: "tenant_other", slug: "other", authOrgId: "org_other" }
          : null,
    );
    mocks.verifyAccessToken.mockResolvedValue({
      userId: "user_multi",
      orgs: { org_test: "member", org_other: "member" },
      email: null,
      emailVerified: false,
      name: null,
    });

    const response = await app.request("/", {
      headers: { Authorization: "Bearer session-token" },
    });

    expect(response.status).toBe(403);
    expect(mocks.findMembership).not.toHaveBeenCalled();
  });

  it("ignores token organizations that are not tenants", async () => {
    mocks.verifyAccessToken.mockResolvedValue({
      userId: "user_multi",
      orgs: { org_stem_wide: "member", org_test: "admin" },
      primaryOrg: "org_stem_wide",
      email: null,
      emailVerified: false,
      name: null,
    });

    const response = await app.request("/", {
      headers: { Authorization: "Bearer session-token" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      tenantId: "tenant_test",
      authOrgId: "org_test",
    });
  });

  it("falls back to the primary team when several tenants match", async () => {
    mocks.findTenantByAuthOrgId.mockImplementation(async (orgId: string) =>
      orgId === "org_test"
        ? { id: "tenant_test", slug: "test", authOrgId: "org_test" }
        : orgId === "org_other"
          ? { id: "tenant_other", slug: "other", authOrgId: "org_other" }
          : null,
    );
    mocks.verifyAccessToken.mockResolvedValue({
      userId: "user_multi",
      orgs: { org_test: "member", org_other: "dispatcher" },
      primaryOrg: "org_other",
      email: null,
      emailVerified: false,
      name: null,
    });

    const response = await app.request("/", {
      headers: { Authorization: "Bearer session-token" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      tenantId: "tenant_other",
      role: "dispatcher",
    });
  });

  it("asks for a tenant when several match and the primary team is none of them", async () => {
    mocks.findTenantByAuthOrgId.mockImplementation(async (orgId: string) =>
      orgId === "org_test"
        ? { id: "tenant_test", slug: "test", authOrgId: "org_test" }
        : orgId === "org_other"
          ? { id: "tenant_other", slug: "other", authOrgId: "org_other" }
          : null,
    );
    mocks.verifyAccessToken.mockResolvedValue({
      userId: "user_multi",
      orgs: {
        org_test: "member",
        org_other: "member",
        org_stem_wide: "member",
      },
      primaryOrg: "org_stem_wide",
      email: null,
      emailVerified: false,
      name: null,
    });

    const response = await app.request("/", {
      headers: { Authorization: "Bearer session-token" },
    });

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(JSON.stringify(body)).toContain("X-Tenant-Slug");
    expect(JSON.stringify(body)).toContain('"tenants":["test","other"]');
    expect(mocks.findMembership).not.toHaveBeenCalled();
  });

  it("treats an organization owner as a tenant admin", async () => {
    mocks.verifyAccessToken.mockResolvedValue({
      userId: "user_owner",
      orgs: { org_test: "owner" },
      email: null,
      emailVerified: false,
      name: null,
    });

    await app.request("/", {
      headers: { Authorization: "Bearer session-token" },
    });

    expect(mocks.recoverMembershipAsTenantAdmin).toHaveBeenCalled();
  });
});
