import type { Metadata } from "next";

import { ScheduleRequestForm } from "@/components/schedule-request-form";

export const metadata: Metadata = { title: "Request a schedule" };

export default async function NewScheduleRequestPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <ScheduleRequestForm slug={slug} />;
}
