import type { Metadata } from "next";

import { DispatcherRequestDetail } from "@/components/dispatcher-request-detail";

export const metadata: Metadata = { title: "Dispatcher request" };

export default async function DispatcherRequestPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  return <DispatcherRequestDetail slug={slug} requestId={id} />;
}
