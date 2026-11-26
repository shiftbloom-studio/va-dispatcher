import "server-only";

import type { AuthConfig } from "@/lib/auth/config";
import { refreshTokens, TokenRequestError } from "@/lib/auth/oidc";
import { seal, unseal } from "@/lib/auth/seal";

/**
 * The app's own session, kept in one encrypted, HttpOnly cookie. stem's
 * session cookie stays on stem's host; this cookie holds the tokens stem
 * issued to this app.
 */
export type Session = {
  sub: string;
  name: string | null;
  email: string | null;
  accessToken: string;
  /** Unix seconds. */
  accessTokenExpiresAt: number;
  refreshToken: string | null;
  idToken: string | null;
};

/** Short-lived state between the authorize redirect and the callback. */
export type AuthTransaction = {
  state: string;
  nonce: string;
  codeVerifier: string;
  returnTo: string;
  /**
   * Set for a step-up: the signed-in person. The new sign-in must be the
   * same account, or the current session stays as it is.
   */
  stepUpSub?: string;
};

const secure = process.env.NODE_ENV === "production";

export const SESSION_COOKIE = secure ? "__Host-va-session" : "va-session";
export const TRANSACTION_COOKIE = secure ? "__Host-va-auth" : "va-auth";

/** Refresh this many seconds before the access token expires. */
export const REFRESH_SKEW_SECONDS = 60;
/** Refresh tokens live much longer, but the cookie need not outlive a month. */
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
export const TRANSACTION_MAX_AGE_SECONDS = 10 * 60;

export function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

export function sealSession(session: Session, config: AuthConfig) {
  return seal(session, config.sessionSecret, "session");
}

export function readSession(value: string | undefined, config: AuthConfig) {
  return unseal<Session>(value, config.sessionSecret, "session");
}

export function sealTransaction(tx: AuthTransaction, config: AuthConfig) {
  return seal(tx, config.sessionSecret, "auth-transaction");
}

export function readTransaction(value: string | undefined, config: AuthConfig) {
  return unseal<AuthTransaction>(
    value,
    config.sessionSecret,
    "auth-transaction",
  );
}

export function accessTokenFresh(
  session: Session,
  skew = REFRESH_SKEW_SECONDS,
) {
  return session.accessTokenExpiresAt - skew > Date.now() / 1000;
}

export type RefreshResult =
  | { kind: "fresh"; session: Session }
  | { kind: "refreshed"; session: Session }
  | { kind: "expired" };

/**
 * Keep the access token fresh. Refresh tokens rotate, so a refreshed
 * session must be written back to the cookie by the caller.
 */
export async function ensureFreshSession(
  session: Session,
  config: AuthConfig,
  /** The person's IP (cf-connecting-ip), passed on for stem's rate limits. */
  clientIp?: string | null,
): Promise<RefreshResult> {
  if (accessTokenFresh(session)) return { kind: "fresh", session };
  if (!session.refreshToken) {
    return accessTokenFresh(session, 0)
      ? { kind: "fresh", session }
      : { kind: "expired" };
  }
  try {
    const tokens = await refreshTokens(config, session.refreshToken, clientIp);
    return {
      kind: "refreshed",
      session: {
        ...session,
        accessToken: tokens.accessToken,
        accessTokenExpiresAt: tokens.accessTokenExpiresAt,
        refreshToken: tokens.refreshToken ?? session.refreshToken,
        idToken: tokens.idToken ?? session.idToken,
      },
    };
  } catch (error) {
    // A rejected grant ends the session. A transient failure keeps a token
    // that has not expired yet, so a provider hiccup does not sign anyone out.
    if (
      !(error instanceof TokenRequestError && error.status < 500) &&
      accessTokenFresh(session, 0)
    ) {
      return { kind: "fresh", session };
    }
    return { kind: "expired" };
  }
}

/** Only same-origin paths may be used as a post-sign-in destination. */
export function safeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  if (value.includes("\\") || /[\u0000-\u001f]/.test(value)) return "/";
  return value;
}
