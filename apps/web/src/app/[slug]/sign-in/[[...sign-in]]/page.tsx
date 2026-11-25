import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { E2eAuthForm } from "@/components/e2e-auth-form";
import { IdentitySignIn } from "@/components/identity-sign-in";
import { TenantAuthShell } from "@/components/tenant-auth-shell";
import { getTenantAuthRoutes } from "@/lib/auth-routes";
import { e2eIntegratedFixtureEnabled } from "@/lib/e2e-fixture";
import { getPublicTenantConfig } from "@/lib/public-tenant";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const tenant = await getPublicTenantConfig(slug);
  if (!tenant) return {};
  const title = `Sign in to ${tenant.name}`;
  const description = `Live dispatch, scheduling and ACARS for ${tenant.name} pilots and dispatchers. Sign in with a one-time code sent to your email.`;
  const path = `/${tenant.slug}/sign-in`;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { title, description, url: path },
    twitter: { title, description },
  };
}

export default async function SignInPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const tenant = await getPublicTenantConfig(slug);
  if (!tenant) notFound();
  const routes = getTenantAuthRoutes(tenant.slug);

  return (
    <TenantAuthShell tenant={tenant}>
      {e2eIntegratedFixtureEnabled() ? (
        <E2eAuthForm slug={tenant.slug} mode="sign-in" />
      ) : (
        <IdentitySignIn
          mode="sign-in"
          returnTo={routes.home}
          signInHref={routes.signIn}
          signUpHref={routes.signUp}
        />
      )}
    </TenantAuthShell>
  );
}
