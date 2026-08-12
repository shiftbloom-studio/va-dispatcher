import { describe, expect, it } from "vitest";

import { createApp } from "./app.js";

describe("API security headers", () => {
  it("applies privacy and browser hardening headers", async () => {
    const response = await createApp().request("/health");

    expect(response.status).toBe(200);
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("x-dns-prefetch-control")).toBe("off");
    expect(response.headers.get("permissions-policy")).toContain("camera=()");
    expect(response.headers.get("permissions-policy")).toContain(
      "browsing-topics=()",
    );
  });
});
