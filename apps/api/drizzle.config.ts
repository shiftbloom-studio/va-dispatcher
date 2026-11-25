import { defineConfig } from "drizzle-kit";

/**
 * Generates SQL migrations for Cloudflare D1. Apply them with
 * `wrangler d1 migrations apply` (see apps/api/README.md); drizzle-kit never
 * connects to a remote database from this configuration.
 */
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  verbose: true,
});
