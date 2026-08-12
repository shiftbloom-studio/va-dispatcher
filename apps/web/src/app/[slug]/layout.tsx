import { ClerkProvider } from "@clerk/nextjs";
import type { ReactNode } from "react";

import { getTenantAuthRoutes } from "@/lib/auth-routes";
import { e2eFixtureEnabled } from "@/lib/e2e-fixture";

export default async function TenantLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const authRoutes = getTenantAuthRoutes(slug);
  const fixtureMode = e2eFixtureEnabled();

  return fixtureMode ? (
    children
  ) : (
    <ClerkProvider
      signInUrl={authRoutes.signIn}
      signUpUrl={authRoutes.signUp}
      signInFallbackRedirectUrl={authRoutes.home}
      signUpFallbackRedirectUrl={authRoutes.home}
      taskUrls={authRoutes.taskUrls}
    >
      {children}
    </ClerkProvider>
  );
}
