import type { Metadata } from "next";

import { DispatcherFlightDetail } from "@/components/dispatcher-flight-detail";

export const metadata: Metadata = { title: "Dispatcher flight" };

export default async function DispatcherFlightPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  return <DispatcherFlightDetail slug={slug} flightId={id} />;
}
