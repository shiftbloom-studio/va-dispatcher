/**
 * Multi-service project: frontend (web) + Hono API backend.
 * Public /api/* → api service; everything else → web.
 */
export const config = {
  // GitHub Actions owns deployment ordering so schema synchronization finishes
  // before Vercel can promote the corresponding application revision.
  git: {
    deploymentEnabled: false,
  },
  // Keep server rendering and API/database round trips in the same region as
  // the eu-central-1 Neon database.
  regions: ["fra1"],
  services: {
    web: {
      root: "apps/web",
      framework: "nextjs",
      bindings: [
        {
          type: "service",
          service: "api",
          format: "url",
          env: "API_INTERNAL_URL",
        },
      ],
    },
    api: {
      root: "apps/api",
      framework: "hono",
      // Services validates the entrypoint before running the service build.
      // Keep a checked-in TypeScript entrypoint, then replace it with the
      // dependency-complete bundle inside Vercel's isolated build checkout.
      entrypoint: "vercel-entry.ts",
      // Drizzle v1 prompts instead of applying data-loss statements unless
      // --force is supplied. Never add that flag here: incompatible changes
      // must fail closed and use an explicit migration/recreation plan.
      buildCommand:
        "pnpm db:push:deploy && node scripts/build-vercel-bundle.mjs vercel-entry.ts",
      // Vercel Services currently emits the Hono entrypoint without tracing
      // pnpm workspace dependencies. Bundle them before packaging and retain
      // the ESM package boundary for Vercel's generated app.js wrapper.
      functions: {
        "vercel-entry.ts": {
          includeFiles: "package.json",
        },
      },
    },
  },
  rewrites: [
    { source: "/api/(.*)", destination: { service: "api" } },
    { source: "/(.*)", destination: { service: "web" } },
  ],
  /**
   * Hoppie asks live stations to poll at roughly one-minute intervals. The
   * production handler queries only tenants with an encrypted Hoppie logon.
   * The mock adapter is restricted to local development and tests. A one-minute
   * Vercel cron requires Pro.
   */
  crons: [
    {
      path: "/api/v1/internal/cron/acars-poll",
      schedule: "* * * * *",
    },
    {
      path: "/api/v1/internal/cron/privacy-lifecycle",
      schedule: "0 * * * *",
    },
  ],
};
