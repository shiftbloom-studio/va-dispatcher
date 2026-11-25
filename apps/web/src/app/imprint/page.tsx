import type { Metadata } from "next";
import { connection } from "next/server";

import { ImprintNotice } from "@/components/imprint-notice";
import { loadLegalConfig } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Imprint",
  description: "Legal provider information for vSAS Live Operations.",
  alternates: { languages: { en: "/imprint", de: "/impressum" } },
};

export default async function Page() {
  await connection();
  return <ImprintNotice locale="en" config={loadLegalConfig()} />;
}
