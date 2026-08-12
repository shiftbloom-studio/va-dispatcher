import type { Metadata } from "next";

import { PilotFlightDetail } from "@/components/pilot-flight-detail";

export const metadata: Metadata = { title: "Flight" };

export default async function PilotFlightPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; id: string }>;
  searchParams: Promise<{ simbrief?: string | string[] }>;
}) {
  const [{ slug, id }, query] = await Promise.all([params, searchParams]);
  return (
    <PilotFlightDetail
      slug={slug}
      flightId={id}
      simbriefRecovery={query.simbrief === "ready" ? "ready" : undefined}
    />
  );
}
