"use client";

/**
 * Browser side of the session: fetches the access token for direct /api
 * calls from /auth/token and keeps it in memory until shortly before it
 * expires. One request at a time, because refresh tokens rotate.
 */
let cached: { token: string; expiresAt: number } | null = null;
let pending: Promise<string | null> | null = null;

const SKEW_SECONDS = 30;

export class SignedOutError extends Error {
  constructor() {
    super("Your session has ended. Sign in again.");
    this.name = "SignedOutError";
  }
}

export function clearAccessToken() {
  cached = null;
}

export function getAccessToken(): Promise<string | null> {
  if (cached && cached.expiresAt - SKEW_SECONDS > Date.now() / 1000) {
    return Promise.resolve(cached.token);
  }
  pending ??= fetch("/auth/token", {
    credentials: "same-origin",
    cache: "no-store",
  })
    .then(async (response) => {
      if (response.status === 401) {
        cached = null;
        return null;
      }
      if (!response.ok) throw new Error("Could not load the session token");
      const body = (await response.json()) as {
        accessToken: string;
        expiresAt: number;
      };
      cached = { token: body.accessToken, expiresAt: body.expiresAt };
      return body.accessToken;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}
