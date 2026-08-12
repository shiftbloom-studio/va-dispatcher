import type { Metadata } from "next";
import type { ReactNode } from "react";

import { OptionalTelemetry } from "@/components/optional-telemetry";
import { PrivacyControls } from "@/components/privacy-controls";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: "vSAS Live Operations", template: "%s · vSAS" },
  description:
    "Virtual Airline live dispatch, scheduling, and ACARS operations.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <a
          href="#main-content"
          className="sr-only z-50 rounded bg-white p-3 focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
        >
          Skip to content
        </a>
        {children}
        <PrivacyControls />
        <OptionalTelemetry />
      </body>
    </html>
  );
}
