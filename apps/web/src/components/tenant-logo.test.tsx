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
  it("loads the source directly without relying on the unavailable image optimizer route", () => {
    render(<TenantLogo tenant={tenant} />);

    expect(
      screen.getByRole("img", { name: "Virtual SAS logo" }),
    ).toHaveAttribute("src", "/tenants/vsas/logo.jpg");
  });
});
