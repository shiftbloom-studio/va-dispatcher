import { afterEach, describe, expect, it } from "vitest";
import { loadEnv, resetEnvCache, resolveAppOrigin } from "./env.js";

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

  it("uses Vercel system hostnames only for Preview redirects", () => {
    loadEnv({
      ...productionEnvironment,
      VERCEL_ENV: "preview",
      VERCEL_BRANCH_URL: "va-dispatcher-git-feature-shiftbloom.vercel.app",
      VERCEL_URL: "va-dispatcher-deployment-shiftbloom.vercel.app",
    });
    expect(resolveAppOrigin()).toBe(
      "https://va-dispatcher-git-feature-shiftbloom.vercel.app",
    );

    resetEnvCache();
    const { APP_ORIGIN: _appOrigin, ...withoutAppOrigin } =
      productionEnvironment;
    loadEnv({
      ...withoutAppOrigin,
      VERCEL_ENV: "preview",
      VERCEL_URL: "va-dispatcher-deployment-shiftbloom.vercel.app",
    });
    expect(resolveAppOrigin()).toBe(
      "https://va-dispatcher-deployment-shiftbloom.vercel.app",
    );

    resetEnvCache();
    loadEnv({ ...withoutAppOrigin, VERCEL_ENV: "preview" });
    expect(resolveAppOrigin()).toBeNull();
  });

  it.each([
    "https://preview.example.test",
    "user@preview.example.test",
    "preview.example.test:443",
    "preview.example.test/path",
    "preview.example.test?query=true",
    "preview.example.test#fragment",
  ])("rejects an invalid Vercel Preview hostname: %s", (hostname) => {
    const { APP_ORIGIN: _appOrigin, ...withoutAppOrigin } =
      productionEnvironment;
    loadEnv({
      ...withoutAppOrigin,
      VERCEL_ENV: "preview",
      VERCEL_BRANCH_URL: hostname,
    });
    expect(resolveAppOrigin()).toBeNull();
    resetEnvCache();
  });

  it.each([
    "https://user@app.example.test",
    "https://app.example.test/path",
    "https://app.example.test?query=true",
    "https://app.example.test#fragment",
    "https://app.example.test/",
    "https://app.example.test:443",
    "https://app.example.test?",
    "https://app.example.test#",
    "ftp://app.example.test",
    "file:///tmp/app",
    "ws://app.example.test",
  ])("rejects a non-canonical APP_ORIGIN: %s", (appOrigin) => {
    expect(() =>
      loadEnv({ ...productionEnvironment, APP_ORIGIN: appOrigin }),
    ).toThrow(/APP_ORIGIN must be a canonical HTTP/);
  });

  it("requires explicit APP_ORIGIN for Vercel Production", () => {
    const { APP_ORIGIN: _appOrigin, ...withoutAppOrigin } =
      productionEnvironment;
    expect(() =>
      loadEnv({
        ...withoutAppOrigin,
        NODE_ENV: "development",
        VERCEL_ENV: "production",
        VERCEL_BRANCH_URL: "ignored-preview.example.test",
        VERCEL_URL: "ignored-deployment.example.test",
      }),
    ).toThrow(/missing APP_ORIGIN/);

    expect(() =>
      loadEnv({
        ...withoutAppOrigin,
        VERCEL_ENV: "development",
      }),
    ).toThrow(/missing APP_ORIGIN/);
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
