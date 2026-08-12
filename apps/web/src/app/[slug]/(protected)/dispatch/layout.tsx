import type { ReactNode } from "react";

import { ForbiddenState } from "@/components/forbidden-state";
import { getServerIdentity } from "@/lib/server-identity";

export default async function DispatchLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const identity = await getServerIdentity(slug);
  if (identity.kind !== "ready") return null;
  if (identity.role === "pilot")
    return <ForbiddenState slug={slug} destination="portal" />;
  return children;
}
