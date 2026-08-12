import type { Metadata } from "next";

import { ForbiddenState } from "@/components/forbidden-state";
import { OrganizationSettings } from "@/components/organization-settings";
import { getServerIdentity } from "@/lib/server-identity";

export const metadata: Metadata = { title: "Organization settings" };

export default async function OrganizationSettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const identity = await getServerIdentity(slug);
  if (identity.kind !== "ready") return null;
  if (identity.role !== "admin") {
    return <ForbiddenState slug={slug} destination="settings" />;
  }

  return <OrganizationSettings slug={slug} />;
}
