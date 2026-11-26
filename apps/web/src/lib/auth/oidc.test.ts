import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthConfig } from "@/lib/auth/config";
import { CLIENT_IP_HEADER, exchangeCode, refreshTokens } from "@/lib/auth/oidc";

const ISSUER = "https://stem-oidc.example.test";
const TOKEN_ENDPOINT = `${ISSUER}/api/auth/oauth2/token`;

const config = {
  issuer: ISSUER,
  clientId: "va-client",
  clientSecret: "va-secret",
  resource: "https://va.example.test/api",
} as AuthConfig;

function unsignedJwt(payload: Record<string, unknown>) {
  const part = (value: unknown) =>
    btoa(JSON.stringify(value))
      .replace(/=+$/, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  return `${part({ alg: "none" })}.${part(payload)}.`;
}

const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.endsWith("/.well-known/openid-configuration")) {
    return Response.json({
      authorization_endpoint: `${ISSUER}/api/auth/oauth2/authorize`,
      token_endpoint: TOKEN_ENDPOINT,
      jwks_uri: `${ISSUER}/api/auth/jwks`,
    });
  }
  return Response.json({
    access_token: unsignedJwt({ exp: Math.floor(Date.now() / 1000) + 600 }),
    refresh_token: "refresh-2",
  });
});

function tokenCallHeaders(): Headers {
  const call = fetchMock.mock.calls.find(
    ([input]) => String(input) === TOKEN_ENDPOINT,
  ) as unknown as [string, RequestInit] | undefined;
  return new Headers(call?.[1].headers);
}

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe("token requests", () => {
  it("passes the person's IP on for stem's rate limits", async () => {
    await refreshTokens(config, "refresh-1", "203.0.113.7");
    expect(tokenCallHeaders().get(CLIENT_IP_HEADER)).toBe("203.0.113.7");

    fetchMock.mockClear();
    await exchangeCode(config, {
      code: "code-1",
      codeVerifier: "verifier",
      redirectUri: "https://va.example.test/auth/callback",
      clientIp: "2001:db8::1",
    });
    expect(tokenCallHeaders().get(CLIENT_IP_HEADER)).toBe("2001:db8::1");
  });

  it("leaves the header out when the IP is unknown", async () => {
    await refreshTokens(config, "refresh-1", null);
    const headers = tokenCallHeaders();
    expect(headers.get("Authorization")).toMatch(/^Basic /);
    expect(headers.has(CLIENT_IP_HEADER)).toBe(false);
  });
});
