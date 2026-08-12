import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerIdentity: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
  redirect: mocks.redirect,
}));

vi.mock("@/lib/server-identity", () => ({
  getServerIdentity: mocks.getServerIdentity,
}));

import TenantHome from "./page";

describe("tenant home", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an unknown slug before loading identity", async () => {
    await expect(
      TenantHome({ params: Promise.resolve({ slug: "favicon.ico" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(mocks.notFound).toHaveBeenCalledOnce();
    expect(mocks.getServerIdentity).not.toHaveBeenCalled();
  });

  it("routes a known tenant from its resolved role", async () => {
    mocks.getServerIdentity.mockResolvedValue({
      kind: "ready",
      role: "dispatcher",
    });

    await TenantHome({ params: Promise.resolve({ slug: "vsas" }) });

    expect(mocks.redirect).toHaveBeenCalledWith("/vsas/dispatch");
  });
});
