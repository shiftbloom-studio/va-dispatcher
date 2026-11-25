import { isValidElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));

vi.mock("@/lib/auth/server-session", () => ({
  getSession: mocks.getSession,
}));
vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
  redirect: mocks.redirect,
}));
vi.mock("@/lib/public-tenant", async () => {
  const { getTenantConfig } = await import("@/lib/tenant");
  return { getPublicTenantConfig: (slug: string) => getTenantConfig(slug) };
});

import JoinTenantPage from "./page";

describe("tenant join page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ sub: "user-applicant" });
  });

  it("requires sign-in before exposing the application workflow", async () => {
    mocks.getSession.mockResolvedValue(null);

    await expect(
      JoinTenantPage({ params: Promise.resolve({ slug: "vsas" }) }),
    ).rejects.toThrow("NEXT_REDIRECT:/vsas/sign-in");
    expect(mocks.redirect).toHaveBeenCalledWith("/vsas/sign-in");
  });

  it("renders the application workflow for a signed-in user", async () => {
    const page = await JoinTenantPage({
      params: Promise.resolve({ slug: "vsas" }),
    });

    expect(isValidElement(page)).toBe(true);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
