import { NextResponse, type NextRequest } from "next/server";

import { authConfig } from "@/lib/auth/config";
import { authorizationUrl } from "@/lib/auth/oidc";
import { callbackUri } from "@/lib/auth/origin";
import { pkceChallenge, randomToken } from "@/lib/auth/seal";
import {
  cookieOptions,
  readSession,
  safeReturnTo,
  SESSION_COOKIE,
  sealTransaction,
  TRANSACTION_COOKIE,
  TRANSACTION_MAX_AGE_SECONDS,
} from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * Start the authorization code flow with PKCE. With `step_up=1` a signed-in
 * person confirms it's them again (passkey first) before a sensitive action.
 */
export async function GET(request: NextRequest) {
  const config = authConfig();
  const codeVerifier = randomToken(48);
  const state = randomToken();
  const nonce = randomToken();
  const params = request.nextUrl.searchParams;
  const returnTo = safeReturnTo(params.get("returnTo"));
  const stepUpSub =
    params.get("step_up") === "1"
      ? (await readSession(request.cookies.get(SESSION_COOKIE)?.value, config))
          ?.sub
      : undefined;

  const location = await authorizationUrl(config, {
    redirectUri: callbackUri(request),
    state,
    nonce,
    codeChallenge: await pkceChallenge(codeVerifier),
    stepUp: Boolean(stepUpSub),
  });
  const response = NextResponse.redirect(location, 303);
  response.headers.set("Cache-Control", "no-store");
  response.cookies.set(
    TRANSACTION_COOKIE,
    await sealTransaction(
      { state, nonce, codeVerifier, returnTo, stepUpSub },
      config,
    ),
    cookieOptions(TRANSACTION_MAX_AGE_SECONDS),
  );
  return response;
}
