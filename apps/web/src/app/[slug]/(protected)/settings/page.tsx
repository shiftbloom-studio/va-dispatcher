import type { Metadata } from "next";

import { AccountSettings } from "@/components/account-settings";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <AccountSettings slug={slug} />;
}
