import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@clerk/nextjs", () => ({
  SignUp: (props: {
    fallbackRedirectUrl: string;
    path: string;
    signInFallbackRedirectUrl: string;
    signInUrl: string;
  }) => (
    <div
      data-fallback-url={props.fallbackRedirectUrl}
      data-path={props.path}
      data-sign-in-fallback-url={props.signInFallbackRedirectUrl}
      data-sign-in-url={props.signInUrl}
      data-testid="clerk-sign-up"
    />
  ),
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
    expect(screen.getByTestId("clerk-sign-up")).toHaveAttribute(
      "data-path",
      "/vsas/sign-up",
    );
    expect(screen.getByTestId("clerk-sign-up")).toHaveAttribute(
      "data-sign-in-url",
      "/vsas/sign-in",
    );
    expect(screen.getByTestId("clerk-sign-up")).toHaveAttribute(
      "data-fallback-url",
      "/vsas/join",
    );
    expect(screen.getByTestId("clerk-sign-up")).toHaveAttribute(
      "data-sign-in-fallback-url",
      "/vsas",
    );
  });

  it("rejects an unknown tenant", async () => {
    await expect(
      SignUpPage({ params: Promise.resolve({ slug: "unknown" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(mocks.notFound).toHaveBeenCalledOnce();
  });
});
