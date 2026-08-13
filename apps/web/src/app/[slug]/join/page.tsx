import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";

import { MembershipApplication } from "@/components/membership-application";
import { QueryProvider } from "@/components/query-provider";
import { TenantAuthShell } from "@/components/tenant-auth-shell";
import { getTenantAuthRoutes } from "@/lib/auth-routes";
import { e2eFixtureEnabled } from "@/lib/e2e-fixture";
import { getPublicTenantConfig } from "@/lib/public-tenant";

export default async function JoinTenantPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const tenant = await getPublicTenantConfig(slug);
  if (!tenant) notFound();

  if (!e2eFixtureEnabled()) {
    const session = await auth();
    if (!session.userId) redirect(getTenantAuthRoutes(slug).signIn);
  }

  return (
    <TenantAuthShell tenant={tenant}>
      <QueryProvider>
        <MembershipApplication slug={tenant.slug} tenantName={tenant.name} />
      </QueryProvider>
    </TenantAuthShell>
  );
}
