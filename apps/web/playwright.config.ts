import { defineConfig, devices } from "@playwright/test";

const e2ePort = Number(process.env.E2E_PORT ?? "3100");
if (!Number.isInteger(e2ePort) || e2ePort < 1 || e2ePort > 65_535) {
  throw new Error("E2E_PORT must be a valid TCP port.");
}
const localBaseUrl = `http://127.0.0.1:${e2ePort}`;

export default defineConfig({
  testDir: "./e2e",
  testIgnore: "**/integrated/**",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? localBaseUrl,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `pnpm exec next dev --port ${e2ePort}`,
        url: localBaseUrl,
        reuseExistingServer: false,
        env: {
          NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:
            process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??
            "pk_test_ZXhhbXBsZS5jbGVyay5hY2NvdW50cy5kZXYk",
          CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY ?? "sk_test_example",
          NEXT_PUBLIC_E2E_ROUTE_FIXTURE_MODE: "true",
          LEGAL_OPERATOR_NAME: "Example Aviation e.V.",
          LEGAL_OPERATOR_ADDRESS: "Example Street 1|10115 Berlin|Germany",
          LEGAL_OPERATOR_EMAIL: "legal@example.test",
          LEGAL_PRIVACY_EMAIL: "privacy@example.test",
          LEGAL_SUPERVISORY_AUTHORITY_NAME: "Example authority",
          LEGAL_SUPERVISORY_AUTHORITY_URL: "https://authority.example.test",
        },
      },
});
