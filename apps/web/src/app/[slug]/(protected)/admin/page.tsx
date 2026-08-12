import type { Metadata } from "next";

import { AdminControlPlane } from "@/components/admin-control-plane";
import { ForbiddenState } from "@/components/forbidden-state";
import { getServerIdentity } from "@/lib/server-identity";

export const metadata: Metadata = { title: "Administration" };

export default async function AdminPage({
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
  return <AdminControlPlane slug={slug} />;
}
