import type { Metadata } from "next";

import { ScheduleRequestDetail } from "@/components/schedule-request-detail";

export const metadata: Metadata = { title: "Schedule request" };

export default async function ScheduleRequestPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  return <ScheduleRequestDetail slug={slug} requestId={id} />;
}
