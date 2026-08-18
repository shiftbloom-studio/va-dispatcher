import type { ReactNode } from "react";

import { SiteFooter } from "@/components/site-footer";
import { TenantLogo } from "@/components/tenant-logo";
import { brandStyle } from "@/lib/brand";
import type { TenantConfig } from "@/lib/tenant";

export const TENANT_AUTH_APPEARANCE = {
  elements: {
    rootBox: "w-full",
    cardBox: "w-full",
    card: "shadow-none border border-slate-300 rounded-none",
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
      style={brandStyle(tenant.brand)}
      data-brand-presence={tenant.brand.presence}
      data-tenant={tenant.slug}
      className="flex min-h-screen flex-col bg-[var(--operations-ink)] text-white"
    >
      <main
        id="main-content"
        className="grid flex-1 bg-[var(--operations-ink)] lg:grid-cols-[1.08fr_0.92fr]"
      >
        <section className="relative hidden overflow-hidden p-12 lg:flex lg:flex-col lg:justify-between">
          <div className="absolute inset-y-0 right-0 w-px bg-[var(--brand)] opacity-80" />
          <div className="auth-flight-path absolute inset-x-0 top-1/3 h-px opacity-40" />
          <div className="relative">
            <TenantLogo
              tenant={tenant}
              variant="wordmark"
              className="h-14 w-48"
            />
            <span className="mt-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-slate-300">
              <span aria-hidden className="size-1.5 bg-[var(--brand-action)]" />
              Live operations
            </span>
          </div>
          <div className="relative max-w-xl">
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--brand-border)]">
              Dispatch · Schedule · ACARS
            </p>
            <h1 className="mt-4 max-w-[12ch] text-balance font-display text-5xl font-semibold leading-[1.08] xl:text-6xl">
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
        <section className="flex items-center justify-center bg-[var(--background)] p-5 text-slate-950 sm:p-10">
          <div className="w-full max-w-md">
            <div className="mb-8 text-center lg:hidden">
              <TenantLogo
                tenant={tenant}
                variant="wordmark"
                className="mx-auto h-12 w-40"
              />
              <h1 className="mt-4 font-display text-2xl font-semibold text-slate-950">
                Live operations
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
