import Image from "next/image";
import type { CSSProperties, ReactNode } from "react";

import { SiteFooter } from "@/components/site-footer";
import type { TenantConfig } from "@/lib/tenant";

export const TENANT_AUTH_APPEARANCE = {
  elements: {
    rootBox: "w-full",
    cardBox: "w-full",
    card: "shadow-xl border border-slate-200",
  },
};

export function TenantAuthShell({
  tenant,
  children,
}: {
  tenant: TenantConfig;
  children: ReactNode;
}) {
  return (
    <div
      style={{ "--accent": tenant.accent } as CSSProperties}
      className="flex min-h-screen flex-col bg-slate-950 text-white"
    >
      <main
        id="main-content"
        className="grid flex-1 bg-slate-950 lg:grid-cols-[1.1fr_0.9fr]"
      >
        <section className="relative hidden overflow-hidden p-12 lg:flex lg:flex-col lg:justify-between">
          <div className="absolute -right-24 top-28 size-80 rounded-full bg-red-600/30 blur-3xl" />
          <div className="relative flex items-center gap-4">
            <span className="relative h-14 w-40 shrink-0 overflow-hidden rounded-xl bg-slate-50 shadow-lg shadow-black/20 ring-1 ring-white/10">
              <Image
                alt={tenant.logo.alt}
                className="object-cover"
                fill
                sizes="160px"
                src={tenant.logo.src}
                unoptimized
              />
            </span>
            <span className="font-display text-xl font-bold">
              {tenant.shortName} Live Operations
            </span>
          </div>
          <div className="relative max-w-xl">
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-red-400">
              Dispatch · Schedule · ACARS
            </p>
            <h1 className="mt-4 font-display text-6xl font-semibold leading-[1.05]">
              The operation stays connected.
            </h1>
            <p className="mt-6 max-w-lg text-lg leading-8 text-slate-300">
              A real-time human dispatch layer for {tenant.name}, where
              dispatchers build individual pilot schedules and coordinate every
              flight together.
            </p>
          </div>
          <p className="relative text-sm text-slate-400">
            All operational times are shown in UTC / Zulu.
          </p>
        </section>
        <section className="flex items-center justify-center bg-slate-50 p-5 text-slate-950 sm:p-10">
          <div className="w-full max-w-md">
            <div className="mb-8 text-center lg:hidden">
              <div className="relative mx-auto h-14 w-40 overflow-hidden rounded-xl bg-slate-100 shadow-sm ring-1 ring-slate-200">
                <Image
                  alt={tenant.logo.alt}
                  className="object-cover"
                  fill
                  sizes="160px"
                  src={tenant.logo.src}
                  unoptimized
                />
              </div>
              <h1 className="mt-4 font-display text-3xl font-semibold text-slate-950">
                {tenant.shortName} Live Operations
              </h1>
            </div>
            {children}
          </div>
        </section>
      </main>
      <SiteFooter className="border-t border-slate-800 text-slate-400 [&_a:hover]:text-white [&_button:hover]:text-white" />
    </div>
  );
}
