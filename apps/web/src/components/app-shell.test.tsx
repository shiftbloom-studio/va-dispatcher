import { render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import { AppShell } from "@/components/app-shell";
import type { Me } from "@/lib/api/schemas";
import type { TenantConfig } from "@/lib/tenant";

vi.mock("@clerk/nextjs", () => ({
  OrganizationSwitcher: () => <div>Organization switcher</div>,
  UserButton: () => <div>User button</div>,
  useOrganization: () => ({
    organization: { imageUrl: "https://img.clerk.com/org_vsas-logo" },
  }),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/vsas/dispatch",
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next/link", () => ({
  default: ({
    prefetch,
    ...props
  }: ComponentProps<"a"> & { prefetch?: boolean }) => (
    <a data-prefetch={String(prefetch)} {...props} />
  ),
}));

vi.mock("@/components/online-status", () => ({ OnlineStatus: () => null }));
vi.mock("@/components/site-footer", () => ({ SiteFooter: () => null }));
vi.mock("@/lib/e2e-fixture", () => ({ e2eFixtureEnabled: () => false }));

const tenant: TenantConfig = {
  slug: "vsas",
  name: "Virtual SAS",
  shortName: "vSAS",
  brand: {
    seedColor: "#e64646",
    presence: "balanced",
    logoUrl: null,
  },
  logo: {
    src: "/tenants/vsas/logo.jpg",
    alt: "Virtual SAS logo",
  },
};

const me: Me = {
  user: { clerkUserId: "user_test" },
  membership: {
    id: "membership_test",
    role: "admin",
    pilotCallsign: null,
    displayName: "Test Admin",
    status: "active",
  },
  tenant: {
    id: "tenant_test",
    slug: "vsas",
    name: "Virtual SAS",
    hoppieStation: null,
  },
};

describe("AppShell", () => {
  it("uses the Clerk organization image and suppresses shell prefetches", () => {
    render(
      <AppShell slug="vsas" tenant={tenant} me={me} role="admin">
        Workspace
      </AppShell>,
    );

    expect(
      screen.getAllByRole("img", { name: "Virtual SAS logo" }),
    ).not.toHaveLength(0);
    expect(
      screen.getAllByRole("img", { name: "Virtual SAS logo" })[0],
    ).toHaveAttribute("src", "https://img.clerk.com/org_vsas-logo");

    for (const link of screen.getAllByRole("link")) {
      expect(link).toHaveAttribute("data-prefetch", "false");
    }
  });
});
