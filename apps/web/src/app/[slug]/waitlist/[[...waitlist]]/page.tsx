import { Waitlist } from "@clerk/nextjs";
import { notFound } from "next/navigation";

import {
  TENANT_AUTH_APPEARANCE,
  TenantAuthShell,
} from "@/components/tenant-auth-shell";
import { E2eAuthForm } from "@/components/e2e-auth-form";
import { getTenantAuthRoutes } from "@/lib/auth-routes";
import { e2eIntegratedFixtureEnabled } from "@/lib/e2e-fixture";
import { getPublicTenantConfig } from "@/lib/public-tenant";

export default async function WaitlistPage({
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
        <E2eAuthForm slug={tenant.slug} mode="sign-up" />
      ) : (
        <Waitlist
          signInUrl={routes.signIn}
          appearance={TENANT_AUTH_APPEARANCE}
        />
      )}
    </TenantAuthShell>
  );
}
