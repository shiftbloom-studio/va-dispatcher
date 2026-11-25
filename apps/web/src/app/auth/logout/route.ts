import { NextResponse, type NextRequest } from "next/server";

import { authConfig } from "@/lib/auth/config";
import { endSessionUrl } from "@/lib/auth/oidc";
import { appOrigin } from "@/lib/auth/origin";
import { readSession, SESSION_COOKIE } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * End the app session, then stem's. POST only, so a cross-site link or
 * image cannot sign anyone out.
 */
export async function POST(request: NextRequest) {
  const config = authConfig();
  const session = await readSession(
    request.cookies.get(SESSION_COOKIE)?.value,
    config,
  );
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
