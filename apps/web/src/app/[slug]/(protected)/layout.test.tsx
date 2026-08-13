import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerIdentity: vi.fn(),
  notFound: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));

vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
  redirect: mocks.redirect,
}));
vi.mock("@/lib/server-identity", () => ({
  getServerIdentity: mocks.getServerIdentity,
}));

import ProtectedLayout from "./layout";

describe("protected tenant layout", () => {
  beforeEach(() => vi.clearAllMocks());

  it("routes a signed-in user without an organization to tenant approval", async () => {
    mocks.getServerIdentity.mockResolvedValue({ kind: "join-required" });

    await expect(
      ProtectedLayout({
        children: <div />,
        params: Promise.resolve({ slug: "vsas" }),
      }),
    ).rejects.toThrow("NEXT_REDIRECT:/vsas/join");
    expect(mocks.redirect).toHaveBeenCalledWith("/vsas/join");
  });
});
