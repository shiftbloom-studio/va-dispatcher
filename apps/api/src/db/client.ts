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
    throw new AppError(
      "INTERNAL",
      "DATABASE_URL is not configured",
      { status: 503 },
    );
  }
  const sql = neon(url);
  dbInstance = drizzle({ client: sql, relations });
  return dbInstance;
}

export function hasDatabase(): boolean {
  return Boolean(env().DATABASE_URL);
}

/** Test helper */
export function setDbForTests(db: Db | null): void {
  dbInstance = db;
}
