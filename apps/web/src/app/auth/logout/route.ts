import { NextResponse, type NextRequest } from "next/server";

import { authConfig } from "@/lib/auth/config";
import { endSessionUrl, revokeRefreshToken } from "@/lib/auth/oidc";
import { appOrigin } from "@/lib/auth/origin";
import { readSession, SESSION_COOKIE } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * End the app session, then stem's. POST only, so a cross-site link or
 * image cannot sign anyone out.
 */
export async function POST(request: NextRequest) {
  // Another site must not be able to sign people out with an
  // auto-submitting form.
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const config = authConfig();
  const session = await readSession(
    request.cookies.get(SESSION_COOKIE)?.value,
    config,
  );
  if (session?.refreshToken) {
    await revokeRefreshToken(config, session.refreshToken).catch(() => false);
  }
  const home = `${appOrigin(request)}/`;
  const location =
    (await endSessionUrl(config, {
      idToken: session?.idToken ?? null,
      postLogoutRedirectUri: home,
    }).catch(() => null)) ?? home;
  const response = NextResponse.redirect(location, 303);
  response.headers.set("Cache-Control", "no-store");
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
