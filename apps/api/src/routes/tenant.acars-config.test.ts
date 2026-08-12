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
  tenantAcarsProviderName: (tenant: Tenant) =>
    tenant.hoppieLogonEnc ? "hoppie" : "mock",
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
  settings: {},
  createdAt: new Date("2026-08-12T00:00:00.000Z"),
  updatedAt: new Date("2026-08-12T00:00:00.000Z"),
};

const app = new Hono();
app.onError(errorHandler);
app.route("/", tenantRoutes);

describe("tenant Hoppie configuration", () => {
  let tenant: Tenant;

  beforeEach(() => {
    vi.clearAllMocks();
    state.role = "pilot";
    tenant = { ...baseTenant, settings: {} };
    state.findTenantById.mockImplementation(async () => tenant);
    state.encryptSecret.mockReturnValue("encrypted-new-logon");
    state.decryptSecret.mockReturnValue("existing-logon");
    state.ping.mockResolvedValue(true);
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
      hoppiePollingEnabled: false,
      hoppieStation: "VSAS",
      hasHoppieLogon: true,
    });
    expect(body).not.toHaveProperty("hoppieLogon");
    expect(body).not.toHaveProperty("hoppieLogonEnc");
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
      hoppiePollingEnabled: false,
      hoppieStation: "SAS",
      hasHoppieLogon: true,
    });
    expect(body).not.toHaveProperty("hoppieLogon");
    expect(body).not.toHaveProperty("hoppieLogonEnc");
  });

  it("disconnects Hoppie without deleting the station identity", async () => {
    state.role = "admin";
    tenant = { ...tenant, hoppieStation: "SAS", hoppieLogonEnc: "encrypted" };

    const response = await app.request("/tenant/acars-config", {
      method: "DELETE",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      acarsProvider: "mock",
      hoppiePollingEnabled: false,
      hoppieStation: "SAS",
      hasHoppieLogon: false,
    });
  });
});
