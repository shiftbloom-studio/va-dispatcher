import { SignUp } from "@clerk/nextjs";
import { notFound } from "next/navigation";

import {
  TENANT_AUTH_APPEARANCE,
  TenantAuthShell,
} from "@/components/tenant-auth-shell";
import { getTenantAuthRoutes } from "@/lib/auth-routes";
import { getPublicTenantConfig } from "@/lib/public-tenant";

export default async function SignUpPage({
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
      <SignUp
        path={routes.signUp}
        routing="path"
        fallbackRedirectUrl={routes.home}
        signInFallbackRedirectUrl={routes.home}
        signInUrl={routes.signIn}
        appearance={TENANT_AUTH_APPEARANCE}
      />
    </TenantAuthShell>
  );
}
