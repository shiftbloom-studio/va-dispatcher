import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from "jose";

import { env } from "../env.js";
import { AppError } from "../lib/errors.js";

/** Identity facts the API trusts from a verified access token. */
export type VerifiedIdentity = {
  userId: string;
  /** Active organization, absent for applicants without one. */
  orgId: string | null;
  /** Organization role as issued, for example `admin` or `org:pilot`. */
  orgRole: string | null;
};

type AccessTokenClaims = JWTPayload & {
  org_id?: unknown;
  org_role?: unknown;
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
  const response = await fetch(discovery);
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
    cachedKeys = { url, keys: createRemoteJWKSet(new URL(url)) };
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
      { issuer: config.AUTH_ISSUER, audience: config.AUTH_AUDIENCE },
    ));
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("UNAUTHORIZED", "Invalid token", { cause: error });
  }

  const userId = optionalString(payload.sub);
  if (!userId) throw new AppError("UNAUTHORIZED", "Token missing subject");
  return {
    userId,
    orgId: optionalString(payload.org_id),
    orgRole: optionalString(payload.org_role),
  };
}
