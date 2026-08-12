import { defineConfig } from "drizzle-kit";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for drizzle-kit");
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  dialect: "postgresql",
  // Keep schema operations scoped to application-owned tables. Neon provisions
  // its own schemas alongside `public`, which must never be managed by Drizzle.
  schemaFilter: ["public"],
  dbCredentials: {
    url: databaseUrl,
  },
  verbose: true,
});
