import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runPrivacyLifecycleCron: vi.fn(),
}));

vi.mock("../domain/privacy/service.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../domain/privacy/service.js")>();
  return {
    ...actual,
    runPrivacyLifecycleCron: mocks.runPrivacyLifecycleCron,
  };
});
import { createApp } from "../app.js";
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
      DATABASE_URL: "postgresql://example.invalid/test",
    });
    mocks.runPrivacyLifecycleCron.mockResolvedValue({
      scheduled: 1,
      processed: 1,
      completed: 0,
      failed: 0,
    });
  });

  afterEach(() => {
    resetEnvCache();
  });

  it("accepts the GET request sent by Vercel Cron through the full app", async () => {
    const response = await createApp().request(
      "/api/v1/internal/cron/acars-poll",
      {
        headers: { Authorization: "Bearer test-cron-secret" },
      },
    );

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

  it("authenticates and bounds the privacy lifecycle cron", async () => {
    const response = await app.request(
      "/internal/cron/privacy-lifecycle?maxRuns=7",
      { headers: { Authorization: "Bearer test-cron-secret" } },
    );
    expect(response.status).toBe(200);
    expect(mocks.runPrivacyLifecycleCron).toHaveBeenCalledWith({ maxRuns: 7 });
    await expect(response.json()).resolves.toEqual({
      ok: true,
      scheduled: 1,
      processed: 1,
      completed: 0,
      failed: 0,
    });

    const unauthorized = await app.request("/internal/cron/privacy-lifecycle");
    expect(unauthorized.status).toBe(401);
    expect(mocks.runPrivacyLifecycleCron).toHaveBeenCalledTimes(1);
  });
});
