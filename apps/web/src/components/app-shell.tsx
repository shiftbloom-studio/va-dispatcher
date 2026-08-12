"use client";

import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import {
  ClipboardList,
  LayoutDashboard,
  MessageSquareText,
  Plane,
  RadioTower,
  Settings,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

import { OnlineStatus } from "@/components/online-status";
import { SiteFooter } from "@/components/site-footer";
import type { Me, Role, TenantDetail } from "@/lib/api/schemas";
import type { TenantConfig } from "@/lib/tenant";

const pilotLinks = [
  { href: "/portal", label: "Portal", icon: LayoutDashboard },
];

const dispatcherLinks = [
  { href: "/dispatch", label: "Operations", icon: RadioTower },
  { href: "/dispatch?view=requests", label: "Requests", icon: ClipboardList },
  { href: "/dispatch?view=flights", label: "Flights", icon: Plane },
  { href: "/dispatch/acars", label: "ACARS", icon: MessageSquareText },
];

const settingsLink = { href: "/settings", label: "Settings", icon: Settings };

export function AppShell({
  children,
  slug,
  tenant,
  operationalTenant,
  me,
  role,
}: {
  children: ReactNode;
  slug: string;
  tenant: TenantConfig;
  operationalTenant: TenantDetail;
  me: Me;
  role: Role;
}) {
  const pathname = usePathname();
  const search = useSearchParams();
  const links = [
    ...(role === "pilot" ? pilotLinks : dispatcherLinks),
    settingsLink,
  ];
  const bypass =
    process.env.NEXT_PUBLIC_E2E_AUTH_BYPASS === "true" &&
    process.env.NODE_ENV !== "production";

  return (
    <div
      style={{ "--accent": tenant.accent } as React.CSSProperties}
      className="min-h-screen bg-slate-50"
    >
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1600px] items-center justify-between gap-4 px-4 sm:px-6">
          <Link
            href={`/${slug}`}
            className="flex items-center gap-3 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--accent)]"
          >
            <span className="grid size-9 place-items-center rounded-xl bg-[var(--accent)] font-display text-sm font-black text-white">
              VS
            </span>
            <span>
              <span className="block font-display text-base font-bold leading-none text-slate-950">
                {tenant.shortName}
              </span>
              <span className="mt-1 block text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
                {operationalTenant.name}
              </span>
            </span>
          </Link>
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-semibold text-slate-900">
                {me.membership?.displayName ??
                  me.membership?.pilotCallsign ??
                  "VA member"}
              </p>
              <p className="text-xs capitalize text-slate-500">{role}</p>
            </div>
            {bypass ? (
              <span
                aria-label="Test user"
                className="grid size-9 place-items-center rounded-full bg-slate-900 text-xs font-bold text-white"
              >
                TU
              </span>
            ) : (
              <>
                <OrganizationSwitcher
                  hidePersonal
                  afterSelectOrganizationUrl="/:slug"
                  appearance={{ elements: { rootBox: "hidden md:block" } }}
                />
                <UserButton />
              </>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1600px]">
        <nav
          aria-label="Main navigation"
          className="fixed inset-x-0 bottom-0 z-40 flex h-16 border-t border-slate-200 bg-white md:sticky md:top-16 md:h-[calc(100vh-4rem)] md:w-60 md:shrink-0 md:flex-col md:border-r md:border-t-0 md:px-3 md:py-5"
        >
          {links.map(({ href, label, icon: Icon }) => {
            const cleanHref = href.split("?")[0];
            const linkView = new URLSearchParams(href.split("?")[1] ?? "").get(
              "view",
            );
            const currentView = search.get("view");
            const isDispatchRoot = cleanHref === "/dispatch";
            const active = isDispatchRoot
              ? pathname === `/${slug}/dispatch` &&
                (linkView ? currentView === linkView : !currentView)
              : pathname === `/${slug}${cleanHref}` ||
                pathname.startsWith(`/${slug}${cleanHref}/`);
            return (
              <Link
                key={href}
                href={`/${slug}${href}`}
                aria-current={active ? "page" : undefined}
                className={`flex min-w-0 flex-1 items-center justify-center gap-2 px-2 text-xs font-semibold transition md:min-h-11 md:flex-none md:justify-start md:rounded-lg md:px-3 md:text-sm ${
                  active
                    ? "text-[var(--accent)] md:bg-red-50"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
                }`}
              >
                <Icon aria-hidden className="size-5 shrink-0" />
                <span>{label}</span>
              </Link>
            );
          })}
          <div className="mt-auto hidden rounded-xl bg-slate-900 p-4 text-white md:block">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
              Time standard
            </p>
            <p className="mt-1 font-display text-lg font-bold">UTC / Zulu</p>
          </div>
        </nav>

        <main
          id="main-content"
          className="min-w-0 flex-1 px-4 pb-24 pt-6 sm:px-6 lg:px-8 md:pb-10"
        >
          <div className="mb-4">
            <OnlineStatus />
          </div>
          {children}
          <SiteFooter className="mt-12 border-t border-slate-200" />
        </main>
      </div>
    </div>
  );
}
