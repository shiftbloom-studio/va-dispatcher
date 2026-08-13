import { isValidElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
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
    mocks.auth.mockResolvedValue({ userId: "user-applicant", orgSlug: null });
  });

  it("requires sign-in before exposing the application workflow", async () => {
    mocks.auth.mockResolvedValue({ userId: null, orgSlug: null });

    await expect(
      JoinTenantPage({ params: Promise.resolve({ slug: "vsas" }) }),
    ).rejects.toThrow("NEXT_REDIRECT:/vsas/sign-in");
    expect(mocks.redirect).toHaveBeenCalledWith("/vsas/sign-in");
  });

  it("renders for a signed-in user without an active organization", async () => {
    const page = await JoinTenantPage({
      params: Promise.resolve({ slug: "vsas" }),
    });

    expect(isValidElement(page)).toBe(true);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("still renders application state when an organization is selected", async () => {
    mocks.auth.mockResolvedValue({
      userId: "user-member",
      orgSlug: "VSAS",
    });

    const page = await JoinTenantPage({
      params: Promise.resolve({ slug: "vsas" }),
    });

    expect(isValidElement(page)).toBe(true);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
