import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@clerk/nextjs", () => ({
  Waitlist: (props: { signInUrl: string }) => (
    <div data-sign-in-url={props.signInUrl} data-testid="clerk-waitlist" />
  ),
}));

vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
}));

vi.mock("@/lib/public-tenant", async () => {
  const { getTenantConfig } = await import("@/lib/tenant");
  return { getPublicTenantConfig: (slug: string) => getTenantConfig(slug) };
});

import WaitlistPage from "./page";

describe("tenant waitlist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps waitlist registration and sign-in inside the tenant shell", async () => {
    render(await WaitlistPage({ params: Promise.resolve({ slug: "vsas" }) }));

    expect(screen.getAllByAltText("Virtual SAS logo")).toHaveLength(2);
    expect(screen.getByTestId("clerk-waitlist")).toHaveAttribute(
      "data-sign-in-url",
      "/vsas/sign-in",
    );
  });

  it("rejects an unknown tenant", async () => {
    await expect(
      WaitlistPage({ params: Promise.resolve({ slug: "unknown" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(mocks.notFound).toHaveBeenCalledOnce();
  });
});
