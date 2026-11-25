import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  connection: vi.fn(),
}));

import DatenschutzPage from "@/app/datenschutz/page";
import ImpressumPage from "@/app/impressum/page";
import ImprintPage from "@/app/imprint/page";
import PrivacyPage from "@/app/privacy/page";

async function copyOf(page: () => Promise<React.ReactElement>) {
  const { container } = render(await page());
  return container.textContent ?? "";
}

describe("public legal pages", () => {
  it("describes the actual Hoppie's ACARS service in both languages", async () => {
    for (const page of [ImprintPage, ImpressumPage]) {
      const copy = await copyOf(page);
      expect(copy).toContain("Hoppie's ACARS");
      expect(copy).not.toMatch(/simulated ACARS/i);
      expect(copy).not.toMatch(/online dispute resolution|ODR platform/i);
      expect(copy).not.toMatch(/all rights reserved/i);
    }
    expect(await copyOf(ImpressumPage)).toContain("§ 5 DDG");
    expect(await copyOf(ImprintPage)).toContain("Section 5 DDG");
  });

  it("names the current providers and only strictly necessary storage", async () => {
    for (const page of [PrivacyPage, DatenschutzPage]) {
      const copy = await copyOf(page);
      expect(copy).toContain("Cloudflare, Inc.");
      expect(copy).toContain("stem");
      expect(copy).toContain("__Host-va-session, __Host-va-auth");
      expect(copy).toContain("__cf_bm");
      expect(copy).toContain("TDDDG");
      expect(copy).not.toMatch(/Vercel|Neon|BotID|Speed Insights|Clerk/);
    }
    expect(await copyOf(PrivacyPage)).toContain(
      "review a tenant membership application",
    );
    expect(await copyOf(DatenschutzPage)).toContain("Datenschutzerklärung");
  });

  it("links each page to its other language", async () => {
    const { getByRole } = render(await PrivacyPage());
    expect(getByRole("link", { name: "Deutsch" })).toHaveAttribute(
      "href",
      "/datenschutz",
    );
  });
});
