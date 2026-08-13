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
      className="flex min-h-screen flex-col bg-[#101728] text-white"
    >
      <main
        id="main-content"
        className="grid flex-1 bg-[#101728] lg:grid-cols-[1.08fr_0.92fr]"
      >
        <section className="relative hidden overflow-hidden p-12 lg:flex lg:flex-col lg:justify-between">
          <div className="absolute inset-y-0 right-0 w-px bg-[var(--brand)] opacity-80" />
          <div className="auth-flight-path absolute inset-x-0 top-1/3 h-px opacity-40" />
          <div className="relative flex items-center gap-4">
            <TenantLogo tenant={tenant} className="size-16" />
            <span className="font-display text-xl font-bold">
              {tenant.shortName} Live Operations
            </span>
          </div>
          <div className="relative max-w-xl">
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--brand-border)]">
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
              <TenantLogo tenant={tenant} className="mx-auto size-16" />
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
