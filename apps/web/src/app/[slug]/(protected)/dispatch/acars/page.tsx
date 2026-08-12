import type { Metadata } from "next";
import { Suspense } from "react";

import { AcarsWorkspace } from "@/components/acars-workspace";
import { LoadingState } from "@/components/ui/states";

export const metadata: Metadata = { title: "ACARS" };

export default async function AcarsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return (
    <Suspense fallback={<LoadingState label="Loading ACARS" />}>
      <AcarsWorkspace slug={slug} />
    </Suspense>
  );
}
