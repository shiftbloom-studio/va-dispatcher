"use client";

import {
  OrganizationSwitcher,
  UserButton,
  useOrganization,
} from "@clerk/nextjs";
import {
  ClipboardList,
  LayoutDashboard,
  MessageSquareText,
  Plane,
  RadioTower,
  Settings,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { OnlineStatus } from "@/components/online-status";
import { SiteFooter } from "@/components/site-footer";
import { TenantLogo } from "@/components/tenant-logo";
import type { Me, Role } from "@/lib/api/schemas";
import { brandStyle } from "@/lib/brand";
import { e2eFixtureEnabled } from "@/lib/e2e-fixture";
import type { TenantConfig } from "@/lib/tenant";

const pilotLinks = [
  { href: "/portal", label: "Flight portal", icon: LayoutDashboard },
];

const dispatcherLinks = [
  { href: "/dispatch", label: "Operations", icon: RadioTower },
  { href: "/dispatch?view=requests", label: "Requests", icon: ClipboardList },
  { href: "/dispatch?view=flights", label: "Flight management", icon: Plane },
  { href: "/dispatch/acars", label: "ACARS", icon: MessageSquareText },
];

const settingsLink = { href: "/settings", label: "Settings", icon: Settings };

const adminLink = {
  href: "/admin",
  label: "Administration",
  icon: ShieldCheck,
};

export function AppShell({
  children,
  slug,
  tenant,
  me,
  role,
}: {
  children: ReactNode;
  slug: string;
  tenant: TenantConfig;
  me: Me;
  role: Role;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const search = useSearchParams();
  const links = [
    ...(role === "pilot" ? pilotLinks : dispatcherLinks),
    ...(role === "admin" ? [adminLink] : []),
    settingsLink,
  ];
  const bypass = e2eFixtureEnabled();
  const memberName =
    me.membership?.displayName ?? me.membership?.pilotCallsign ?? "VA member";

  function fixtureSignOut() {
    document.cookie = "va-e2e-identity=; Path=/; Max-Age=0; SameSite=Lax";
    router.replace(`/${slug}/sign-in`);
    router.refresh();
  }

  return (
    <div
      style={brandStyle(tenant.brand)}
      data-brand-presence={tenant.brand.presence}
      data-tenant={tenant.slug}
      className="min-h-screen bg-[var(--background)] text-[var(--foreground)]"
    >
      <div className="min-h-screen md:grid md:grid-cols-[17.5rem_minmax(0,1fr)]">
        <aside className="brand-sidebar relative hidden min-h-screen border-r border-slate-200 bg-[#fbfcfe] md:sticky md:top-0 md:flex md:h-screen md:flex-col">
          <Link
            href={`/${slug}`}
            prefetch={false}
            className="flex min-h-28 items-center border-b border-slate-200 px-6 focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--brand-action)]"
          >
            <span className="min-w-0">
              {bypass ? (
                <TenantLogo
                  tenant={tenant}
                  variant="wordmark"
                  className="h-11 w-40"
                />
              ) : (
                <ClerkTenantLogo
                  tenant={tenant}
                  variant="wordmark"
                  className="h-11 w-40"
                />
              )}
              <span className="mt-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
                <span
                  aria-hidden
                  className="size-1.5 bg-[var(--brand-action)]"
                />
                Live operations
              </span>
            </span>
          </Link>

          <nav aria-label="Main navigation" className="flex-1 px-4 py-7">
            <p className="mb-3 px-3 text-[11px] font-black uppercase tracking-[0.16em] text-slate-600">
              {role === "pilot" ? "Pilot workspace" : "Dispatcher suite"}
            </p>
            <div className="space-y-1">
              {links.map(({ href, label, icon: Icon }) => {
                const active = linkIsActive(pathname, search, slug, href);
                return (
                  <Link
                    key={href}
                    href={`/${slug}${href}`}
                    prefetch={false}
                    aria-current={active ? "page" : undefined}
                    className={`group relative flex min-h-12 items-center gap-3 border px-3 text-sm font-bold transition-[background-color,border-color,color] duration-200 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-action)] ${
                      active
                        ? "border-[var(--brand-action)] bg-[var(--brand-action)] text-[var(--brand-on-action)]"
                        : "border-transparent text-slate-600 hover:border-slate-200 hover:bg-white hover:text-slate-950"
                    }`}
                  >
                    <Icon aria-hidden className="size-[1.15rem] shrink-0" />
                    <span>{label}</span>
                  </Link>
                );
              })}
            </div>
          </nav>

          <div className="border-t border-slate-200 p-4">
            {!bypass ? (
              <OrganizationSwitcher
                hidePersonal
                afterSelectOrganizationUrl="/:slug"
                appearance={{
                  elements: {
                    rootBox: "w-full",
                    organizationSwitcherTrigger:
                      "w-full rounded-none border border-slate-200 py-2",
                  },
                }}
              />
            ) : null}
            <div className="mt-3 flex items-center gap-3 border border-slate-200 p-3">
              {bypass ? (
                <span className="grid size-8 place-items-center bg-slate-900 text-[10px] font-black text-white">
                  TU
                </span>
              ) : (
                <UserButton />
              )}
              <span className="min-w-0">
                <span className="block truncate text-sm font-bold text-slate-900">
                  {memberName}
                </span>
                <span className="block text-[11px] font-bold uppercase tracking-wide text-slate-600">
                  {role}
                </span>
              </span>
            </div>
            {bypass ? (
              <button
                type="button"
                onClick={fixtureSignOut}
                className="mt-2 min-h-10 w-full border border-slate-300 px-3 text-xs font-black uppercase tracking-wider text-slate-600 hover:bg-slate-50"
              >
                Switch test identity
              </button>
            ) : null}
          </div>
        </aside>

        <div className="min-w-0">
          <header className="sticky top-0 z-40 flex h-16 items-center border-b border-slate-200 bg-white/95 px-4 backdrop-blur-sm sm:px-6 lg:px-8">
            <Link
              href={`/${slug}`}
              prefetch={false}
              className="flex min-w-0 items-center md:hidden"
            >
              {bypass ? (
                <TenantLogo
                  tenant={tenant}
                  variant="wordmark"
                  className="h-8 w-24"
                />
              ) : (
                <ClerkTenantLogo
                  tenant={tenant}
                  variant="wordmark"
                  className="h-8 w-24"
                />
              )}
            </Link>
            <div className="ml-auto flex items-center gap-4 sm:gap-6">
              <UtcClock />
              <div className="hidden h-6 w-px bg-slate-200 sm:block" />
              <OnlineStatus />
              {!bypass ? (
                <span className="md:hidden">
                  <UserButton />
                </span>
              ) : null}
            </div>
          </header>

          <main
            id="main-content"
            className="min-w-0 px-4 pb-24 pt-7 sm:px-6 lg:px-8 md:pb-10"
          >
            <div className="mx-auto max-w-[112rem]">{children}</div>
            <SiteFooter className="mx-auto mt-14 max-w-[112rem] border-t border-slate-200" />
          </main>
        </div>
      </div>

      <nav
        aria-label="Mobile navigation"
        className="fixed inset-x-0 bottom-0 z-50 grid h-17 border-t border-slate-200 bg-white md:hidden"
        style={{
          gridTemplateColumns: `repeat(${links.length}, minmax(0, 1fr))`,
        }}
      >
        {links.map(({ href, label, icon: Icon }) => {
          const active = linkIsActive(pathname, search, slug, href);
          return (
            <Link
              key={href}
              href={`/${slug}${href}`}
              prefetch={false}
              aria-current={active ? "page" : undefined}
              className={`relative flex min-w-0 flex-col items-center justify-center gap-1 px-1 text-[11px] font-bold ${
                active ? "text-[var(--brand-action)]" : "text-slate-500"
              }`}
            >
              {active ? (
                <span className="absolute inset-x-3 top-0 h-0.5 bg-[var(--brand)]" />
              ) : null}
              <Icon aria-hidden className="size-5" />
              <span className="max-w-full truncate">
                {label === "Flight management" ? "Flights" : label}
              </span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

function ClerkTenantLogo({
  tenant,
  className,
  variant = "mark",
}: {
  tenant: TenantConfig;
  className: string;
  variant?: "mark" | "wordmark";
}) {
  const { organization } = useOrganization();

  return (
    <TenantLogo
      tenant={tenant}
      src={organization?.imageUrl ?? tenant.logo.src}
      className={className}
      variant={variant}
    />
  );
}

function linkIsActive(
  pathname: string,
  search: URLSearchParams,
  slug: string,
  href: string,
): boolean {
  const [cleanHref, query] = href.split("?");
  const linkView = new URLSearchParams(query ?? "").get("view");
  const currentView = search.get("view");
  if (cleanHref === "/dispatch") {
    return (
      pathname === `/${slug}/dispatch` &&
      (linkView ? currentView === linkView : !currentView)
    );
  }
  return (
    pathname === `/${slug}${cleanHref}` ||
    pathname.startsWith(`/${slug}${cleanHref}/`)
  );
}

function UtcClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const update = () => setNow(new Date());
    update();
    const timer = window.setInterval(update, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="hidden items-baseline gap-3 text-xs font-black uppercase tracking-wider text-slate-700 sm:flex">
      <span>
        {now
          ? new Intl.DateTimeFormat("en-GB", {
              day: "2-digit",
              month: "short",
              year: "numeric",
              timeZone: "UTC",
            }).format(now)
          : "UTC"}
      </span>
      <span className="font-mono text-[var(--brand-action)]">
        {now
          ? `${now.getUTCHours().toString().padStart(2, "0")}:${now
              .getUTCMinutes()
              .toString()
              .padStart(2, "0")} UTC`
          : "--:-- UTC"}
      </span>
    </div>
  );
}
