import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkBotId: vi.fn(),
}));

vi.mock("botid/server", () => ({
  checkBotId: mocks.checkBotId,
}));

import { botIdCheckLevel, requireHuman } from "./botid.js";

describe("BotID policy", () => {
  beforeEach(() => {
    mocks.checkBotId.mockReset();
    mocks.checkBotId.mockResolvedValue({ isBot: false });
  });

  it("uses Deep Analysis for high-cost and external-provider mutations", () => {
    expect(botIdCheckLevel("POST", "/api/v1/flights/bulk")).toBe(
      "deepAnalysis",
    );
    expect(botIdCheckLevel("PUT", "/v1/tenant/acars-config")).toBe(
      "deepAnalysis",
    );
  });

  it("uses Basic for other mutations and skips reads and internal routes", () => {
    expect(botIdCheckLevel("POST", "/api/v1/schedule-requests")).toBe("basic");
    expect(botIdCheckLevel("PATCH", "/api/v1/me")).toBe("basic");
    expect(botIdCheckLevel("GET", "/api/v1/flights")).toBeNull();
    expect(
      botIdCheckLevel("POST", "/api/v1/internal/cron/acars-poll"),
    ).toBeNull();
  });

  it("blocks detected bots before protected handlers run", async () => {
    mocks.checkBotId.mockResolvedValue({ isBot: true });
    const handler = vi.fn((c) => c.json({ ok: true }));
    const app = new Hono();
    app.use("*", requireHuman);
    app.post("/api/v1/schedule-requests", handler);

    const response = await app.request("/api/v1/schedule-requests", {
      method: "POST",
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "FORBIDDEN",
        message: "Automated requests are not allowed.",
      },
    });
    expect(handler).not.toHaveBeenCalled();
    expect(mocks.checkBotId).toHaveBeenCalledWith({
      advancedOptions: { checkLevel: "basic" },
    });
  });
});
