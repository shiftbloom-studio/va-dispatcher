import { redirect } from "next/navigation";

import { getServerIdentity } from "@/lib/server-identity";

export default async function TenantHome({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const identity = await getServerIdentity(slug);
  if (identity.kind !== "ready") return null;
  redirect(`/${slug}/${identity.role === "pilot" ? "portal" : "dispatch"}`);
}
