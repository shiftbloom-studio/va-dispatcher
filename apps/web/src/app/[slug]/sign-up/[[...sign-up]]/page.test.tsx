import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
}));

vi.mock("@/lib/public-tenant", async () => {
  const { getTenantConfig } = await import("@/lib/tenant");
  return { getPublicTenantConfig: (slug: string) => getTenantConfig(slug) };
});

import SignUpPage from "./page";

describe("tenant sign-up", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps account creation and sign-in inside the tenant shell", async () => {
    render(await SignUpPage({ params: Promise.resolve({ slug: "vsas" }) }));

    expect(screen.getAllByAltText("Virtual SAS logo")).toHaveLength(2);
    expect(
      screen.getByRole("link", { name: "Continue to sign up" }),
    ).toHaveAttribute("href", "/auth/login?returnTo=%2Fvsas%2Fjoin");
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/vsas/sign-in",
    );
  });

  it("rejects an unknown tenant", async () => {
    await expect(
      SignUpPage({ params: Promise.resolve({ slug: "unknown" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(mocks.notFound).toHaveBeenCalledOnce();
  });
});
