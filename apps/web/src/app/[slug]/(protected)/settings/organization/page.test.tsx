import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerIdentity: vi.fn(),
}));

vi.mock("@/lib/server-identity", () => ({
  getServerIdentity: mocks.getServerIdentity,
}));
vi.mock("@/components/organization-settings", () => ({
  OrganizationSettings: ({ slug }: { slug: string }) => (
    <div data-testid="organization-settings">{slug}</div>
  ),
}));

import OrganizationSettingsPage from "./page";

describe("organization settings page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the organization configuration for an admin", async () => {
    mocks.getServerIdentity.mockResolvedValue({
      kind: "ready",
      role: "admin",
    });

    render(
      await OrganizationSettingsPage({
        params: Promise.resolve({ slug: "vsas" }),
      }),
    );

    expect(screen.getByTestId("organization-settings")).toHaveTextContent(
      "vsas",
    );
  });

  it.each(["pilot", "dispatcher"])(
    "does not expose organization settings to a %s",
    async (role) => {
      mocks.getServerIdentity.mockResolvedValue({ kind: "ready", role });

      render(
        await OrganizationSettingsPage({
          params: Promise.resolve({ slug: "vsas" }),
        }),
      );

      expect(
        screen.getByText("This workspace is not available for your role"),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("organization-settings"),
      ).not.toBeInTheDocument();
    },
  );
});
