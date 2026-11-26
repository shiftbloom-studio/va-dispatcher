import { NextResponse, type NextRequest } from "next/server";

import { authConfig } from "@/lib/auth/config";
import { exchangeCode, verifyIdToken } from "@/lib/auth/oidc";
import { appOrigin, callbackUri } from "@/lib/auth/origin";
import {
  cookieOptions,
  readTransaction,
  sealSession,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  TRANSACTION_COOKIE,
} from "@/lib/auth/session";

export const dynamic = "force-dynamic";

function failure(request: NextRequest, reason: string) {
  const url = new URL("/auth/error", appOrigin(request));
  url.searchParams.set("reason", reason);
  const response = NextResponse.redirect(url, 303);
  response.cookies.delete(TRANSACTION_COOKIE);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

/** Finish the code flow and start the app session. */
export async function GET(request: NextRequest) {
  const config = authConfig();
  const params = request.nextUrl.searchParams;
  const tx = await readTransaction(
    request.cookies.get(TRANSACTION_COOKIE)?.value,
    config,
  );
  if (params.get("error")) {
    return failure(
      request,
      params.get("error") === "access_denied" ? "denied" : "provider",
    );
  }
  const code = params.get("code");
  if (!tx || !code || params.get("state") !== tx.state) {
    return failure(request, "state");
  }

  let session;
  try {
    const tokens = await exchangeCode(config, {
      code,
      codeVerifier: tx.codeVerifier,
      redirectUri: callbackUri(request),
      clientIp: request.headers.get("cf-connecting-ip"),
    });
    if (!tokens.idToken) return failure(request, "provider");
    const profile = await verifyIdToken(config, tokens.idToken, tx.nonce);
    // A step-up confirms the person who is already signed in. Another
    // account must not replace the session behind a sensitive action.
    if (tx.stepUpSub && profile.sub !== tx.stepUpSub) {
      return failure(request, "account");
    }
    session = {
      ...profile,
      accessToken: tokens.accessToken,
      accessTokenExpiresAt: tokens.accessTokenExpiresAt,
      refreshToken: tokens.refreshToken,
      idToken: tokens.idToken,
    };
  } catch {
    return failure(request, "provider");
  }

  const response = NextResponse.redirect(
    new URL(tx.returnTo, appOrigin(request)),
    303,
  );
  response.headers.set("Cache-Control", "no-store");
  response.cookies.delete(TRANSACTION_COOKIE);
  response.cookies.set(
    SESSION_COOKIE,
    await sealSession(session, config),
    cookieOptions(SESSION_MAX_AGE_SECONDS),
  );
  return response;
}
