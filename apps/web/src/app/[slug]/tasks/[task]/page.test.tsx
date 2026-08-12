import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@clerk/nextjs", () => ({
  TaskChooseOrganization: (props: { redirectUrlComplete: string }) => (
    <div
      data-redirect-url={props.redirectUrlComplete}
      data-testid="choose-organization"
    />
  ),
  TaskResetPassword: (props: { redirectUrlComplete: string }) => (
    <div
      data-redirect-url={props.redirectUrlComplete}
      data-testid="reset-password"
    />
  ),
  TaskSetupMFA: (props: { redirectUrlComplete: string }) => (
    <div
      data-redirect-url={props.redirectUrlComplete}
      data-testid="setup-mfa"
    />
  ),
}));

vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
}));

import SessionTaskPage from "./page";

describe("tenant session tasks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(["choose-organization", "reset-password", "setup-mfa"])(
    "renders %s inside the tenant shell",
    async (task) => {
      render(
        await SessionTaskPage({
          params: Promise.resolve({ slug: "vsas", task }),
        }),
      );

      expect(screen.getAllByAltText("Virtual SAS logo")).toHaveLength(2);
      expect(screen.getByTestId(task)).toHaveAttribute(
        "data-redirect-url",
        "/vsas",
      );
    },
  );

  it("rejects an unknown task", async () => {
    await expect(
      SessionTaskPage({
        params: Promise.resolve({ slug: "vsas", task: "unknown" }),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(mocks.notFound).toHaveBeenCalledOnce();
  });

  it("rejects an unknown tenant", async () => {
    await expect(
      SessionTaskPage({
        params: Promise.resolve({
          slug: "unknown",
          task: "choose-organization",
        }),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(mocks.notFound).toHaveBeenCalledOnce();
  });
});
