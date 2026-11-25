import type { Metadata } from "next";
import { connection } from "next/server";

import { PrivacyNotice } from "@/components/privacy-notice";
import { loadLegalConfig } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Privacy Notice",
  description: "How vSAS Live Operations processes personal data and uses essential browser storage.",
  alternates: { languages: { en: "/privacy", de: "/datenschutz" } },
};

export default async function Page() {
  await connection();
  return <PrivacyNotice locale="en" config={loadLegalConfig()} />;
}
