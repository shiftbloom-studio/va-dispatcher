import { defineConfig, devices } from "@playwright/test";

const webPort = validPort("E2E_INTEGRATED_WEB_PORT", 3200);
const apiPort = validPort("E2E_INTEGRATED_API_PORT", 3201);
const webOrigin = `http://127.0.0.1:${webPort}`;
const apiOrigin = `http://127.0.0.1:${apiPort}`;
const databaseUrl = required("E2E_DATABASE_URL");
const databaseName = required("E2E_CONFIRM_DATABASE");
const fixtureSecret =
  process.env.E2E_FIXTURE_SECRET ??
  "local-integrated-e2e-authority-not-for-production";
const tenantSecretsKey =
  process.env.E2E_TENANT_SECRETS_KEY ?? Buffer.alloc(32, 28).toString("base64");

export default defineConfig({
  testDir: "./e2e/integrated",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  outputDir: "test-results/integrated",
  use: {
    baseURL: webOrigin,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "integrated-chromium", use: devices["Desktop Chrome"] }],
  webServer: [
    {
      command: "../api/node_modules/.bin/tsx ../api/src/e2e-server.ts",
      url: `${apiOrigin}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        NODE_ENV: "test",
        PORT: String(apiPort),
        CORS_ORIGIN: webOrigin,
        DATABASE_URL: databaseUrl,
        AUTH_DEV_BYPASS: "true",
        E2E_FIXTURE_MODE: "true",
        E2E_FIXTURE_SECRET: fixtureSecret,
        E2E_CONFIRM_DATABASE: databaseName,
        ACARS_PROVIDER: "mock",
        CRON_SECRET: "isolated-e2e-cron-authority",
        VSAS_CLERK_ORG_ID: "org_e2e_vsas",
        TENANT_SECRETS_KEY: tenantSecretsKey,
        SIMBRIEF_API_KEY: "integrated-e2e-simbrief-api-key",
        SIMBRIEF_CALLBACK_URL: `${apiOrigin}/api/v1/simbrief/callback`,
        NAVIGRAPH_CLIENT_ID: "integrated-e2e-client",
        NAVIGRAPH_CLIENT_SECRET: "integrated-e2e-client-secret",
        NAVIGRAPH_REDIRECT_URI: `${apiOrigin}/api/v1/simbrief/oauth/callback`,
        AVIATION_WEATHER_API_ORIGIN: `${apiOrigin}/__e2e/weather`,
      },
    },
    {
      command: `node_modules/.bin/next dev --port ${webPort}`,
      url: webOrigin,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        API_ORIGIN: apiOrigin,
        API_INTERNAL_URL: apiOrigin,
        NEXT_PUBLIC_E2E_FIXTURE_MODE: "true",
        E2E_FIXTURE_SECRET: fixtureSecret,
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:
          "pk_test_ZXhhbXBsZS5jbGVyay5hY2NvdW50cy5kZXYk",
        CLERK_SECRET_KEY: "sk_test_integrated_fixture_not_used",
        LEGAL_OPERATOR_NAME: "Example Aviation e.V.",
        LEGAL_OPERATOR_ADDRESS: "Example Street 1|10115 Berlin|Germany",
        LEGAL_OPERATOR_EMAIL: "legal@example.test",
        LEGAL_PRIVACY_EMAIL: "privacy@example.test",
        LEGAL_SUPERVISORY_AUTHORITY_NAME: "Example authority",
        LEGAL_SUPERVISORY_AUTHORITY_URL: "https://authority.example.test",
      },
    },
  ],
});

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for integrated E2E`);
  return value;
}

function validPort(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`${name} must be a valid TCP port`);
  }
  return value;
}
