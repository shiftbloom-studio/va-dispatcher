import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hasDatabase: vi.fn(),
  verifyWorkspaceDatabaseSchema: vi.fn(),
}));

vi.mock("../db/client.js", () => ({
  hasDatabase: mocks.hasDatabase,
  verifyWorkspaceDatabaseSchema: mocks.verifyWorkspaceDatabaseSchema,
}));

import { healthRoutes } from "./health.js";

const app = new Hono();
app.route("/", healthRoutes);

describe("deployment readiness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasDatabase.mockReturnValue(true);
    mocks.verifyWorkspaceDatabaseSchema.mockResolvedValue(undefined);
  });

  it("confirms the configured database matches the workspace schema", async () => {
    const response = await app.request("/ready");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      service: "va-dispatch-api",
      database: true,
      schema: true,
    });
    expect(mocks.verifyWorkspaceDatabaseSchema).toHaveBeenCalledOnce();
  });

  it("fails closed when no database is configured", async () => {
    mocks.hasDatabase.mockReturnValue(false);

    const response = await app.request("/ready");

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      database: false,
      schema: false,
    });
    expect(mocks.verifyWorkspaceDatabaseSchema).not.toHaveBeenCalled();
  });

  it("does not expose schema or provider errors", async () => {
    mocks.verifyWorkspaceDatabaseSchema.mockRejectedValue(
      new Error('column "requested_role" does not exist'),
    );

    const response = await app.request("/ready");

    expect(response.status).toBe(503);
    const payload = await response.json();
    expect(payload).toEqual({
      ok: false,
      service: "va-dispatch-api",
      database: true,
      schema: false,
    });
    expect(JSON.stringify(payload)).not.toContain("requested_role");
  });
});
