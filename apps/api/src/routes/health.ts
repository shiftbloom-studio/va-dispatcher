import { Hono } from "hono";
import { hasDatabase } from "../db/client.js";
import { env } from "../env.js";

export const healthRoutes = new Hono();

healthRoutes.get("/health", (c) => {
  return c.json({
    ok: true,
    service: "va-dispatch-api",
    env: env().NODE_ENV,
    database: hasDatabase(),
    acarsProvider: env().ACARS_PROVIDER,
  });
});
