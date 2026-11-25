import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

import { botCheckLevel, requireHuman } from "./human.js";
import { loadEnv, resetEnvCache } from "../env.js";

function requestWithScore(score: number | null, init: RequestInit = {}) {
  const request = new Request("http://api.test/api/v1/schedule-requests", {
    method: "POST",
    ...init,
  });
  if (score !== null) {
    Object.defineProperty(request, "cf", {
      value: { botManagement: { score, verifiedBot: false } },
    });
  }
  return request;
}

function protectedApp() {
  const handler = vi.fn((c) => c.json({ ok: true }));
  const app = new Hono();
  app.use("*", requireHuman);
  app.post("/api/v1/schedule-requests", handler);
  app.post("/api/v1/flights/bulk", handler);
  return { app, handler };
}

describe("bot protection policy", () => {
  afterEach(() => resetEnvCache());

  it("uses the strict level for high-cost and external-provider mutations", () => {
    expect(botCheckLevel("POST", "/api/v1/flights/bulk")).toBe("strict");
    expect(botCheckLevel("PUT", "/v1/tenant/acars-config")).toBe("strict");
  });

  it("uses the basic level for other mutations and skips reads and internal routes", () => {
    expect(botCheckLevel("POST", "/api/v1/schedule-requests")).toBe("basic");
    expect(botCheckLevel("PATCH", "/api/v1/me")).toBe("basic");
    expect(botCheckLevel("DELETE", "/api/v1/members/member-id")).toBe("basic");
    expect(botCheckLevel("GET", "/api/v1/flights")).toBeNull();
    expect(botCheckLevel("POST", "/api/v1/internal/cron/acars-poll")).toBeNull();
  });

  it("blocks automated requests before protected handlers run", async () => {
    const { app, handler } = protectedApp();
    const response = await app.request(requestWithScore(1));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "FORBIDDEN",
        message: "Automated requests are not allowed.",
      },
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("applies the stricter threshold only to strict routes", async () => {
    const { app, handler } = protectedApp();
    expect((await app.request(requestWithScore(20))).status).toBe(200);
    const strict = new Request("http://api.test/api/v1/flights/bulk", {
      method: "POST",
    });
    Object.defineProperty(strict, "cf", {
      value: { botManagement: { score: 20, verifiedBot: false } },
    });
    expect((await app.request(strict)).status).toBe(403);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("passes requests without a bot score to the zone-level defences", async () => {
    const { app, handler } = protectedApp();
    expect((await app.request(requestWithScore(null))).status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("bypasses the check only with dedicated E2E authority", async () => {
    const fixtureSecret = "fixture-secret-that-is-at-least-32-characters";
    loadEnv({
      NODE_ENV: "test",
      AUTH_DEV_BYPASS: "true",
      E2E_FIXTURE_MODE: "true",
      E2E_FIXTURE_SECRET: fixtureSecret,
    });
    const { app } = protectedApp();
    const allowed = await app.request(
      requestWithScore(1, { headers: { "X-E2E-Fixture-Token": fixtureSecret } }),
    );
    expect(allowed.status).toBe(200);
    const denied = await app.request(
      requestWithScore(1, {
        headers: { "X-E2E-Fixture-Token": `${fixtureSecret}x` },
      }),
    );
    expect(denied.status).toBe(403);
  });
});
