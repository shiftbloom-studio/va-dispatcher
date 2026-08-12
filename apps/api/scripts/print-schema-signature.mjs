import pg from "pg";
import { readSchemaSignature } from "./migration-signature.mjs";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
try {
  const signature = await readSchemaSignature(pool);
  console.log(signature.sha256);
} finally {
  await pool.end();
}
