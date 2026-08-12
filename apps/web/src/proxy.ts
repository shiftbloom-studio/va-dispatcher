import { clerkMiddleware } from "@clerk/nextjs/server";
import type { NextFetchEvent, NextRequest } from "next/server";
import { NextResponse } from "next/server";

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

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  if (
    process.env.E2E_AUTH_BYPASS === "true" &&
    process.env.NODE_ENV !== "production"
  ) {
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
