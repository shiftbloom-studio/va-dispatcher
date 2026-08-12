import { clerkMiddleware } from "@clerk/nextjs/server";
import type { NextFetchEvent, NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  E2E_IDENTITY_HEADER,
  e2eFixtureEnabled,
  e2eIntegratedFixtureEnabled,
  normalizeE2eIdentity,
} from "@/lib/e2e-fixture";

const clerkProxy = clerkMiddleware(
  () => undefined,
  (request) =>
    request.nextUrl.pathname.startsWith("/api/")
      ? {}
      : {
          organizationSyncOptions: {
            organizationPatterns: ["/:slug", "/:slug/(.*)"],
          },
        },
);

const clerkFreePaths = new Set([
  "/privacy",
  "/datenschutz",
  "/impressum",
  "/imprint",
]);

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  if (clerkFreePaths.has(request.nextUrl.pathname)) {
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
  return clerkProxy(request, event);
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/(.*)",
  ],
};
