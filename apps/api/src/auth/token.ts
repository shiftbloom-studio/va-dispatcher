import {
  createRemoteJWKSet,
  customFetch,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from "jose";

import { env } from "../env.js";
import { AppError } from "../lib/errors.js";
import { identityFetch } from "../platform.js";

/** Identity facts the API trusts from a verified access token. */
export type VerifiedIdentity = {
  userId: string;
  /**
   * Organization id to role for every organization of this app the user
   * belongs to. Empty for applicants. There is no active organization: the
   * API picks the tenant per request and looks up its role here.
   */
  orgs: Record<string, string>;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  /** How and when the person signed in to stem for this session. */
  signIn: SignIn;
};

/**
 * Sign-in strength from stem's `auth_method` and `signed_in_at` claims.
 * Anything other than a passkey counts as an email code.
 */
export type SignIn = {
  method: "passkey" | "email_code" | "unknown";
  /** Unix seconds, or null when the provider did not say. */
  at: number | null;
};

type AccessTokenClaims = JWTPayload & {
  azp?: unknown;
  client_id?: unknown;
  orgs?: unknown;
  email?: unknown;
  email_verified?: unknown;
  name?: unknown;
  auth_method?: unknown;
  signed_in_at?: unknown;
};

let cachedKeys: { url: string; keys: JWTVerifyGetKey } | null = null;
let keysOverride: JWTVerifyGetKey | null = null;

/** Tests inject a local key set instead of fetching a remote JWKS. */
export function setAccessTokenKeysForTests(keys: JWTVerifyGetKey | null) {
  keysOverride = keys;
}

async function jwksUrl(issuer: string): Promise<string> {
  const configured = env().AUTH_JWKS_URL;
  if (configured) return configured;
  const discovery = new URL(
    ".well-known/openid-configuration",
    issuer.endsWith("/") ? issuer : `${issuer}/`,
  );
  const response = await identityFetch(issuer)(discovery);
  if (!response.ok) {
    throw new AppError("UPSTREAM", "Identity provider discovery failed", {
      status: 503,
    });
  }
  const document = (await response.json()) as { jwks_uri?: unknown };
  if (typeof document.jwks_uri !== "string") {
    throw new AppError("UPSTREAM", "Identity provider has no JWKS", {
      status: 503,
    });
  }
  return document.jwks_uri;
}

async function signingKeys(issuer: string): Promise<JWTVerifyGetKey> {
  if (keysOverride) return keysOverride;
  const url = await jwksUrl(issuer);
  if (cachedKeys?.url !== url) {
    cachedKeys = {
      url,
      keys: createRemoteJWKSet(new URL(url), {
        [customFetch]: identityFetch(issuer),
      }),
    };
  }
  return cachedKeys.keys;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/** Verify an OIDC access token from the configured identity provider. */
export async function verifyAccessToken(
  token: string,
): Promise<VerifiedIdentity> {
  const config = env();
  if (!config.AUTH_ISSUER || !config.AUTH_AUDIENCE) {
    throw new AppError("INTERNAL", "The identity provider is not configured", {
      status: 503,
    });
  }

  let payload: AccessTokenClaims;
  try {
    ({ payload } = await jwtVerify<AccessTokenClaims>(
      token,
      await signingKeys(config.AUTH_ISSUER),
      {
        issuer: config.AUTH_ISSUER,
        audience: config.AUTH_AUDIENCE,
        typ: "at+jwt",
        // stem signs with Ed25519 only.
        algorithms: ["EdDSA"],
      },
    ));
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("UNAUTHORIZED", "Invalid token", { cause: error });
  }

  const userId = optionalString(payload.sub);
  if (!userId) throw new AppError("UNAUTHORIZED", "Token missing subject");
  // Another client of the same provider must not be able to call this API
  // with its own tokens, even if it is ever granted the same resource.
  const clientId =
    optionalString(payload.azp) ?? optionalString(payload.client_id);
  if (config.AUTH_CLIENT_ID && clientId !== config.AUTH_CLIENT_ID) {
    throw new AppError("UNAUTHORIZED", "Token was issued to another client");
  }
  return {
    userId,
    orgs: orgRoles(payload.orgs),
    email: optionalString(payload.email),
    emailVerified: payload.email_verified === true,
    name: optionalString(payload.name),
    signIn: signInClaims(payload),
  };
}

function signInClaims(payload: AccessTokenClaims): SignIn {
  const method =
    payload.auth_method === "passkey" || payload.auth_method === "email_code"
      ? payload.auth_method
      : "unknown";
  const at =
    typeof payload.signed_in_at === "number" &&
    Number.isFinite(payload.signed_in_at)
      ? payload.signed_in_at
      : null;
  return { method, at };
}

function orgRoles(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const roles: Record<string, string> = {};
  for (const [orgId, role] of Object.entries(value)) {
    if (orgId && typeof role === "string" && role.trim()) roles[orgId] = role;
  }
  return roles;
}
