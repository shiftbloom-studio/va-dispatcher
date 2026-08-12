import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { env, loadEnv } from "./env.js";
import { errorHandler } from "./middleware/error.js";
import { requireHuman } from "./middleware/botid.js";
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
import { docsRoutes } from "./routes/docs.js";
import { simbriefPublicRoutes, simbriefRoutes } from "./routes/simbrief.js";
import { publicRoutes } from "./routes/public.js";
import { auditRoutes } from "./routes/audit.js";
import type { AppVariables } from "./middleware/auth.js";

// Ensure env is loaded once at import for local/dev.
loadEnv();

export function createApp() {
  const app = new Hono<{ Variables: AppVariables }>();

  app.use("*", requestId);
  app.use(
    "*",
    secureHeaders({
      // The API is a same-origin JSON service in the primary deployment and
      // also supports an explicitly configured CORS origin in fallback
      // deployments. Document-focused isolation headers would block that use.
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: false,
      crossOriginResourcePolicy: false,
      originAgentCluster: false,
      referrerPolicy: "no-referrer",
      strictTransportSecurity:
        env().NODE_ENV === "production" ? "max-age=31536000" : false,
      xFrameOptions: "DENY",
      permissionsPolicy: {
        browsingTopics: [],
        camera: [],
        geolocation: [],
        microphone: [],
        payment: [],
        usb: [],
      },
    }),
  );
  app.use(
    "*",
    cors({
      origin: env()
        .CORS_ORIGIN.split(",")
        .map((origin) => origin.trim()),
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

  // Documentation is public and mounted both before and after the Vercel
  // rewrite boundary, matching the API's dual-path deployment support.
  app.route("/docs", docsRoutes);
  app.route("/api/docs", docsRoutes);

  // Health at root and under /api for rewrite compatibility
  app.route("/", healthRoutes);
  app.route("/api", healthRoutes);

  const v1 = new Hono<{ Variables: AppVariables }>();
  // Internal routes authenticate with their own secrets. Mount them before the
  // business-route auth middleware, whose wildcard also matches later routes.
  v1.route("/", internalRoutes);
  v1.route("/", simbriefPublicRoutes);
  v1.route("/", publicRoutes);
  v1.use("*", requireHuman);
  v1.route("/", meRoutes);
  v1.route("/", tenantRoutes);
  v1.route("/", membersRoutes);
  v1.route("/", auditRoutes);
  v1.route("/", scheduleRequestRoutes);
  v1.route("/", flightRoutes);
  v1.route("/", dispatchRoutes);
  v1.route("/", acarsRoutes);
  v1.route("/", simbriefRoutes);

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
