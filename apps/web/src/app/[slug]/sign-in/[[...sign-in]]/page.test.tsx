import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@clerk/nextjs", () => ({
  SignIn: () => <div data-testid="clerk-sign-in" />,
}));

vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
}));

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
    expect(screen.getByTestId("clerk-sign-in")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Source code" })).toHaveAttribute(
      "href",
      "https://github.com/shiftbloom-studio/va-dispatcher",
    );
    expect(
      screen.getByRole("link", { name: "AGPL-3.0-or-later" }),
    ).toBeInTheDocument();
    expect(screen.getByText("No warranty")).toBeInTheDocument();
  });

  it("rejects an unknown tenant", async () => {
    await expect(
      SignInPage({ params: Promise.resolve({ slug: "unknown" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(mocks.notFound).toHaveBeenCalledOnce();
  });
});
