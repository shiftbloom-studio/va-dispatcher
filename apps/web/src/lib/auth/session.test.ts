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
      "203.0.113.7",
    );
    expect(mocks.refreshTokens).toHaveBeenCalledWith(
      config,
      "refresh-1",
      "203.0.113.7",
    );
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

  it("keeps a session with ten organizations under the cookie size limit", async () => {
    const orgs = Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [
        crypto.randomUUID(),
        i ? "pilot" : "owner",
      ]),
    );
    const jwt = (claims: object) =>
      `${"e".repeat(36)}.${btoa(JSON.stringify(claims))}.${"s".repeat(86)}`;
    const common = {
      iss: config.issuer,
      sub: crypto.randomUUID(),
      aud: config.resource,
      exp: now() + 600,
      iat: now(),
      jti: crypto.randomUUID(),
      email: "someone.with.a.long.address@example.test",
      name: "Someone With A Fairly Long Display Name",
    };
    const sealed = await sealSession(
      session({
        accessToken: jwt({
          ...common,
          client_id: "va-client",
          azp: "va-client",
          scope: "openid profile email offline_access orgs",
          email_verified: true,
          orgs,
        }),
        idToken: jwt({
          ...common,
          aud: config.clientId,
          nonce: "n".repeat(43),
        }),
        refreshToken: "r".repeat(64),
      }),
      config,
    );
    // Browsers drop a Set-Cookie over 4096 bytes, name and attributes included.
    expect(sealed.length + 100).toBeLessThan(4096);
  });
});
