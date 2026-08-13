import { neon } from "@neondatabase/serverless";
import { defineRelations } from "drizzle-orm";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema.js";
import { env } from "../env.js";
import { AppError } from "../lib/errors.js";

const relations = defineRelations(schema);

export type Db = NeonHttpDatabase<typeof relations>;

let dbInstance: Db | null = null;

export function getDb(): Db {
  if (dbInstance) return dbInstance;
  const url = env().DATABASE_URL;
  if (!url) {
    throw new AppError("INTERNAL", "DATABASE_URL is not configured", {
      status: 503,
    });
  }
  const sql = neon(url);
  dbInstance = drizzle({ client: sql, relations });
  return dbInstance;
}

export function hasDatabase(): boolean {
  return Boolean(env().DATABASE_URL);
}

/**
 * Verify the schema needed to resolve every authenticated workspace. Selecting
 * zero rows still makes PostgreSQL validate the complete Drizzle projection,
 * catching code/schema skew without exposing or scanning tenant data.
 */
export async function verifyWorkspaceDatabaseSchema(): Promise<void> {
  const db = getDb();
  await Promise.all([
    db.select().from(schema.tenants).limit(0),
    db.select().from(schema.memberships).limit(0),
  ]);
}

/** Test helper */
export function setDbForTests(db: Db | null): void {
  dbInstance = db;
}
