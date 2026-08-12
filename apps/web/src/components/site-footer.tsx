import Link from "next/link";

import { LegalNotice } from "@/components/legal-notice";
import { CookieSettingsButton } from "@/components/privacy-controls";

export function SiteFooter({ className = "" }: { className?: string }) {
  return (
    <footer className={`px-4 py-5 text-xs text-slate-500 ${className}`}>
      <nav
        aria-label="Legal links"
        className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2"
      >
        <Link
          href="/impressum"
          className="rounded-sm underline decoration-slate-300 underline-offset-4 transition hover:text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
        >
          Impressum
        </Link>
        <Link
          href="/privacy"
          className="rounded-sm underline decoration-slate-300 underline-offset-4 transition hover:text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
        >
          Privacy Notice
        </Link>
        <CookieSettingsButton />
      </nav>
      <LegalNotice className="mt-3 text-center leading-5" />
    </footer>
  );
}
