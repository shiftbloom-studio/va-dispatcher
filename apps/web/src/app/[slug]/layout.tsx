import { ClerkProvider } from "@clerk/nextjs";
import type { ReactNode } from "react";

import { QueryProvider } from "@/components/query-provider";
import { getTenantAuthRoutes } from "@/lib/auth-routes";

export default async function TenantLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const authRoutes = getTenantAuthRoutes(slug);
  const content = <QueryProvider>{children}</QueryProvider>;
  const fixtureMode =
    process.env.NEXT_PUBLIC_E2E_AUTH_BYPASS === "true" &&
    process.env.NODE_ENV !== "production";

  return fixtureMode ? (
    content
  ) : (
    <ClerkProvider
      signInUrl={authRoutes.signIn}
      signUpUrl={authRoutes.signUp}
      signInFallbackRedirectUrl={authRoutes.home}
      signUpFallbackRedirectUrl={authRoutes.home}
      taskUrls={authRoutes.taskUrls}
    >
      {content}
    </ClerkProvider>
  );
}
