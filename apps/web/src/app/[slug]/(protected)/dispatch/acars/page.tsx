import type { Metadata } from "next";
import { Suspense } from "react";

import { AcarsWorkspace } from "@/components/acars-workspace";
import { LoadingState } from "@/components/ui/states";
import { getServerIdentity } from "@/lib/server-identity";

export const metadata: Metadata = { title: "ACARS" };

export default async function AcarsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const identity = await getServerIdentity(slug);
  if (identity.kind !== "ready") return null;
  return (
    <Suspense fallback={<LoadingState label="Loading ACARS" />}>
      <AcarsWorkspace
        slug={slug}
        canManageOrganization={identity.role === "admin"}
      />
    </Suspense>
  );
}
