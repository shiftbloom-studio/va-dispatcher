import type { Metadata } from "next";

import { PilotFlightDetail } from "@/components/pilot-flight-detail";

export const metadata: Metadata = { title: "Flight" };

export default async function PilotFlightPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  return <PilotFlightDetail slug={slug} flightId={id} />;
}
