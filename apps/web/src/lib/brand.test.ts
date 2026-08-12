import { describe, expect, it } from "vitest";

import { brandStyle, organizationInitials } from "@/lib/brand";

describe("tenant brand derivation", () => {
  it("derives a usable action palette from one light seed color", () => {
    const style = brandStyle({
      seedColor: "#ffffff",
      presence: "balanced",
      logoUrl: null,
    }) as Record<string, string>;

    expect(style["--brand"]).toBe("#ffffff");
    expect(style["--brand-action"]).not.toBe("#ffffff");
    expect(style["--brand-soft"]).toMatch(/^#[0-9a-f]{6}$/);
    expect(style["--brand-complement"]).toMatch(/^#[0-9a-f]{6}$/);
    expect(["#ffffff", "#0d172a"]).toContain(style["--brand-on-action"]);
  });

  it("falls back safely for invalid stored colors", () => {
    const style = brandStyle({
      seedColor: "not-a-color",
      presence: "restrained",
      logoUrl: null,
    }) as Record<string, string>;
    expect(style["--brand"]).toBe("#e64646");
  });

  it("creates compact organization initials", () => {
    expect(organizationInitials("Northwave Virtual Airlines")).toBe("NV");
    expect(organizationInitials(" ")).toBe("VA");
  });
});
