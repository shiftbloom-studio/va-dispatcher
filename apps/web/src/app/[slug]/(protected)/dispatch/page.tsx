import type { Metadata } from "next";
import { Suspense } from "react";

import { DispatcherDashboard } from "@/components/dispatcher-dashboard";
import { LoadingState } from "@/components/ui/states";

export const metadata: Metadata = { title: "Dispatcher suite" };

export default async function DispatchPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return (
    <Suspense fallback={<LoadingState label="Loading dispatcher suite" />}>
      <DispatcherDashboard slug={slug} />
    </Suspense>
  );
}
