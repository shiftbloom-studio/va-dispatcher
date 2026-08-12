import type { Metadata } from "next";

import { ScheduleRequestEditor } from "@/components/schedule-request-editor";

export const metadata: Metadata = { title: "Edit schedule request" };

export default async function EditScheduleRequestPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  return <ScheduleRequestEditor slug={slug} requestId={id} />;
}
