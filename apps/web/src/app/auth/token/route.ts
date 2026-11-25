import { NextResponse, type NextRequest } from "next/server";

import { AuthNotConfiguredError, authConfig } from "@/lib/auth/config";
import {
  cookieOptions,
  ensureFreshSession,
  readSession,
  sealSession,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
} from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * The browser's access token for direct /api calls, refreshed when it is
 * about to expire. Same-origin only: browsers attach the SameSite=Lax cookie
 * to cross-site GETs, so the Fetch Metadata check keeps other sites from
 * reading a token through it.
 */
export async function GET(request: NextRequest) {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  let config;
  try {
    config = authConfig();
  } catch (error) {
    // Without a registered client (local development) nobody is signed in;
    // API calls then go out without a token, as the dev bypass expects.
    if (
      error instanceof AuthNotConfiguredError &&
      process.env.NODE_ENV !== "production"
    ) {
      return NextResponse.json(
        { error: "signed_out" },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    }
    throw error;
  }
  const session = await readSession(
    request.cookies.get(SESSION_COOKIE)?.value,
    config,
  );
  const result = session
    ? await ensureFreshSession(session, config)
    : ({ kind: "expired" } as const);

  if (result.kind === "expired") {
    const response = NextResponse.json(
      { error: "signed_out" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
    if (session) response.cookies.delete(SESSION_COOKIE);
    return response;
  }
  const response = NextResponse.json(
    {
      accessToken: result.session.accessToken,
      expiresAt: result.session.accessTokenExpiresAt,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
  if (result.kind === "refreshed") {
    response.cookies.set(
      SESSION_COOKIE,
      await sealSession(result.session, config),
      cookieOptions(SESSION_MAX_AGE_SECONDS),
    );
  }
  return response;
}
