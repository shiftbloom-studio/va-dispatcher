import type { VercelConfig } from "@vercel/config/v1";

/**
 * Multi-service project: frontend (web) + Hono API backend.
 * Public /api/* → api service; everything else → web.
 */
export const config: VercelConfig = {
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
    },
  },
  rewrites: [
    { source: "/api/(.*)", destination: { service: "api" } },
    { source: "/(.*)", destination: { service: "web" } },
  ],
  /**
   * Hoppie ground stations should poll ~every 45–75s when live.
   * We use every 5 minutes by default to keep free-tier / scale-to-zero
   * costs near zero when traffic is low. Change it to an every-minute cron only when
   * ACARS_PROVIDER=hoppie and you need near-real-time dispatch inbox.
   * Handler no-ops when mock or no Hoppie logons are configured.
   */
  crons: [
    {
      path: "/api/v1/internal/cron/acars-poll",
      schedule: "*/5 * * * *",
    },
  ],
};
