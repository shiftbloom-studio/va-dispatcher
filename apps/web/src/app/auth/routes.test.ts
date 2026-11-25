import { webcrypto } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ISSUER = "https://stem.example.test";

const discovery = {
  authorization_endpoint: `${ISSUER}/api/auth/oauth2/authorize`,
  token_endpoint: `${ISSUER}/api/auth/oauth2/token`,
  jwks_uri: `${ISSUER}/api/auth/jwks`,
  end_session_endpoint: `${ISSUER}/api/auth/oauth2/end-session`,
  revocation_endpoint: `${ISSUER}/api/auth/oauth2/revoke`,
};

import { GET as callback } from "./callback/route";
import { GET as login } from "./login/route";
import { POST as logout } from "./logout/route";
import { GET as token } from "./token/route";
import {
  SESSION_COOKIE,
  TRANSACTION_COOKIE,
  sealSession,
} from "@/lib/auth/session";
import { authConfig } from "@/lib/auth/config";

const ORIGIN = "https://va.example.test";

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      String(url).endsWith("/.well-known/openid-configuration")
        ? Response.json(discovery)
        : String(url) === discovery.revocation_endpoint
          ? new Response(null, { status: 200 })
          : new Response(null, { status: 404 }),
    ),
  );
  vi.stubEnv("AUTH_ISSUER", ISSUER);
  vi.stubEnv("AUTH_CLIENT_ID", "va-client");
  vi.stubEnv("AUTH_CLIENT_SECRET", "va-secret");
  vi.stubEnv("AUTH_AUDIENCE", `${ORIGIN}/api`);
  vi.stubEnv(
    "AUTH_SESSION_SECRET",
    "a-session-secret-that-is-long-enough-for-tests",
  );
  vi.stubEnv("APP_ORIGIN", ORIGIN);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("sign-in routes", () => {
  it("starts the code flow with PKCE, the API resource, and a sealed transaction", async () => {
    const response = await login(
      new NextRequest(`${ORIGIN}/auth/login?returnTo=%2Fvsas%2Fportal`),
    );
    expect(response.status).toBe(303);
    const location = new URL(response.headers.get("location")!);
    expect(location.origin + location.pathname).toBe(
      `${ISSUER}/api/auth/oauth2/authorize`,
    );
    expect(Object.fromEntries(location.searchParams)).toMatchObject({
      response_type: "code",
      client_id: "va-client",
      redirect_uri: `${ORIGIN}/auth/callback`,
      scope: "openid profile email offline_access orgs",
      code_challenge_method: "S256",
      resource: `${ORIGIN}/api`,
    });
    expect(location.searchParams.get("code_challenge")).toMatch(/^[\w-]{43}$/);
    const cookie = response.cookies.get(TRANSACTION_COOKIE);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.value).not.toContain("vsas");
  });

  it("rejects a callback whose state does not match", async () => {
    const started = await login(new NextRequest(`${ORIGIN}/auth/login`));
    const tx = started.cookies.get(TRANSACTION_COOKIE)!.value;
    const request = new NextRequest(
      `${ORIGIN}/auth/callback?code=abc&state=forged`,
      { headers: { cookie: `${TRANSACTION_COOKIE}=${tx}` } },
    );
    const response = await callback(request);
    expect(response.headers.get("location")).toBe(
      `${ORIGIN}/auth/error?reason=state`,
    );
    expect(response.cookies.get(SESSION_COOKIE)).toBeUndefined();
  });

  it("refuses to hand out a token to another site", async () => {
    const response = await token(
      new NextRequest(`${ORIGIN}/auth/token`, {
        headers: { "sec-fetch-site": "cross-site" },
      }),
    );
    expect(response.status).toBe(403);
  });

  it("reports a missing session as signed out", async () => {
    const response = await token(
      new NextRequest(`${ORIGIN}/auth/token`, {
        headers: { "sec-fetch-site": "same-origin" },
      }),
    );
    expect(response.status).toBe(401);
  });

  it("signs out of the app and then of stem", async () => {
    const response = await logout(
      new NextRequest(`${ORIGIN}/auth/logout`, { method: "POST" }),
    );
    expect(response.status).toBe(303);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/api/auth/oauth2/end-session");
    expect(location.searchParams.get("post_logout_redirect_uri")).toBe(
      `${ORIGIN}/`,
    );
    expect(response.cookies.get(SESSION_COOKIE)?.value).toBe("");
  });

  it("revokes the refresh token at sign-out", async () => {
    const sealed = await sealSession(
      {
        sub: "user-1",
        name: null,
        email: null,
        accessToken: "access",
        accessTokenExpiresAt: Math.floor(Date.now() / 1000) + 600,
        refreshToken: "refresh-1",
        idToken: "id-1",
      },
      authConfig(),
    );
    await logout(
      new NextRequest(`${ORIGIN}/auth/logout`, {
        method: "POST",
        headers: {
          cookie: `${SESSION_COOKIE}=${sealed}`,
          "sec-fetch-site": "same-origin",
        },
      }),
    );
    const revoke = vi
      .mocked(fetch)
      .mock.calls.find(
        ([url]) => String(url) === discovery.revocation_endpoint,
      );
    expect(String(revoke?.[1]?.body)).toContain("token=refresh-1");
  });

  it("refuses a cross-site sign-out", async () => {
    const response = await logout(
      new NextRequest(`${ORIGIN}/auth/logout`, {
        method: "POST",
        headers: { "sec-fetch-site": "cross-site" },
      }),
    );
    expect(response.status).toBe(403);
  });
});
