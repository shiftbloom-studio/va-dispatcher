import { Hono } from "hono";
import { hasDatabase, verifyWorkspaceDatabaseSchema } from "../db/client.js";
import { env } from "../env.js";
import { activeAcarsProviderName } from "../acars/factory.js";

export const healthRoutes = new Hono();

healthRoutes.get("/health", (c) => {
  return c.json({
    ok: true,
    service: "va-dispatch-api",
    env: env().NODE_ENV,
    database: hasDatabase(),
    acarsProvider: activeAcarsProviderName(),
  });
});

healthRoutes.get("/ready", async (c) => {
  if (!hasDatabase()) {
    return c.json(
      {
        ok: false,
        service: "va-dispatch-api",
        database: false,
        schema: false,
      },
      503,
    );
  }

  try {
    await verifyWorkspaceDatabaseSchema();
    return c.json({
      ok: true,
      service: "va-dispatch-api",
      database: true,
      schema: true,
    });
  } catch {
    return c.json(
      {
        ok: false,
        service: "va-dispatch-api",
        database: true,
        schema: false,
      },
      503,
    );
  }
});
