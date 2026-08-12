import { createHash, randomBytes } from "node:crypto";
import { writeAudit } from "../../db/repositories/audit.js";
import {
  findMembershipById,
  updateMembership,
} from "../../db/repositories/memberships.js";
import * as oauthRepo from "../../db/repositories/navigraph-oauth.js";
import type { Membership } from "../../db/schema.js";
import { env } from "../../env.js";
import { decryptSecret, encryptSecret } from "../../lib/crypto.js";
import { AppError } from "../../lib/errors.js";
import { isUniqueViolation } from "../../lib/postgres.js";
import {
  buildNavigraphAuthorizationUrl,
  NavigraphOauthAdapter,
  NavigraphOauthAdapterError,
} from "../../navigraph/oauth-adapter.js";
import type { SimbriefActor } from "./service.js";

const OAUTH_TRANSACTION_TTL_MS = 10 * 60 * 1_000;

export type NavigraphOauthStart = {
  authorizationUrl: string;
  redirectUri: string;
  expiresAt: Date;
};

export type NavigraphOauthCallback =
  | { state: string; code: string; error?: never }
  | { state: string; code?: never; error: string };

export function isNavigraphOauthConfigured(): boolean {
  try {
    requireNavigraphOauthConfig();
    return true;
  } catch {
    return false;
  }
}

export async function startNavigraphOauth(
  actor: SimbriefActor,
): Promise<NavigraphOauthStart> {
  await requireMembership(actor.tenantId, actor.membershipId);
  const config = requireNavigraphOauthConfig();
  const state = randomBytes(32).toString("base64url");
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");
  const expiresAt = new Date(Date.now() + OAUTH_TRANSACTION_TTL_MS);
  const codeVerifierEnc = encryptSecret(codeVerifier, env().TENANT_SECRETS_KEY);

  await oauthRepo.deleteExpiredNavigraphOauthTransactions(new Date());
  await oauthRepo.createNavigraphOauthTransaction({
    tenantId: actor.tenantId,
    membershipId: actor.membershipId,
    stateHash: hashState(state),
    codeVerifierEnc,
    expiresAt,
  });

  const authorizationUrl = buildNavigraphAuthorizationUrl({
    clientId: config.clientId,
    redirectUri: config.redirectUri,
    state,
    codeChallenge,
  });
  await writeAudit({
    tenantId: actor.tenantId,
    actorMembershipId: actor.membershipId,
    action: "navigraph.oauth_start",
    entityType: "membership",
    entityId: actor.membershipId,
    meta: { expiresAt: expiresAt.toISOString() },
  });
  return { authorizationUrl, redirectUri: config.redirectUri, expiresAt };
}

export async function completeNavigraphOauth(
  callback: NavigraphOauthCallback,
): Promise<Membership> {
  const consumedAt = new Date();
  const transaction = await oauthRepo.consumeNavigraphOauthTransaction(
    hashState(callback.state),
    consumedAt,
  );
  if (!transaction) {
    throw new AppError(
      "UNAUTHORIZED",
      "Invalid, expired, or already used Navigraph OAuth state",
    );
  }

  if (callback.error) {
    await writeAudit({
      tenantId: transaction.tenantId,
      actorMembershipId: transaction.membershipId,
      action: "navigraph.oauth_denied",
      entityType: "membership",
      entityId: transaction.membershipId,
      meta: { reason: safeProviderError(callback.error) },
    });
    throw new AppError(
      "BAD_REQUEST",
      callback.error === "access_denied"
        ? "Navigraph authorization was cancelled"
        : "Navigraph did not authorize this connection",
    );
  }
  if (!callback.code) {
    throw new AppError(
      "BAD_REQUEST",
      "Navigraph authorization code is missing",
    );
  }

  const config = requireNavigraphOauthConfig();
  const codeVerifier = decryptSecret(
    transaction.codeVerifierEnc,
    env().TENANT_SECRETS_KEY,
  );
  const adapter = new NavigraphOauthAdapter();
  try {
    const tokens = await adapter.exchangeAuthorizationCode({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: config.redirectUri,
      code: callback.code,
      codeVerifier,
    });
    const userInfo = await adapter.fetchUserInfo(tokens.accessToken);
    const current = await requireMembership(
      transaction.tenantId,
      transaction.membershipId,
    );
    let updated: Membership | null;
    try {
      updated = await updateMembership(
        transaction.tenantId,
        transaction.membershipId,
        {
          navigraphSubject: userInfo.subject,
          navigraphUsername: userInfo.username,
          navigraphConnectedAt: consumedAt,
        },
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError(
          "CONFLICT",
          "This Navigraph account is already connected to another member in this Virtual Airline",
        );
      }
      throw error;
    }
    if (!updated) throw new AppError("NOT_FOUND", "Membership not found");

    await writeAudit({
      tenantId: transaction.tenantId,
      actorMembershipId: transaction.membershipId,
      action: "navigraph.oauth_connect",
      entityType: "membership",
      entityId: transaction.membershipId,
      meta: { reconnect: Boolean(current.navigraphSubject) },
    });
    return updated;
  } catch (error) {
    throw publicNavigraphOauthError(error);
  }
}

function requireNavigraphOauthConfig(): {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
} {
  const config = env();
  if (
    !config.NAVIGRAPH_CLIENT_ID ||
    !config.NAVIGRAPH_CLIENT_SECRET ||
    !config.NAVIGRAPH_REDIRECT_URI
  ) {
    throw new AppError("INTERNAL", "Navigraph OAuth is not configured", {
      status: 503,
    });
  }
  const redirect = new URL(config.NAVIGRAPH_REDIRECT_URI);
  const localHttp =
    config.NODE_ENV !== "production" &&
    redirect.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(redirect.hostname);
  if (redirect.protocol !== "https:" && !localHttp) {
    throw new AppError(
      "INTERNAL",
      "NAVIGRAPH_REDIRECT_URI must use HTTPS (except localhost development)",
      { status: 503 },
    );
  }
  const validCallbackPath = [
    "/api/v1/simbrief/oauth/callback",
    "/v1/simbrief/oauth/callback",
  ].includes(redirect.pathname);
  if (
    redirect.username ||
    redirect.password ||
    redirect.search ||
    redirect.hash ||
    !validCallbackPath
  ) {
    throw new AppError(
      "INTERNAL",
      "NAVIGRAPH_REDIRECT_URI must be the SimBrief OAuth callback without a query or fragment",
      { status: 503 },
    );
  }
  return {
    clientId: config.NAVIGRAPH_CLIENT_ID,
    clientSecret: config.NAVIGRAPH_CLIENT_SECRET,
    redirectUri: redirect.toString(),
  };
}

async function requireMembership(
  tenantId: string,
  membershipId: string,
): Promise<Membership> {
  const membership = await findMembershipById(tenantId, membershipId);
  if (!membership) throw new AppError("NOT_FOUND", "Membership not found");
  if (membership.status !== "active") {
    throw new AppError("FORBIDDEN", "Membership is not active");
  }
  return membership;
}

function hashState(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

function safeProviderError(error: string): string {
  return /^[a-z0-9_]{1,64}$/.test(error) ? error : "provider_error";
}

function publicNavigraphOauthError(error: unknown): AppError {
  if (!(error instanceof NavigraphOauthAdapterError)) {
    if (error instanceof AppError) return error;
    throw error;
  }
  const status =
    error.reason === "invalid_grant"
      ? 400
      : error.reason === "rate_limited"
        ? 429
        : error.reason === "timeout"
          ? 504
          : 502;
  return new AppError(
    error.reason === "invalid_grant" ? "BAD_REQUEST" : "UPSTREAM",
    error.message,
    {
      status,
      details: { provider: "navigraph", reason: error.reason },
      cause: error,
    },
  );
}
