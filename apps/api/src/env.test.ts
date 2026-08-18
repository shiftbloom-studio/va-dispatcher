import { afterEach, describe, expect, it } from "vitest";
import { loadEnv, resetEnvCache } from "./env.js";

const productionEnvironment = {
  NODE_ENV: "production",
  APP_ORIGIN: "https://app.example.test",
  DATABASE_URL: "postgresql://user:pass@localhost/va_dispatch",
  CLERK_SECRET_KEY: "sk_test_configured",
  TENANT_SECRETS_KEY: Buffer.alloc(32).toString("base64"),
  CRON_SECRET: "production-cron-secret",
} as const;

afterEach(() => resetEnvCache());

describe("runtime environment validation", () => {
  it("requires production credentials and a non-default cron secret", () => {
    expect(() => loadEnv({ NODE_ENV: "production" })).toThrow(
      /APP_ORIGIN, DATABASE_URL, CLERK_SECRET_KEY, TENANT_SECRETS_KEY/,
    );
    expect(() =>
      loadEnv({
        ...productionEnvironment,
        CRON_SECRET: "dev-cron-secret-change-me",
      }),
    ).toThrow(/CRON_SECRET must not use the development default/);
    expect(() =>
      loadEnv({
        ...productionEnvironment,
        APP_ORIGIN: "http://app.example.test",
      }),
    ).toThrow(/APP_ORIGIN must use HTTPS/);
  });

  it("forbids every authentication fixture mode in production", () => {
    expect(() =>
      loadEnv({ ...productionEnvironment, AUTH_DEV_BYPASS: "true" }),
    ).toThrow(/AUTH_DEV_BYPASS is forbidden/);
    expect(() =>
      loadEnv({
        ...productionEnvironment,
        AUTH_DEV_BYPASS: "true",
        E2E_FIXTURE_MODE: "true",
        E2E_FIXTURE_SECRET: "fixture-secret-that-is-at-least-32-characters",
        E2E_CONFIRM_DATABASE: "va_dispatch_e2e",
      }),
    ).toThrow(/E2E fixture mode is forbidden/);
  });

  it("requires explicit authority and database confirmation for E2E mode", () => {
    expect(() =>
      loadEnv({
        NODE_ENV: "test",
        AUTH_DEV_BYPASS: "true",
        E2E_FIXTURE_MODE: "true",
      }),
    ).toThrow(/E2E_FIXTURE_SECRET, E2E_CONFIRM_DATABASE/);
  });

  it("accepts complete production and isolated E2E environments", () => {
    expect(loadEnv(productionEnvironment).NODE_ENV).toBe("production");
    resetEnvCache();
    expect(
      loadEnv({
        NODE_ENV: "test",
        AUTH_DEV_BYPASS: "true",
        E2E_FIXTURE_MODE: "true",
        E2E_FIXTURE_SECRET: "fixture-secret-that-is-at-least-32-characters",
        E2E_CONFIRM_DATABASE: "va_dispatch_e2e",
      }),
    ).toMatchObject({ E2E_FIXTURE_MODE: true, AUTH_DEV_BYPASS: true });
  });
});
