import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { QueryProvider } from "@/components/query-provider";
import { getTenantAuthRoutes } from "@/lib/auth-routes";
import { DEFAULT_TENANT_SLUG } from "@/lib/tenant";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: "vSAS Live Operations", template: "%s · vSAS" },
  description:
    "Virtual Airline live dispatch, scheduling, and ACARS operations.",
};

const authRoutes = getTenantAuthRoutes(DEFAULT_TENANT_SLUG);

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const document = (
    <html lang="en">
      <body>
        <a
          href="#main-content"
          className="sr-only z-50 rounded bg-white p-3 focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
        >
          Skip to content
        </a>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );

  const fixtureMode =
    process.env.NEXT_PUBLIC_E2E_AUTH_BYPASS === "true" &&
    process.env.NODE_ENV !== "production";
  return fixtureMode ? (
    document
  ) : (
    <ClerkProvider
      signInUrl={authRoutes.signIn}
      signUpUrl={authRoutes.signUp}
      signInFallbackRedirectUrl={authRoutes.home}
      signUpFallbackRedirectUrl={authRoutes.home}
      taskUrls={authRoutes.taskUrls}
    >
      {document}
    </ClerkProvider>
  );
}
