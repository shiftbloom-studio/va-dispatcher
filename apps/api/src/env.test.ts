import { afterEach, describe, expect, it } from "vitest";
import { loadEnv, resetEnvCache, resolveAppOrigin } from "./env.js";

const productionEnvironment = {
  NODE_ENV: "production",
  APP_ORIGIN: "https://app.example.test",
  AUTH_ISSUER: "https://auth.example.test",
  AUTH_AUDIENCE: "va-dispatch-api",
  AUTH_CLIENT_ID: "va-client",
  TENANT_SECRETS_KEY: Buffer.alloc(32).toString("base64"),
  CRON_SECRET: "production-cron-secret",
} as const;

afterEach(() => resetEnvCache());

describe("runtime environment validation", () => {
  it("treats empty optional identity settings from the deploy template as unset", () => {
    const config = loadEnv({
      NODE_ENV: "test",
      AUTH_JWKS_URL: "",
      AUTH_CLIENT_ID: "",
    });
    expect(config.AUTH_JWKS_URL).toBeUndefined();
    expect(config.AUTH_CLIENT_ID).toBeUndefined();
  });

  it("requires production credentials and a non-default cron secret", () => {
    expect(() => loadEnv({ NODE_ENV: "production" })).toThrow(
      /APP_ORIGIN, AUTH_ISSUER, AUTH_AUDIENCE, AUTH_CLIENT_ID, TENANT_SECRETS_KEY/,
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
      }),
    ).toThrow(/E2E fixture mode is forbidden/);
  });

  it("uses the configured origin for preview redirects and allows none", () => {
    loadEnv({
      ...productionEnvironment,
      APP_ENV: "preview",
      APP_ORIGIN: "https://preview.example.test",
    });
    expect(resolveAppOrigin()).toBe("https://preview.example.test");

    resetEnvCache();
    const { APP_ORIGIN: _appOrigin, ...withoutAppOrigin } =
      productionEnvironment;
    loadEnv({ ...withoutAppOrigin, APP_ENV: "preview" });
    expect(resolveAppOrigin()).toBeNull();
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

  it("requires explicit APP_ORIGIN for production deployments", () => {
    const { APP_ORIGIN: _appOrigin, ...withoutAppOrigin } =
      productionEnvironment;
    expect(() =>
      loadEnv({
        ...withoutAppOrigin,
        NODE_ENV: "development",
        APP_ENV: "production",
      }),
    ).toThrow(/missing APP_ORIGIN/);

    expect(() =>
      loadEnv({
        ...withoutAppOrigin,
        APP_ENV: "development",
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
    ).toThrow(/missing E2E_FIXTURE_SECRET/);
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
      }),
    ).toMatchObject({ E2E_FIXTURE_MODE: true, AUTH_DEV_BYPASS: true });
  });
});
