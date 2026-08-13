import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { OrganizationMismatch } from "@/components/organization-mismatch";
import { QueryProvider } from "@/components/query-provider";
import { getServerIdentity } from "@/lib/server-identity";
import { getTenantConfig, tenantConfigFromDetail } from "@/lib/tenant";

export default async function ProtectedLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const tenant = getTenantConfig(slug);
  if (!tenant) notFound();

  const identity = await getServerIdentity(slug);
  if (identity.kind === "signed-out") redirect(`/${slug}/sign-in`);
  if (identity.kind === "mismatch") {
    return (
      <OrganizationMismatch tenantName={tenant.name} reason={identity.reason} />
    );
  }

  const operationalConfig = tenantConfigFromDetail(identity.tenant, tenant);

  return (
    <QueryProvider>
      <AppShell
        slug={slug}
        tenant={operationalConfig}
        me={identity.me}
        role={identity.role}
      >
        {children}
      </AppShell>
    </QueryProvider>
  );
}
