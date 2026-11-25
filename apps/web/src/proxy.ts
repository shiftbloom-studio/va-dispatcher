import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { authConfig } from "@/lib/auth/config";
import {
  cookieOptions,
  ensureFreshSession,
  readSession,
  sealSession,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
} from "@/lib/auth/session";
import {
  E2E_IDENTITY_HEADER,
  e2eFixtureEnabled,
  e2eIntegratedFixtureEnabled,
  normalizeE2eIdentity,
} from "@/lib/e2e-fixture";

const sessionFreePaths = new Set([
  "/privacy",
  "/datenschutz",
  "/impressum",
  "/imprint",
]);

export default async function proxy(request: NextRequest) {
  if (sessionFreePaths.has(request.nextUrl.pathname)) {
    return NextResponse.next();
  }
  if (e2eFixtureEnabled()) {
    if (request.nextUrl.pathname.startsWith("/api/")) {
      const headers = new Headers(request.headers);
      headers.set(
        E2E_IDENTITY_HEADER,
        normalizeE2eIdentity(
          request.cookies.get("va-e2e-identity")?.value ??
            request.cookies.get("e2e-role")?.value,
        ),
      );
      if (e2eIntegratedFixtureEnabled()) {
        const fixtureSecret = process.env.E2E_FIXTURE_SECRET;
        if (!fixtureSecret) {
          throw new Error("E2E_FIXTURE_SECRET is required in fixture mode");
        }
        headers.set("X-E2E-Fixture-Token", fixtureSecret);
      }
      return NextResponse.next({ request: { headers } });
    }
    return NextResponse.next();
  }
  return refreshSession(request);
}

/**
 * Server components cannot write cookies, so the access token is refreshed
 * here, before a page renders. The rotated session goes to the browser and,
 * through the forwarded Cookie header, to this request's render.
 */
async function refreshSession(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const value = request.cookies.get(SESSION_COOKIE)?.value;
  if (!value || pathname.startsWith("/api/") || pathname.startsWith("/auth/")) {
    return NextResponse.next();
  }
  let config;
  try {
    config = authConfig();
  } catch {
    return NextResponse.next();
  }
  const session = await readSession(value, config);
  const result = session
    ? await ensureFreshSession(session, config)
    : ({ kind: "expired" } as const);
  if (result.kind === "fresh") return NextResponse.next();

  const sealed =
    result.kind === "refreshed"
      ? await sealSession(result.session, config)
      : null;
  if (sealed) request.cookies.set(SESSION_COOKIE, sealed);
  else request.cookies.delete(SESSION_COOKIE);
  const headers = new Headers(request.headers);
  headers.set("cookie", request.cookies.toString());
  const response = NextResponse.next({ request: { headers } });
  if (sealed) {
    response.cookies.set(
      SESSION_COOKIE,
      sealed,
      cookieOptions(SESSION_MAX_AGE_SECONDS),
    );
  } else {
    response.cookies.delete(SESSION_COOKIE);
  }
  return response;
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
