import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.stubGlobal("crypto", webcrypto);

const mocks = vi.hoisted(() => ({ refreshTokens: vi.fn() }));

vi.mock("@/lib/auth/oidc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/oidc")>()),
  refreshTokens: mocks.refreshTokens,
}));

import type { AuthConfig } from "@/lib/auth/config";
import { TokenRequestError } from "@/lib/auth/oidc";
import { seal, unseal } from "@/lib/auth/seal";
import {
  ensureFreshSession,
  readSession,
  safeReturnTo,
  sealSession,
  type Session,
} from "@/lib/auth/session";

const config: AuthConfig = {
  issuer: "https://stem.example.test",
  clientId: "va",
  clientSecret: "secret",
  resource: "https://va.example.test/api",
  sessionSecret: "a-session-secret-that-is-long-enough-for-tests",
};

const now = () => Math.floor(Date.now() / 1000);

function session(overrides: Partial<Session> = {}): Session {
  return {
    sub: "user-1",
    name: "Pilot",
    email: "pilot@example.test",
    accessToken: "access-1",
    accessTokenExpiresAt: now() + 600,
    refreshToken: "refresh-1",
    idToken: "id-1",
    ...overrides,
  };
}

describe("cookie sealing", () => {
  it("round-trips and rejects tampering, other secrets, and other purposes", async () => {
    const sealed = await seal({ a: 1 }, config.sessionSecret, "session");
    await expect(
      unseal(sealed, config.sessionSecret, "session"),
    ).resolves.toEqual({ a: 1 });
    await expect(
      unseal(`${sealed}x`, config.sessionSecret, "session"),
    ).resolves.toBeNull();
    await expect(
      unseal(sealed, `${config.sessionSecret}!`, "session"),
    ).resolves.toBeNull();
    await expect(
      unseal(sealed, config.sessionSecret, "auth-transaction"),
    ).resolves.toBeNull();
    await expect(
      unseal("garbage", config.sessionSecret, "session"),
    ).resolves.toBeNull();
  });

  it("stores the session encrypted", async () => {
    const sealed = await sealSession(session(), config);
    expect(sealed).not.toContain("access-1");
    await expect(readSession(sealed, config)).resolves.toMatchObject({
      sub: "user-1",
    });
  });
});

describe("session refresh", () => {
  beforeEach(() => {
    mocks.refreshTokens.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("keeps a fresh token without calling the provider", async () => {
    await expect(ensureFreshSession(session(), config)).resolves.toMatchObject({
      kind: "fresh",
    });
    expect(mocks.refreshTokens).not.toHaveBeenCalled();
  });

  it("rotates the refresh token shortly before expiry", async () => {
    mocks.refreshTokens.mockResolvedValue({
      accessToken: "access-2",
      accessTokenExpiresAt: now() + 600,
      refreshToken: "refresh-2",
      idToken: null,
    });
    const result = await ensureFreshSession(
      session({ accessTokenExpiresAt: now() + 30 }),
      config,
    );
    expect(mocks.refreshTokens).toHaveBeenCalledWith(config, "refresh-1");
    expect(result).toMatchObject({
      kind: "refreshed",
      session: {
        accessToken: "access-2",
        refreshToken: "refresh-2",
        idToken: "id-1",
      },
    });
  });

  it("ends the session when the provider rejects the grant", async () => {
    mocks.refreshTokens.mockImplementation(async () => {
      throw new TokenRequestError(400, "invalid_grant");
    });
    await expect(
      ensureFreshSession(session({ accessTokenExpiresAt: now() + 30 }), config),
    ).resolves.toEqual({ kind: "expired" });
  });

  it("rides out a provider outage while the token is still valid", async () => {
    mocks.refreshTokens.mockImplementation(async () => {
      throw new TokenRequestError(503, null);
    });
    await expect(
      ensureFreshSession(session({ accessTokenExpiresAt: now() + 30 }), config),
    ).resolves.toMatchObject({ kind: "fresh" });
    await expect(
      ensureFreshSession(session({ accessTokenExpiresAt: now() - 1 }), config),
    ).resolves.toEqual({ kind: "expired" });
  });
});

describe("post-sign-in destinations", () => {
  it.each([
    ["/vsas/portal?x=1", "/vsas/portal?x=1"],
    [null, "/"],
    ["https://evil.example", "/"],
    ["//evil.example", "/"],
    ["/\\evil.example", "/"],
  ])("%s becomes %s", (input, expected) => {
    expect(safeReturnTo(input)).toBe(expected);
  });
});
