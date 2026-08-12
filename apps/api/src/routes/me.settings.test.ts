import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  role: "pilot" as "pilot" | "dispatcher" | "admin",
  findMembership: vi.fn(),
  findMembershipByCallsign: vi.fn(),
  updateMembership: vi.fn(),
  findTenantById: vi.fn(),
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
        role: mocks.role,
        clerkOrgId: "org_test",
      });
      await next();
    }),
  };
});
vi.mock("../db/repositories/memberships.js", () => ({
  findMembership: mocks.findMembership,
  findMembershipByCallsign: mocks.findMembershipByCallsign,
  updateMembership: mocks.updateMembership,
}));
vi.mock("../db/repositories/tenants.js", () => ({
  findTenantById: mocks.findTenantById,
}));
vi.mock("../db/repositories/audit.js", () => ({
  writeAudit: mocks.writeAudit,
}));

import { errorHandler } from "../middleware/error.js";
import { meRoutes } from "./me.js";

const app = new Hono();
app.onError(errorHandler);
app.route("/", meRoutes);

describe("member account settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.role = "pilot";
    mocks.findMembershipByCallsign.mockResolvedValue(null);
    mocks.updateMembership.mockResolvedValue({
      id: "membership_test",
      tenantId: "tenant_test",
      clerkUserId: "user_test",
      role: "pilot",
      displayName: "Fabian",
      pilotCallsign: "SAS123",
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  it("lets a pilot update only their own normalized ACARS callsign", async () => {
    const response = await app.request("/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        displayName: " Fabian ",
        pilotCallsign: "sas123",
      }),
    });

    expect(response.status).toBe(200);
    expect(mocks.updateMembership).toHaveBeenCalledWith(
      "tenant_test",
      "membership_test",
      { displayName: "Fabian", pilotCallsign: "SAS123" },
    );
    await expect(response.json()).resolves.toMatchObject({
      membership: { id: "membership_test", pilotCallsign: "SAS123" },
    });
  });

  it("lets a dispatcher maintain their own ACARS callsign", async () => {
    mocks.role = "dispatcher";
    mocks.updateMembership.mockResolvedValue({
      id: "membership_test",
      tenantId: "tenant_test",
      clerkUserId: "user_test",
      role: "dispatcher",
      displayName: "Dispatcher",
      pilotCallsign: "OPS123",
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const response = await app.request("/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pilotCallsign: "ops123" }),
    });

    expect(response.status).toBe(200);
    expect(mocks.updateMembership).toHaveBeenCalledWith(
      "tenant_test",
      "membership_test",
      { pilotCallsign: "OPS123" },
    );
  });

  it("rejects a callsign already assigned within the tenant", async () => {
    mocks.findMembershipByCallsign.mockResolvedValue({
      id: "membership_other",
    });

    const response = await app.request("/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pilotCallsign: "SAS123" }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "CONFLICT" },
    });
    expect(mocks.updateMembership).not.toHaveBeenCalled();
  });

  it("rejects callsigns that cannot be entered in an aircraft client", async () => {
    const response = await app.request("/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pilotCallsign: "SAS_123" }),
    });

    expect(response.status).toBe(400);
    expect(mocks.updateMembership).not.toHaveBeenCalled();
  });
});
