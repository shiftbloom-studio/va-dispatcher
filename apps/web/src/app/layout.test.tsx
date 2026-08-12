import { isValidElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@clerk/nextjs", () => ({
  ClerkProvider: ({ children }: { children: React.ReactNode }) => children,
}));

import RootLayout from "./layout";

describe("root Clerk routing", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("routes auth and pending session tasks through the vSAS application", () => {
    vi.stubEnv("NEXT_PUBLIC_E2E_AUTH_BYPASS", "false");

    const layout = RootLayout({ children: <div /> });
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
