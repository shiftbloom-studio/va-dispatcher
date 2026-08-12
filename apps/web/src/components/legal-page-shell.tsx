import Link from "next/link";
import type { ReactNode } from "react";

import { SiteFooter } from "@/components/site-footer";
import type { LegalConfig } from "@/lib/legal";

export function LegalPageShell({
  title,
  description,
  config,
  children,
}: {
  title: string;
  description: string;
  config: LegalConfig;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <Link
            href="/vsas"
            className="flex items-center gap-3 rounded-[2px] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--accent)]"
          >
            <span className="grid size-9 place-items-center rounded-[2px] bg-[var(--accent)] text-sm font-black text-white">
              VS
            </span>
            <span className="font-display font-bold text-slate-950">
              vSAS Live Operations
            </span>
          </Link>
          <span className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
            Legal
          </span>
        </div>
      </header>

      <main
        id="main-content"
        className="mx-auto max-w-5xl px-5 py-10 sm:px-8 sm:py-14"
      >
        <div className="max-w-3xl">
          <p className="text-sm font-bold uppercase tracking-[0.16em] text-red-700">
            Legal information
          </p>
          <h1 className="mt-3 font-display text-4xl font-semibold text-slate-950 sm:text-5xl">
            {title}
          </h1>
          <p className="mt-4 text-lg leading-8 text-slate-600">{description}</p>
        </div>

        {!config.configured ? (
          <div
            role="alert"
            className="mt-8 rounded-[2px] border border-amber-300 bg-amber-50 p-4 text-sm leading-6 text-amber-950"
          >
            <strong>Development configuration:</strong> real legal operator
            details are required before production. Missing:{" "}
            {config.missingEnvironmentVariables.join(", ")}.
          </div>
        ) : null}

        <div className="mt-10 space-y-10 text-[0.98rem] leading-7 text-slate-700">
          {children}
        </div>
      </main>

      <SiteFooter className="border-t border-slate-200 bg-white" />
    </div>
  );
}

export function LegalSection({
  id,
  title,
  children,
}: {
  id?: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-8">
      <h2 className="font-display text-2xl font-semibold text-slate-950">
        {title}
      </h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

export function LegalTable({
  caption,
  headings,
  rows,
}: {
  caption: string;
  headings: string[];
  rows: ReactNode[][];
}) {
  return (
    <div className="overflow-x-auto rounded-[2px] border border-slate-200 bg-white">
      <table className="w-full min-w-[42rem] border-collapse text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-slate-100 text-slate-950">
          <tr>
            {headings.map((heading) => (
              <th key={heading} scope="col" className="px-4 py-3 font-semibold">
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="align-top">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="px-4 py-3 leading-6">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
