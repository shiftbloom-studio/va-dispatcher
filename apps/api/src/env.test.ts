import { afterEach, describe, expect, it } from "vitest";
import { loadEnv, resetEnvCache } from "./env.js";

const productionEnvironment = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://user:pass@localhost/va_dispatch",
  CLERK_SECRET_KEY: "sk_test_configured",
  TENANT_SECRETS_KEY: Buffer.alloc(32).toString("base64"),
  CRON_SECRET: "production-cron-secret",
} as const;

afterEach(() => {
  resetEnvCache();
});

describe("production environment validation", () => {
  it("requires the credentials used by authenticated and internal routes", () => {
    expect(() => loadEnv({ NODE_ENV: "production" })).toThrow(
      /DATABASE_URL, CLERK_SECRET_KEY, TENANT_SECRETS_KEY/,
    );
  });

  it("rejects the checked-in cron secret", () => {
    expect(() =>
      loadEnv({
        ...productionEnvironment,
        CRON_SECRET: "dev-cron-secret-change-me",
      }),
    ).toThrow(/CRON_SECRET must not use the development default/);
  });

  it("accepts an explicitly configured production environment", () => {
    expect(loadEnv(productionEnvironment)).toMatchObject({
      NODE_ENV: "production",
      CRON_SECRET: "production-cron-secret",
    });
  });
});
