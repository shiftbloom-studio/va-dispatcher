import { afterEach, describe, expect, it } from "vitest";
import { loadEnv, resetEnvCache } from "../../env.js";
import { tenantLogoKey, tenantLogoUrl } from "./logo-storage.js";

const KEY = "tenant-logos/vsas/0f8c7d2e-5b1a-4c3d-9e8f-123456789abc.png";

describe("tenant logo storage keys", () => {
  afterEach(() => resetEnvCache());

  it("builds public URLs on the configured app origin", () => {
    loadEnv({ NODE_ENV: "test", APP_ORIGIN: "https://va.example.test" });
    expect(tenantLogoUrl(KEY, "http://internal/api/v1/tenant/brand/logo")).toBe(
      "https://va.example.test/api/v1/public/tenant-logos/vsas/0f8c7d2e-5b1a-4c3d-9e8f-123456789abc.png",
    );
  });

  it("falls back to the request origin locally", () => {
    loadEnv({ NODE_ENV: "test" });
    expect(tenantLogoUrl(KEY, "http://localhost:3001/api/v1/x")).toMatch(
      /^http:\/\/localhost:3001\/api\/v1\/public\/tenant-logos\/vsas\//,
    );
  });

  it("maps only well-formed logo paths back to keys", () => {
    expect(tenantLogoKey(KEY.slice("tenant-logos/".length))).toBe(KEY);
    for (const suffix of [
      "vsas/../secret.png",
      "vsas/logo.svg",
      "VSAS/0f8c7d2e-5b1a-4c3d-9e8f-123456789abc.png",
      "vsas/0f8c7d2e-5b1a-4c3d-9e8f-123456789abc.png/extra",
    ]) {
      expect(tenantLogoKey(suffix)).toBeNull();
    }
  });
});
