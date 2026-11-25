import type { Metadata } from "next";
import { connection } from "next/server";

import { PrivacyNotice } from "@/components/privacy-notice";
import { loadLegalConfig } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Datenschutzerklärung",
  description: "Wie vSAS Live Operations personenbezogene Daten verarbeitet und welche notwendigen Browserdaten gespeichert werden.",
  alternates: { languages: { en: "/privacy", de: "/datenschutz" } },
};

export default async function Page() {
  await connection();
  return <PrivacyNotice locale="de" config={loadLegalConfig()} />;
}
