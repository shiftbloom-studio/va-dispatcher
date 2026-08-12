import { afterEach, describe, expect, it, vi } from "vitest";
import {
  e2eFixtureEnabled,
  e2eIntegratedFixtureEnabled,
  e2eRouteFixtureEnabled,
  normalizeE2eIdentity,
} from "@/lib/e2e-fixture";

afterEach(() => vi.unstubAllEnvs());

describe("web E2E fixture boundaries", () => {
  it("keeps both fixture modes hard-off in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_E2E_FIXTURE_MODE", "true");
    vi.stubEnv("NEXT_PUBLIC_E2E_ROUTE_FIXTURE_MODE", "true");

    expect(e2eIntegratedFixtureEnabled()).toBe(false);
    expect(e2eRouteFixtureEnabled()).toBe(false);
    expect(e2eFixtureEnabled()).toBe(false);
  });

  it("distinguishes integrated persistence from fast route fixtures", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("NEXT_PUBLIC_E2E_FIXTURE_MODE", "true");
    vi.stubEnv("NEXT_PUBLIC_E2E_ROUTE_FIXTURE_MODE", "false");
    expect(e2eIntegratedFixtureEnabled()).toBe(true);
    expect(e2eRouteFixtureEnabled()).toBe(false);

    vi.stubEnv("NEXT_PUBLIC_E2E_FIXTURE_MODE", "false");
    vi.stubEnv("NEXT_PUBLIC_E2E_ROUTE_FIXTURE_MODE", "true");
    expect(e2eIntegratedFixtureEnabled()).toBe(false);
    expect(e2eRouteFixtureEnabled()).toBe(true);
  });

  it("defaults unknown browser identities to signed out", () => {
    expect(normalizeE2eIdentity("admin")).toBe("admin");
    expect(normalizeE2eIdentity("outsider")).toBe("outsider");
    expect(normalizeE2eIdentity("outside")).toBe("signed-out");
    expect(normalizeE2eIdentity(undefined)).toBe("signed-out");
  });
});
