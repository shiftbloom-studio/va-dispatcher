import { isValidElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@clerk/nextjs", () => ({
  ClerkProvider: ({ children }: { children: React.ReactNode }) => children,
}));

import TenantLayout from "./layout";

describe("tenant Clerk routing", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("routes auth and pending session tasks through the current tenant", async () => {
    vi.stubEnv("NEXT_PUBLIC_E2E_FIXTURE_MODE", "false");
    vi.stubEnv("NEXT_PUBLIC_E2E_ROUTE_FIXTURE_MODE", "false");

    const layout = await TenantLayout({
      children: <div />,
      params: Promise.resolve({ slug: "vsas" }),
    });
    expect(isValidElement(layout)).toBe(true);
    if (!isValidElement(layout)) throw new Error("Expected a React element");

    expect(layout.props).toMatchObject({
      signInUrl: "/vsas/sign-in",
      signUpUrl: "/vsas/sign-up",
      signInFallbackRedirectUrl: "/vsas",
      signUpFallbackRedirectUrl: "/vsas",
      taskUrls: {
        "choose-organization": "/vsas/tasks/choose-organization",
        "reset-password": "/vsas/tasks/reset-password",
        "setup-mfa": "/vsas/tasks/setup-mfa",
      },
    });
  });
});
