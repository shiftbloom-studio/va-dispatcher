import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Tenant } from "../db/schema.js";

const state = vi.hoisted(() => ({
  role: "pilot" as "pilot" | "dispatcher" | "admin",
  ping: vi.fn(),
  encryptSecret: vi.fn(),
  decryptSecret: vi.fn(),
  findTenantById: vi.fn(),
  updateTenant: vi.fn(),
  updateOrganization: vi.fn(),
  writeAudit: vi.fn(),
}));

vi.mock("../middleware/auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middleware/auth.js")>();
  return {
    ...actual,
    requireAuth: createMiddleware(async (c, next) => {
      c.set("auth", {
        clerkUserId: "user_test",
        tenantId: "tenant_test",
        membershipId: "membership_test",
        role: state.role,
        clerkOrgId: "org_test",
      });
      await next();
    }),
    getClerkClient: () => ({
      organizations: { updateOrganization: state.updateOrganization },
    }),
  };
});
vi.mock("../db/repositories/tenants.js", () => ({
  findTenantById: state.findTenantById,
  updateTenant: state.updateTenant,
}));
vi.mock("../db/repositories/audit.js", () => ({
  writeAudit: state.writeAudit,
}));
vi.mock("../lib/crypto.js", () => ({
  encryptSecret: state.encryptSecret,
  decryptSecret: state.decryptSecret,
}));
vi.mock("../acars/hoppie-provider.js", () => ({
  HoppieAcarsProvider: class {
    ping = state.ping;
  },
}));
vi.mock("../acars/factory.js", () => ({
  activeAcarsProviderName: () => "hoppie",
}));
vi.mock("../domain/acars/service.js", () => ({
  publicProviderError: (error: unknown) => error,
}));

import { errorHandler } from "../middleware/error.js";
import { tenantRoutes } from "./tenant.js";

const baseTenant: Tenant = {
  id: "tenant_test",
  slug: "vsas",
  name: "Virtual SAS",
  clerkOrgId: "org_test",
  hoppieStation: "VSAS",
  hoppieLogonEnc: null,
  brandSeedColor: "#e64646",
  brandPresence: "balanced",
  brandLogoUrl: null,
  brandLogoPathname: null,
  settings: {},
  createdAt: new Date("2026-08-12T00:00:00.000Z"),
  updatedAt: new Date("2026-08-12T00:00:00.000Z"),
};

const app = new Hono();
app.onError(errorHandler);
app.route("/", tenantRoutes);

describe("tenant organization configuration", () => {
  let tenant: Tenant;

  beforeEach(() => {
    vi.clearAllMocks();
    state.role = "pilot";
    tenant = { ...baseTenant, settings: {} };
    state.findTenantById.mockImplementation(async () => tenant);
    state.encryptSecret.mockReturnValue("encrypted-new-logon");
    state.decryptSecret.mockReturnValue("existing-logon");
    state.ping.mockResolvedValue(true);
    state.updateOrganization.mockResolvedValue({});
    state.updateTenant.mockImplementation(
      async (_tenantId: string, patch: Partial<Tenant>) => {
        tenant = { ...tenant, ...patch, updatedAt: new Date() };
        return tenant;
      },
    );
  });

  it("exposes connection status but never the encrypted credential", async () => {
    tenant = { ...tenant, hoppieLogonEnc: "encrypted-existing-logon" };

    const response = await app.request("/tenant");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      acarsProvider: "hoppie",
      hoppiePollingEnabled: true,
      hoppieStation: "VSAS",
      hasHoppieLogon: true,
    });
    expect(body).not.toHaveProperty("hoppieLogon");
    expect(body).not.toHaveProperty("hoppieLogonEnc");
    expect(body).toMatchObject({
      brand: {
        seedColor: "#e64646",
        presence: "balanced",
        logoUrl: null,
      },
    });
  });

  it("forbids non-admin brand changes", async () => {
    state.role = "dispatcher";
    const response = await app.request("/tenant/brand", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seedColor: "#174EA6", presence: "high" }),
    });

    expect(response.status).toBe(403);
    expect(state.updateTenant).not.toHaveBeenCalled();
  });

  it("normalizes and audits an admin brand change", async () => {
    state.role = "admin";
    const response = await app.request("/tenant/brand", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seedColor: "#174EA6", presence: "high" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      brand: {
        seedColor: "#174ea6",
        presence: "high",
        logoUrl: null,
      },
    });
    expect(state.updateTenant).toHaveBeenCalledWith("tenant_test", {
      brandSeedColor: "#174ea6",
      brandPresence: "high",
    });
    expect(state.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "tenant.brand_update" }),
    );
  });

  it("lets only admins configure application roles and invitation expiry", async () => {
    const payload = {
      memberAccess: {
        applicationsEnabled: true,
        pilotApplicationsEnabled: true,
        dispatcherApplicationsEnabled: false,
        invitationExpiryDays: 14,
      },
    };

    state.role = "dispatcher";
    const forbidden = await app.request("/tenant", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(forbidden.status).toBe(403);

    state.role = "admin";
    const response = await app.request("/tenant", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      memberAccess: payload.memberAccess,
      clerkSynchronized: true,
    });
    expect(state.updateTenant).toHaveBeenCalledWith("tenant_test", {
      settings: { memberAccess: payload.memberAccess },
    });
    expect(state.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant_test",
        action: "tenant.patch",
        meta: expect.objectContaining({ fields: ["memberAccess"] }),
      }),
    );
  });

  it("rejects an open application policy with no eligible roles", async () => {
    state.role = "admin";
    const response = await app.request("/tenant", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        memberAccess: {
          applicationsEnabled: true,
          pilotApplicationsEnabled: false,
          dispatcherApplicationsEnabled: false,
          invitationExpiryDays: 30,
        },
      }),
    });

    expect(response.status).toBe(400);
    expect(state.updateTenant).not.toHaveBeenCalled();
  });

  it("rejects attempts to bypass the typed membership-access policy", async () => {
    state.role = "admin";
    const response = await app.request("/tenant", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        settings: {
          memberAccess: {
            applicationsEnabled: true,
            invitationExpiryDays: 365,
          },
        },
      }),
    });

    expect(response.status).toBe(400);
    expect(state.updateTenant).not.toHaveBeenCalled();
  });

  it("synchronizes the tenant name to Clerk before persisting it locally", async () => {
    state.role = "admin";
    const response = await app.request("/tenant", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Scandinavian Virtual" }),
    });

    expect(response.status).toBe(200);
    expect(state.updateOrganization).toHaveBeenCalledWith("org_test", {
      name: "Scandinavian Virtual",
    });
    expect(state.updateOrganization.mock.invocationCallOrder[0]).toBeLessThan(
      state.updateTenant.mock.invocationCallOrder[0]!,
    );
  });

  it.each([
    { method: "PUT", path: "/tenant/acars-config" },
    { method: "POST", path: "/tenant/acars-config/test" },
    { method: "DELETE", path: "/tenant/acars-config" },
  ])("forbids a pilot from $method $path", async ({ method, path }) => {
    const response = await app.request(path, {
      method,
      headers:
        method === "PUT" ? { "Content-Type": "application/json" } : undefined,
      body:
        method === "PUT"
          ? JSON.stringify({ hoppieStation: "SAS", hoppieLogon: "secret" })
          : undefined,
    });

    expect(response.status).toBe(403);
  });

  it("forbids a dispatcher from changing the organization credential", async () => {
    state.role = "dispatcher";

    const response = await app.request("/tenant/acars-config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        hoppieStation: "SAS",
        hoppieLogon: "secret",
      }),
    });

    expect(response.status).toBe(403);
    expect(state.ping).not.toHaveBeenCalled();
    expect(state.updateTenant).not.toHaveBeenCalled();
  });

  it("tests a new credential before saving its encrypted value", async () => {
    state.role = "admin";

    const response = await app.request("/tenant/acars-config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        hoppieStation: "sas",
        hoppieLogon: "new-logon",
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(state.ping).toHaveBeenCalledWith({ station: "SAS" });
    expect(state.encryptSecret).toHaveBeenCalledWith("new-logon", undefined);
    expect(state.updateTenant).toHaveBeenCalledWith(
      "tenant_test",
      expect.objectContaining({
        hoppieStation: "SAS",
        hoppieLogonEnc: "encrypted-new-logon",
      }),
    );
    expect(body).toMatchObject({
      acarsProvider: "hoppie",
      hoppiePollingEnabled: true,
      hoppieStation: "SAS",
      hasHoppieLogon: true,
    });
    expect(body).not.toHaveProperty("hoppieLogon");
    expect(body).not.toHaveProperty("hoppieLogonEnc");
  });

  it("removes Hoppie credentials without falling back to mock", async () => {
    state.role = "admin";
    tenant = { ...tenant, hoppieStation: "SAS", hoppieLogonEnc: "encrypted" };

    const response = await app.request("/tenant/acars-config", {
      method: "DELETE",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      acarsProvider: "hoppie",
      hoppiePollingEnabled: false,
      hoppieStation: "SAS",
      hasHoppieLogon: false,
    });
  });
});
