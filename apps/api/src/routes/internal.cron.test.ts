import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadEnv, resetEnvCache } from "../env.js";
import { errorHandler } from "../middleware/error.js";
import { internalRoutes } from "./internal.js";

const app = new Hono();
app.onError(errorHandler);
app.route("/", internalRoutes);

describe("ACARS polling cron", () => {
  beforeEach(() => {
    loadEnv({
      ...process.env,
      NODE_ENV: "test",
      ACARS_PROVIDER: "mock",
      CRON_SECRET: "test-cron-secret",
    });
  });

  afterEach(() => {
    resetEnvCache();
  });

  it("accepts the GET request sent by Vercel Cron", async () => {
    const response = await app.request("/internal/cron/acars-poll", {
      headers: { Authorization: "Bearer test-cron-secret" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      tenants: 0,
      messages: 0,
    });
  });

  it("keeps the endpoint protected", async () => {
    const response = await app.request("/internal/cron/acars-poll");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "UNAUTHORIZED",
        message: "Invalid cron secret",
      },
    });
  });
});
