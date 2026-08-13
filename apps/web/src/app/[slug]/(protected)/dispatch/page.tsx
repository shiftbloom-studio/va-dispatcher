import type { Metadata } from "next";

import { DispatcherDashboard } from "@/components/dispatcher-dashboard";
import { parseDispatcherView } from "@/components/dispatcher-view";

export const metadata: Metadata = { title: "Dispatcher suite" };

export default async function DispatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  return (
    <DispatcherDashboard slug={slug} view={parseDispatcherView(query.view)} />
  );
}
