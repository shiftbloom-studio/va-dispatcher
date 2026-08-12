import type { Metadata } from "next";

import { AccountSettings } from "@/components/account-settings";

export const metadata: Metadata = { title: "My settings" };

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ simbrief?: string | string[] }>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  return (
    <AccountSettings
      slug={slug}
      simbriefRecovery={
        query.simbrief === "navigraph-connected"
          ? "navigraph-connected"
          : undefined
      }
    />
  );
}
