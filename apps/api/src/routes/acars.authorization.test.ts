import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { beforeEach, describe, expect, it, vi } from "vitest";

const actor = vi.hoisted(() => ({ role: "pilot" as "pilot" | "dispatcher" }));

vi.mock("../middleware/auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middleware/auth.js")>();
  return {
    ...actual,
    requireAuth: createMiddleware(async (c, next) => {
      c.set("auth", {
        clerkUserId: "user_test",
        tenantId: "tenant_test",
        membershipId: "membership_test",
        role: actor.role,
        clerkOrgId: "org_test",
      });
      await next();
    }),
  };
});

vi.mock("../domain/acars/service.js", () => ({
  listMessages: vi.fn(async () => ({ items: [], nextCursor: null })),
  getMessage: vi.fn(async () => ({
    id: "message_test",
    direction: "inbound",
    msgType: "telex",
    fromStation: "SAS123",
    toStation: "VSAS",
    body: "TEST",
    hoppieRaw: null,
    flightId: null,
    provider: "mock",
    createdAt: new Date("2026-08-12T00:00:00.000Z"),
  })),
  sendTelex: vi.fn(),
  simulateInbound: vi.fn(),
}));

import { acarsRoutes } from "./acars.js";
import { errorHandler } from "../middleware/error.js";

const app = new Hono();
app.onError(errorHandler);
app.route("/", acarsRoutes);

describe("ACARS route authorization", () => {
  beforeEach(() => {
    actor.role = "pilot";
  });

  it.each([
    { method: "GET", path: "/acars/messages" },
    { method: "GET", path: "/acars/messages/message_test" },
    {
      method: "POST",
      path: "/acars/messages",
      body: { to: "SAS123", body: "TEST" },
    },
    {
      method: "POST",
      path: "/acars/simulate",
      body: { from: "SAS123", body: "TEST" },
    },
  ])("forbids a pilot from $method $path", async ({ method, path, body }) => {
    const response = await app.request(path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "FORBIDDEN",
        message: "Requires dispatcher or higher",
      },
    });
  });

  it("allows a dispatcher to list ACARS messages", async () => {
    actor.role = "dispatcher";

    const response = await app.request("/acars/messages");

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
  });
});
