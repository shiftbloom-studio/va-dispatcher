import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TenantAuthShell } from "@/components/tenant-auth-shell";
import type { TenantConfig } from "@/lib/tenant";

vi.mock("@/components/site-footer", () => ({ SiteFooter: () => null }));

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

describe("TenantAuthShell", () => {
  it("uses the vSAS wordmark treatment across desktop and mobile", () => {
    const { container } = render(
      <TenantAuthShell tenant={tenant}>Authentication</TenantAuthShell>,
    );

    expect(container.firstElementChild).toHaveAttribute("data-tenant", "vsas");
    expect(screen.getByText("Authentication")).toBeInTheDocument();
    for (const logo of screen.getAllByRole("img", {
      name: "Virtual SAS logo",
    })) {
      expect(logo).toHaveClass("object-cover");
      expect(logo.parentElement).toHaveAttribute("data-variant", "wordmark");
    }
  });
});
