import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TenantLogo } from "@/components/tenant-logo";
import type { TenantConfig } from "@/lib/tenant";

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

describe("TenantLogo", () => {
  it("loads the tenant logo directly without the unavailable image optimizer", () => {
    render(<TenantLogo tenant={tenant} />);

    expect(
      screen.getByRole("img", { name: "Virtual SAS logo" }),
    ).toHaveAttribute("src", "/tenants/vsas/logo.jpg");
  });

  it("can display the active Clerk organization logo", () => {
    render(
      <TenantLogo
        tenant={tenant}
        src="https://img.clerk.com/org_vsas-logo"
        variant="wordmark"
      />,
    );

    const image = screen.getByRole("img", { name: "Virtual SAS logo" });
    expect(image).toHaveAttribute("src", "https://img.clerk.com/org_vsas-logo");
    expect(image).toHaveClass("object-cover");
  });

  it("presents the vSAS asset as a legible horizontal wordmark", () => {
    render(
      <TenantLogo tenant={tenant} variant="wordmark" className="h-11 w-40" />,
    );

    const image = screen.getByRole("img", { name: "Virtual SAS logo" });
    expect(image).toHaveClass("object-cover");
    expect(image.parentElement).toHaveAttribute("data-variant", "wordmark");
  });

  it("keeps a named fallback when no logo is configured", () => {
    render(<TenantLogo tenant={tenant} src={null} />);

    expect(
      screen.getByRole("img", { name: "Virtual SAS logo" }),
    ).toHaveTextContent("VS");
  });
});
