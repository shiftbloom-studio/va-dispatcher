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
  it("uses the Next.js image optimizer for tenant logos", () => {
    render(<TenantLogo tenant={tenant} />);

    const source = screen
      .getByRole("img", { name: "Virtual SAS logo" })
      .getAttribute("src");
    expect(source).not.toBeNull();
    const optimizedUrl = new URL(source ?? "", "http://localhost");
    expect(optimizedUrl.pathname).toBe("/_next/image");
    expect(optimizedUrl.searchParams.get("url")).toBe("/tenants/vsas/logo.jpg");
  });
});
