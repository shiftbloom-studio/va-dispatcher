import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

const description =
  "Virtual Airline live dispatch, scheduling, and ACARS operations.";

/**
 * Absolute URLs (canonical, hreflang, Open Graph) need the public origin. It
 * comes from the deployment (APP_ORIGIN, or VA_HOSTNAME at build time), so
 * the repository never names a host.
 */
function siteOrigin(): URL | undefined {
  const origin =
    process.env.APP_ORIGIN?.trim() ||
    (process.env.VA_HOSTNAME?.trim()
      ? `https://${process.env.VA_HOSTNAME.trim()}`
      : "");
  try {
    return origin ? new URL(origin) : undefined;
  } catch {
    return undefined;
  }
}

export function generateMetadata(): Metadata {
  return {
    metadataBase: siteOrigin(),
    title: { default: "vSAS Live Operations", template: "%s · vSAS" },
    description,
    applicationName: "VA Dispatch",
    openGraph: {
      type: "website",
      siteName: "vSAS Live Operations",
      title: "vSAS Live Operations",
      description,
      locale: "en_US",
    },
    twitter: {
      card: "summary",
      title: "vSAS Live Operations",
      description,
    },
  };
}

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
      </body>
    </html>
  );
}
