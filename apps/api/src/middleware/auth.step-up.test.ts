import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { SignIn } from "../auth/token.js";
import { loadEnv, resetEnvCache } from "../env.js";
import { errorHandler } from "./error.js";
import {
  type AppVariables,
  type AuthContext,
  requireRecentPasskey,
} from "./auth.js";

const now = () => Math.floor(Date.now() / 1000);

function app(signIn: SignIn | undefined) {
  const routes = new Hono<{ Variables: AppVariables }>();
  routes.onError(errorHandler);
  routes.use(
    createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
      c.set("auth", { role: "admin", signIn } as AuthContext);
      await next();
    }),
  );
  routes.post("/sensitive", requireRecentPasskey, (c) => c.json({ ok: true }));
  return routes;
}

async function call(signIn: SignIn | undefined) {
  const response = await app(signIn).request("/sensitive", { method: "POST" });
  return {
    status: response.status,
    body: (await response.json()) as {
      ok?: boolean;
      error?: { code: string; details?: { stepUp?: { reason: string } } };
    },
  };
}

describe("passkey step-up", () => {
  beforeEach(() => {
    resetEnvCache();
    loadEnv({ NODE_ENV: "test" });
  });
  afterEach(() => resetEnvCache());

  it("lets a recent passkey sign-in through", async () => {
    await expect(
      call({ method: "passkey", at: now() - 60 }),
    ).resolves.toMatchObject({ status: 200, body: { ok: true } });
  });

  it("asks for a new sign-in when the passkey sign-in is too old", async () => {
    const { status, body } = await call({
      method: "passkey",
      at: now() - 601,
    });
    expect(status).toBe(403);
    expect(body.error?.code).toBe("STEP_UP_REQUIRED");
    expect(body.error?.details?.stepUp?.reason).toBe("stale");
  });

  it("never accepts an email code, even a fresh one", async () => {
    const { status, body } = await call({
      method: "email_code",
      at: now() - 5,
    });
    expect(status).toBe(403);
    expect(body.error?.details?.stepUp?.reason).toBe("passkey");
  });

  it("fails closed without sign-in claims or with a future time", async () => {
    for (const signIn of [
      undefined,
      { method: "unknown", at: null } as const,
      { method: "passkey", at: now() + 3600 } as const,
    ]) {
      const { status, body } = await call(signIn);
      expect(status).toBe(403);
      expect(body.error?.details?.stepUp?.reason).toBe("stale");
    }
  });

  it("treats an empty AUTH_STEP_UP_SECONDS as not set", async () => {
    resetEnvCache();
    loadEnv({ NODE_ENV: "test", AUTH_STEP_UP_SECONDS: "" });
    const { status } = await call({ method: "email_code", at: now() });
    expect(status).toBe(403);
    await expect(
      call({ method: "passkey", at: now() - 601 }),
    ).resolves.toMatchObject({ status: 403 });
  });

  it("can be turned off with AUTH_STEP_UP_SECONDS=0", async () => {
    resetEnvCache();
    loadEnv({ NODE_ENV: "test", AUTH_STEP_UP_SECONDS: "0" });
    await expect(
      call({ method: "email_code", at: null }),
    ).resolves.toMatchObject({ status: 200 });
  });
});
