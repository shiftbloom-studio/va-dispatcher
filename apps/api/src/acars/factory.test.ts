import { afterEach, describe, expect, it } from "vitest";
import type { Tenant } from "../db/schema.js";
import { loadEnv, resetEnvCache } from "../env.js";
import {
  activeAcarsProviderName,
  createAcarsProvider,
  isMockAcarsEnabled,
} from "./factory.js";

const tenant: Tenant = {
  id: "tenant_test",
  slug: "vsas",
  name: "Virtual SAS",
  clerkOrgId: "org_test",
  hoppieStation: "SAS",
  hoppieLogonEnc: null,
  brandSeedColor: "#e64646",
  brandPresence: "balanced",
  brandLogoUrl: null,
  brandLogoPathname: null,
  settings: {},
  createdAt: new Date("2026-08-12T00:00:00.000Z"),
  updatedAt: new Date("2026-08-12T00:00:00.000Z"),
};

const productionEnvironment = {
  DATABASE_URL: "postgresql://user:pass@localhost/va_dispatch",
  CLERK_SECRET_KEY: "sk_test_configured",
  TENANT_SECRETS_KEY: Buffer.alloc(32).toString("base64"),
  CRON_SECRET: "production-cron-secret",
} as const;

afterEach(() => {
  resetEnvCache();
});

describe("ACARS provider selection", () => {
  it("allows the internal mock adapter in test environments", () => {
    loadEnv({
      ...process.env,
      NODE_ENV: "test",
      ACARS_PROVIDER: "mock",
    });

    expect(isMockAcarsEnabled()).toBe(true);
    expect(activeAcarsProviderName()).toBe("mock");
    expect(createAcarsProvider(tenant).name).toBe("mock");
  });

  it("forces Hoppie and fails closed in production despite a stale mock value", () => {
    loadEnv({
      ...process.env,
      ...productionEnvironment,
      NODE_ENV: "production",
      ACARS_PROVIDER: "mock",
    });

    expect(isMockAcarsEnabled()).toBe(false);
    expect(activeAcarsProviderName()).toBe("hoppie");
    let providerError: unknown;
    try {
      createAcarsProvider(tenant);
    } catch (error) {
      providerError = error;
    }
    expect(providerError).toMatchObject({
      code: "not_configured",
      message: "Hoppie ACARS is not configured for this Virtual Airline.",
    });
  });

  it("allows the internal adapter in a Vercel preview", () => {
    loadEnv({
      ...process.env,
      ...productionEnvironment,
      NODE_ENV: "production",
      VERCEL_ENV: "preview",
      ACARS_PROVIDER: "mock",
    });

    expect(isMockAcarsEnabled()).toBe(true);
    expect(activeAcarsProviderName()).toBe("mock");
  });
});
