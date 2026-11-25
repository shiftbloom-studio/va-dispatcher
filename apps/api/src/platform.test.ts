import { afterEach, describe, expect, it, vi } from "vitest";

import { identityFetch, setIdentityBindingForTests } from "./platform.js";

const issuer = "https://id.example.test";

describe("identityFetch", () => {
  afterEach(() => {
    setIdentityBindingForTests(null);
    vi.unstubAllGlobals();
  });

  it("sends issuer requests through the IDENTITY binding", async () => {
    const bound = vi.fn(async () => new Response("bound"));
    const network = vi.fn(async () => new Response("network"));
    vi.stubGlobal("fetch", network);
    setIdentityBindingForTests({ fetch: bound } as never);

    const response = await identityFetch(issuer)(`${issuer}/api/auth/jwks`, {
      headers: { Accept: "application/json" },
    });

    expect(await response.text()).toBe("bound");
    expect(network).not.toHaveBeenCalled();
    const [request] = bound.mock.calls[0] as unknown as [Request];
    expect(request.url).toBe(`${issuer}/api/auth/jwks`);
    expect(request.headers.get("Accept")).toBe("application/json");
  });

  it("uses the network for other origins and without a binding", async () => {
    const bound = vi.fn(async () => new Response("bound"));
    const network = vi.fn(async () => new Response("network"));
    vi.stubGlobal("fetch", network);
    setIdentityBindingForTests({ fetch: bound } as never);
    await identityFetch(issuer)("https://elsewhere.example.test/x");
    setIdentityBindingForTests(null);
    await identityFetch(issuer)(`${issuer}/x`);

    expect(bound).not.toHaveBeenCalled();
    expect(network).toHaveBeenCalledTimes(2);
  });
});
