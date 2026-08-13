import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  connection: vi.fn(),
}));

import ImpressumPage from "@/app/impressum/page";
import PrivacyPage from "@/app/privacy/page";

describe("public legal pages", () => {
  it("describes the actual Hoppie's ACARS service without stale boilerplate", async () => {
    const { container } = render(await ImpressumPage());
    const copy = container.textContent ?? "";

    expect(copy).toContain("Hoppie's ACARS");
    expect(copy).not.toMatch(/simulated ACARS/i);
    expect(copy).not.toMatch(/online dispute resolution|ODR platform/i);
    expect(copy).not.toMatch(/written consent.*author|all rights reserved/i);
  });

  it("keeps optional telemetry consent-gated and names current providers", async () => {
    const { container } = render(await PrivacyPage());
    const copy = container.textContent ?? "";

    expect(copy).toContain("Both remain off until you select");
    expect(copy).toContain("Neon, LLC");
    expect(copy).toContain("review a tenant membership application");
    expect(copy).toContain("tenant invitations");
    expect(copy).toContain("__session, __client_uat");
    expect(copy).not.toContain("KP_*");
    expect(copy).not.toMatch(/Simulated ACARS/i);
  });
});
