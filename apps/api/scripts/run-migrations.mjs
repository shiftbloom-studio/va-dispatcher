import { resolve } from "node:path";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const target = new URL(databaseUrl);
const databaseName = decodeURIComponent(target.pathname.replace(/^\//, ""));
const confirmation = process.env.MIGRATION_CONFIRM_DATABASE;
if (!databaseName || confirmation !== databaseName) {
  throw new Error(
    "Set MIGRATION_CONFIRM_DATABASE to the exact database name before applying migrations",
  );
}

const apiRoot = resolve(import.meta.dirname, "..");
const requestedFolder = process.env.MIGRATIONS_FOLDER;
if (requestedFolder && process.env.MIGRATION_TEST_MODE !== "true") {
  throw new Error("MIGRATIONS_FOLDER is available only in explicit test mode");
}
const migrationsFolder = requestedFolder
  ? resolve(apiRoot, requestedFolder)
  : resolve(apiRoot, "drizzle");

const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
const lockClient = await pool.connect();

try {
  await lockClient.query("SELECT pg_advisory_lock($1)", [1_987_012_834]);
  const db = drizzle({ client: pool });
  await migrate(db, {
    migrationsFolder,
  });
  console.log(`Migrations applied to ${databaseName}.`);
} finally {
  try {
    await lockClient.query("SELECT pg_advisory_unlock($1)", [1_987_012_834]);
  } finally {
    lockClient.release();
    await pool.end();
  }
}
