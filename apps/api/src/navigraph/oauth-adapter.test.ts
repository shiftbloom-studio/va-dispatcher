import { describe, expect, it, vi } from "vitest";
import {
  buildNavigraphAuthorizationUrl,
  NavigraphOauthAdapter,
} from "./oauth-adapter.js";

describe("buildNavigraphAuthorizationUrl", () => {
  it("builds the documented Authorization Code + S256 PKCE request", () => {
    const state = `v2.${"i".repeat(16)}.${"t".repeat(22)}.${"c".repeat(58)}`;
    const codeChallenge = "c".repeat(43);
    const redirectUri =
      "https://www.va-dispatcher.world/api/v1/simbrief/oauth/callback";
    const result = buildNavigraphAuthorizationUrl({
      clientId: "va-dispatcher",
      redirectUri,
      state,
      codeChallenge,
    });

    const url = new URL(result);
    expect(url.origin + url.pathname).toBe(
      "https://identity.api.navigraph.com/connect/authorize",
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "va-dispatcher",
      response_type: "code",
      state,
      scope: "openid userinfo",
      redirect_uri: redirectUri,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });
    expect(result).not.toContain("client_secret");
  });

  it("rejects malformed state before constructing an authorization URL", () => {
    expect(() =>
      buildNavigraphAuthorizationUrl({
        clientId: "va-dispatcher",
        redirectUri: "https://example.test/callback",
        state: "line-break\nstate",
        codeChallenge: "c".repeat(43),
      }),
    ).toThrow("Navigraph OAuth state must be 11-512 URL-safe characters");
  });
});

describe("NavigraphOauthAdapter", () => {
  it("exchanges the code server-side and resolves the authoritative userinfo subject", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "access-token",
            expires_in: 3_600,
            token_type: "Bearer",
            scope: "openid userinfo",
            refresh_token: "must-not-be-returned",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            sub: "02d8aa80-d17f-4424-a85d-a42329217cb3",
            preferred_username: "TestPilot",
            email: "not-stored@example.test",
          }),
          { status: 200 },
        ),
      );
    const adapter = new NavigraphOauthAdapter({
      fetchImpl: fetchMock as typeof fetch,
    });

    const tokens = await adapter.exchangeAuthorizationCode({
      clientId: "client-id",
      clientSecret: "client-secret",
      redirectUri:
        "https://www.va-dispatcher.world/api/v1/simbrief/oauth/callback",
      code: "authorization-code",
      codeVerifier: "v".repeat(43),
    });
    const userInfo = await adapter.fetchUserInfo(tokens.accessToken);

    expect(tokens).toEqual({
      accessToken: "access-token",
      tokenType: "Bearer",
      expiresIn: 3_600,
      scope: "openid userinfo",
    });
    expect(tokens).not.toHaveProperty("refreshToken");
    expect(userInfo).toEqual({
      subject: "02d8aa80-d17f-4424-a85d-a42329217cb3",
      username: "TestPilot",
    });

    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(tokenUrl).toBe("https://identity.api.navigraph.com/connect/token");
    expect(tokenUrl).not.toContain("client-secret");
    const body = new URLSearchParams(String(tokenInit.body));
    expect(Object.fromEntries(body)).toEqual({
      grant_type: "authorization_code",
      code: "authorization-code",
      redirect_uri:
        "https://www.va-dispatcher.world/api/v1/simbrief/oauth/callback",
      client_id: "client-id",
      client_secret: "client-secret",
      code_verifier: "v".repeat(43),
    });

    const [userInfoUrl, userInfoInit] = fetchMock.mock.calls[1] as [
      string,
      RequestInit,
    ];
    expect(userInfoUrl).toBe(
      "https://identity.api.navigraph.com/connect/userinfo",
    );
    expect(userInfoInit.headers).toMatchObject({
      Authorization: "Bearer access-token",
    });
  });

  it("does not echo an upstream OAuth error body", async () => {
    const adapter = new NavigraphOauthAdapter({
      fetchImpl: vi
        .fn()
        .mockResolvedValue(
          new Response("private provider details", { status: 400 }),
        ) as typeof fetch,
    });

    await expect(
      adapter.exchangeAuthorizationCode({
        clientId: "client-id",
        clientSecret: "client-secret",
        redirectUri: "https://example.test/callback",
        code: "expired-code",
        codeVerifier: "v".repeat(43),
      }),
    ).rejects.toMatchObject({
      reason: "invalid_grant",
      message:
        "The Navigraph authorization code is invalid or expired. Start the connection again.",
    });
  });
});
