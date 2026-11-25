import Link from "next/link";

import { LegalNotice } from "@/components/legal-notice";

const tones = {
  light: {
    footer: "text-slate-600",
    link: "decoration-slate-300 hover:text-slate-950",
  },
  // For footers on the dark operations ink. Tailwind does not let a caller's
  // text colour reliably override the base one, so the dark palette is set
  // here instead of through className.
  dark: {
    footer: "text-slate-400",
    link: "decoration-slate-500 hover:text-white",
  },
} as const;

export function SiteFooter({
  className = "",
  tone = "light",
}: {
  className?: string;
  tone?: keyof typeof tones;
}) {
  const palette = tones[tone];
  const linkClass = `rounded-sm underline ${palette.link} underline-offset-4 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]`;

  return (
    <footer className={`px-4 py-5 text-xs ${palette.footer} ${className}`}>
      <nav
        aria-label="Legal links"
        className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2"
      >
        <Link href="/imprint" prefetch={false} className={linkClass}>
          Imprint
        </Link>
        <Link href="/privacy" prefetch={false} className={linkClass}>
          Privacy Notice
        </Link>
      </nav>
      <LegalNotice
        className={`mt-3 text-center leading-5 ${tone === "dark" ? "[&_a:hover]:text-white" : ""}`}
      />
    </footer>
  );
}
