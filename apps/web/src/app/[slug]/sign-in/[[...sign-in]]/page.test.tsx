import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@clerk/nextjs", () => ({
  SignIn: (props: {
    fallbackRedirectUrl: string;
    path: string;
    signUpFallbackRedirectUrl: string;
    signUpUrl: string;
  }) => (
    <div
      data-fallback-url={props.fallbackRedirectUrl}
      data-path={props.path}
      data-sign-up-fallback-url={props.signUpFallbackRedirectUrl}
      data-sign-up-url={props.signUpUrl}
      data-testid="clerk-sign-in"
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

import SignInPage from "./page";

describe("tenant sign-in", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows tenant branding and explains the human dispatch flow", async () => {
    render(await SignInPage({ params: Promise.resolve({ slug: "vsas" }) }));

    expect(screen.getAllByAltText("Virtual SAS logo")).toHaveLength(2);
    expect(
      screen.getByText(
        "A real-time human dispatch layer for Virtual SAS, where dispatchers build individual pilot schedules and coordinate every flight together.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Source code" })).toHaveAttribute(
      "href",
      "https://github.com/shiftbloom-studio/va-dispatcher",
    );
    expect(
      screen.getByRole("link", { name: "AGPL-3.0-or-later" }),
    ).toBeInTheDocument();
    expect(screen.getByText("No warranty")).toBeInTheDocument();
    expect(screen.getByTestId("clerk-sign-in")).toHaveAttribute(
      "data-sign-up-url",
      "/vsas/sign-up",
    );
    expect(screen.getByTestId("clerk-sign-in")).toHaveAttribute(
      "data-fallback-url",
      "/vsas",
    );
    expect(screen.getByTestId("clerk-sign-in")).toHaveAttribute(
      "data-sign-up-fallback-url",
      "/vsas",
    );
    expect(screen.getByRole("link", { name: "Impressum" })).toHaveAttribute(
      "href",
      "/impressum",
    );
    expect(
      screen.getByRole("link", { name: "Privacy Notice" }),
    ).toHaveAttribute("href", "/privacy");
    expect(
      screen.getByRole("button", { name: "Cookie settings" }),
    ).toBeInTheDocument();
  });

  it("rejects an unknown tenant", async () => {
    await expect(
      SignInPage({ params: Promise.resolve({ slug: "unknown" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(mocks.notFound).toHaveBeenCalledOnce();
  });
});
