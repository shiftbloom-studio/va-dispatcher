/**
 * Multi-service project: frontend (web) + Hono API backend.
 * Public /api/* → api service; everything else → web.
 */
export const config = {
  framework: null,
  services: {
    web: {
      root: "apps/web",
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
      entrypoint: "src/index.ts",
    },
  },
  rewrites: [
    { source: "/api/(.*)", destination: { service: "api" } },
    { source: "/(.*)", destination: { service: "web" } },
  ],
  /**
   * Hoppie asks live stations to poll at roughly one-minute intervals. The
   * handler exits before DB access unless ACARS_PROVIDER=hoppie, then queries
   * only tenants with an encrypted Hoppie logon. A one-minute Vercel cron
   * requires Pro.
   */
  crons: [
    {
      path: "/api/v1/internal/cron/acars-poll",
      schedule: "* * * * *",
    },
  ],
};
