import { NextResponse, type NextRequest } from "next/server";

import { authConfig } from "@/lib/auth/config";
import { authorizationUrl } from "@/lib/auth/oidc";
import { callbackUri } from "@/lib/auth/origin";
import { pkceChallenge, randomToken } from "@/lib/auth/seal";
import {
  cookieOptions,
  safeReturnTo,
  sealTransaction,
  TRANSACTION_COOKIE,
  TRANSACTION_MAX_AGE_SECONDS,
} from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/** Start the authorization code flow with PKCE. */
export async function GET(request: NextRequest) {
  const config = authConfig();
  const codeVerifier = randomToken(48);
  const state = randomToken();
  const nonce = randomToken();
  const returnTo = safeReturnTo(request.nextUrl.searchParams.get("returnTo"));

  const location = await authorizationUrl(config, {
    redirectUri: callbackUri(request),
    state,
    nonce,
    codeChallenge: await pkceChallenge(codeVerifier),
  });
  const response = NextResponse.redirect(location, 303);
  response.headers.set("Cache-Control", "no-store");
  response.cookies.set(
    TRANSACTION_COOKIE,
    await sealTransaction({ state, nonce, codeVerifier, returnTo }, config),
    cookieOptions(TRANSACTION_MAX_AGE_SECONDS),
  );
  return response;
}
