import type { Metadata } from "next";

import { AuditViewer } from "@/components/audit-viewer";
import { ForbiddenState } from "@/components/forbidden-state";
import { getServerIdentity } from "@/lib/server-identity";

export const metadata: Metadata = { title: "Audit history" };

export default async function AuditPage({
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
  return <AuditViewer slug={slug} />;
}
