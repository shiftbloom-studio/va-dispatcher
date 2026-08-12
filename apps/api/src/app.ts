import { Hono } from "hono";
import { cors } from "hono/cors";
import { env, loadEnv } from "./env.js";
import { errorHandler } from "./middleware/error.js";
import { requestId } from "./middleware/request-id.js";
import { healthRoutes } from "./routes/health.js";
import { meRoutes } from "./routes/me.js";
import { tenantRoutes } from "./routes/tenant.js";
import { membersRoutes } from "./routes/members.js";
import { scheduleRequestRoutes } from "./routes/schedule-requests.js";
import { flightRoutes } from "./routes/flights.js";
import { dispatchRoutes } from "./routes/dispatch.js";
import { acarsRoutes } from "./routes/acars.js";
import { internalRoutes } from "./routes/internal.js";
import type { AppVariables } from "./middleware/auth.js";

// Ensure env is loaded once at import for local/dev.
loadEnv();

export function createApp() {
  const app = new Hono<{ Variables: AppVariables }>();

  app.use("*", requestId);
  app.use(
    "*",
    cors({
      origin: env().CORS_ORIGIN.split(",").map((s) => s.trim()),
      allowHeaders: [
        "Authorization",
        "Content-Type",
        "X-Request-Id",
        "X-Dev-User-Id",
        "X-Dev-Org-Id",
        "X-Dev-Role",
      ],
      exposeHeaders: ["X-Request-Id"],
    }),
  );

  app.onError(errorHandler);

  // Health at root and under /api for rewrite compatibility
  app.route("/", healthRoutes);
  app.route("/api", healthRoutes);

  const v1 = new Hono<{ Variables: AppVariables }>();
  v1.route("/", meRoutes);
  v1.route("/", tenantRoutes);
  v1.route("/", membersRoutes);
  v1.route("/", scheduleRequestRoutes);
  v1.route("/", flightRoutes);
  v1.route("/", dispatchRoutes);
  v1.route("/", acarsRoutes);
  v1.route("/", internalRoutes);

  app.route("/api/v1", v1);
  // Also mount at /v1 when service-scoped rewrite strips /api
  app.route("/v1", v1);

  app.notFound((c) =>
    c.json(
      {
        error: {
          code: "NOT_FOUND",
          message: `Route not found: ${c.req.method} ${c.req.path}`,
        },
      },
      404,
    ),
  );

  return app;
}

/** Default export for Vercel Hono detection (src/index.ts re-exports). */
const app = createApp();
export default app;
