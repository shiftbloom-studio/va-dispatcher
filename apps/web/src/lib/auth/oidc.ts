import "server-only";

import { createRemoteJWKSet, customFetch, decodeJwt, jwtVerify } from "jose";

import type { AuthConfig } from "@/lib/auth/config";
import { identityFetch } from "@/lib/auth/identity-fetch";

type Discovery = {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  end_session_endpoint?: string;
  revocation_endpoint?: string;
};

export const AUTH_SCOPES = "openid profile email offline_access orgs";

const discoveryCache = new Map<string, Promise<Discovery>>();
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export function discover(issuer: string): Promise<Discovery> {
  let pending = discoveryCache.get(issuer);
  if (!pending) {
    pending = identityFetch(issuer)(
      `${issuer}/.well-known/openid-configuration`,
      {
        headers: { Accept: "application/json" },
      },
    ).then(async (response) => {
      const document = (await response
        .json()
        .catch(() => null)) as Partial<Discovery> | null;
      if (
        !response.ok ||
        typeof document?.authorization_endpoint !== "string" ||
        typeof document.token_endpoint !== "string" ||
        typeof document.jwks_uri !== "string"
      ) {
        throw new Error("Identity provider discovery failed");
      }
      return document as Discovery;
    });
    // A failed lookup must not stick for the life of the isolate.
    pending.catch(() => discoveryCache.delete(issuer));
    discoveryCache.set(issuer, pending);
  }
  return pending;
}

export type TokenSet = {
  accessToken: string;
  /** Unix seconds. */
  accessTokenExpiresAt: number;
  refreshToken: string | null;
  idToken: string | null;
};

export class TokenRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
  ) {
    super(`Token request failed (${code ?? status})`);
    this.name = "TokenRequestError";
  }
}

function basicAuth(config: AuthConfig) {
  const id = encodeURIComponent(config.clientId);
  const secret = encodeURIComponent(config.clientSecret);
  return `Basic ${btoa(`${id}:${secret}`)}`;
}

async function tokenRequest(
  config: AuthConfig,
  params: Record<string, string>,
): Promise<TokenSet> {
  const { token_endpoint } = await discover(config.issuer);
  const response = await identityFetch(config.issuer)(token_endpoint, {
    method: "POST",
    headers: {
      Authorization: basicAuth(config),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({ ...params, resource: config.resource }),
  });
  const payload = (await response.json().catch(() => null)) as {
    access_token?: unknown;
    expires_in?: unknown;
    refresh_token?: unknown;
    id_token?: unknown;
    error?: unknown;
  } | null;
  if (!response.ok || typeof payload?.access_token !== "string") {
    throw new TokenRequestError(
      response.status,
      typeof payload?.error === "string" ? payload.error : null,
    );
  }
  const accessToken = payload.access_token;
  const claimedExpiry = decodeJwt(accessToken).exp;
  return {
    accessToken,
    accessTokenExpiresAt:
      typeof claimedExpiry === "number"
        ? claimedExpiry
        : Math.floor(Date.now() / 1000) +
          (typeof payload.expires_in === "number" ? payload.expires_in : 300),
    refreshToken:
      typeof payload.refresh_token === "string" ? payload.refresh_token : null,
    idToken: typeof payload.id_token === "string" ? payload.id_token : null,
  };
}

export async function authorizationUrl(
  config: AuthConfig,
  input: {
    redirectUri: string;
    state: string;
    nonce: string;
    codeChallenge: string;
  },
): Promise<string> {
  const { authorization_endpoint } = await discover(config.issuer);
  const url = new URL(authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: input.redirectUri,
    scope: AUTH_SCOPES,
    state: input.state,
    nonce: input.nonce,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
    resource: config.resource,
  }).toString();
  return url.toString();
}

export function exchangeCode(
  config: AuthConfig,
  input: { code: string; codeVerifier: string; redirectUri: string },
): Promise<TokenSet> {
  return tokenRequest(config, {
    grant_type: "authorization_code",
    code: input.code,
    code_verifier: input.codeVerifier,
    redirect_uri: input.redirectUri,
  });
}

export function refreshTokens(
  config: AuthConfig,
  refreshToken: string,
): Promise<TokenSet> {
  return tokenRequest(config, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
}

export type IdTokenProfile = {
  sub: string;
  name: string | null;
  email: string | null;
};

/** Verify the ID token from the code exchange, including its nonce. */
export async function verifyIdToken(
  config: AuthConfig,
  idToken: string,
  nonce: string,
): Promise<IdTokenProfile> {
  const { jwks_uri } = await discover(config.issuer);
  let jwks = jwksCache.get(jwks_uri);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(jwks_uri), {
      [customFetch]: identityFetch(config.issuer),
    });
    jwksCache.set(jwks_uri, jwks);
  }
  const { payload } = await jwtVerify(idToken, jwks, {
    issuer: config.issuer,
    audience: config.clientId,
    // stem signs with Ed25519 only.
    algorithms: ["EdDSA"],
  });
  if (payload.nonce !== nonce || typeof payload.sub !== "string") {
    throw new Error("ID token nonce or subject mismatch");
  }
  return {
    sub: payload.sub,
    name: typeof payload.name === "string" ? payload.name : null,
    email: typeof payload.email === "string" ? payload.email : null,
  };
}

/**
 * Revoke a refresh token (RFC 7009) so a copied session cookie stops
 * working at sign-out. Best effort: sign-out continues if this fails.
 */
export async function revokeRefreshToken(
  config: AuthConfig,
  refreshToken: string,
): Promise<boolean> {
  const { revocation_endpoint } = await discover(config.issuer);
  if (!revocation_endpoint) return false;
  const response = await identityFetch(config.issuer)(revocation_endpoint, {
    method: "POST",
    headers: {
      Authorization: basicAuth(config),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      token: refreshToken,
      token_type_hint: "refresh_token",
    }),
  });
  return response.ok;
}

export async function endSessionUrl(
  config: AuthConfig,
  input: { idToken: string | null; postLogoutRedirectUri: string },
): Promise<string | null> {
  const { end_session_endpoint } = await discover(config.issuer);
  if (!end_session_endpoint) return null;
  const url = new URL(end_session_endpoint);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("post_logout_redirect_uri", input.postLogoutRedirectUri);
  if (input.idToken) url.searchParams.set("id_token_hint", input.idToken);
  return url.toString();
}
