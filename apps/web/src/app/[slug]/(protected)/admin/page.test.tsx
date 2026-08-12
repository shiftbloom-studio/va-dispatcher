import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getServerIdentity: vi.fn() }));

vi.mock("@/lib/server-identity", () => ({
  getServerIdentity: mocks.getServerIdentity,
}));
vi.mock("@/components/admin-control-plane", () => ({
  AdminControlPlane: ({ slug }: { slug: string }) => (
    <div data-testid="admin-control-plane">{slug}</div>
  ),
}));

import AdminPage from "./page";

describe("admin control-plane page", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders for an administrator", async () => {
    mocks.getServerIdentity.mockResolvedValue({ kind: "ready", role: "admin" });
    render(await AdminPage({ params: Promise.resolve({ slug: "vsas" }) }));
    expect(screen.getByTestId("admin-control-plane")).toHaveTextContent("vsas");
  });

  it.each(["pilot", "dispatcher"])("fails closed for a %s", async (role) => {
    mocks.getServerIdentity.mockResolvedValue({ kind: "ready", role });
    render(await AdminPage({ params: Promise.resolve({ slug: "vsas" }) }));
    expect(
      screen.getByText("This workspace is not available for your role"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("admin-control-plane")).not.toBeInTheDocument();
  });
});
