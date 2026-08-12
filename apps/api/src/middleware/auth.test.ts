import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyToken: vi.fn(),
  findMembership: vi.fn(),
  upsertMembership: vi.fn(),
}));

vi.mock("@clerk/backend", () => ({
  createClerkClient: vi.fn(),
  verifyToken: mocks.verifyToken,
}));

vi.mock("../db/client.js", () => ({
  hasDatabase: () => true,
}));

vi.mock("../db/repositories/tenants.js", () => ({
  findTenantByClerkOrgId: vi.fn(async () => ({ id: "tenant_test" })),
}));

vi.mock("../db/repositories/memberships.js", () => ({
  findMembership: mocks.findMembership,
  upsertMembership: mocks.upsertMembership,
}));

import { loadEnv, resetEnvCache } from "../env.js";
import { errorHandler } from "./error.js";
import { requireAuth, type AppVariables } from "./auth.js";

const app = new Hono<{ Variables: AppVariables }>();
app.onError(errorHandler);
app.use("*", requireAuth);
app.get("/", (c) => c.json(c.get("auth")));

describe("Clerk organization claims", () => {
  beforeEach(() => {
    loadEnv({
      ...process.env,
      NODE_ENV: "test",
      DATABASE_URL: "test-database",
      CLERK_SECRET_KEY: "test-clerk-secret",
      CRON_SECRET: "test-cron-secret",
    });
    mocks.findMembership.mockResolvedValue(null);
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
    expect(mocks.upsertMembership).toHaveBeenCalledWith(
      expect.objectContaining({ role: "admin" }),
    );
  });
});
