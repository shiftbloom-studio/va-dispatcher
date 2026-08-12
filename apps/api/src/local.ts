import { serve } from "@hono/node-server";
import app from "./app.js";
import { env } from "./env.js";

const port = env().PORT;

console.log(`VA Dispatch API listening on http://localhost:${port}`);
console.log(`  health:  GET /health`);
console.log(`  api:     /api/v1/*`);
console.log(`  acars:   ${env().ACARS_PROVIDER}`);
console.log(
  `  auth:    ${env().AUTH_DEV_BYPASS ? "DEV BYPASS" : "Clerk JWT"}`,
);

serve({
  fetch: app.fetch,
  port,
});
