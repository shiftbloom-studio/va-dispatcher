import type { D1Database } from "@cloudflare/workers-types";
import { defineRelations } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "./schema.js";
import { AppError } from "../lib/errors.js";

const relations = defineRelations(schema);

export type Db = DrizzleD1Database<typeof relations>;

let binding: D1Database | null = null;
let dbInstance: Db | null = null;

/**
 * Registers the D1 binding for this isolate. The Worker entrypoint calls this
 * on every request and scheduled event; the binding is stable for the
 * lifetime of the isolate, so the Drizzle instance is reused.
 */
export function bindDatabase(database: D1Database | undefined | null): void {
  if (!database) return;
  if (database === binding && dbInstance) return;
  binding = database;
  dbInstance = drizzle(database, { relations });
}

export function getDb(): Db {
  if (dbInstance) return dbInstance;
  throw new AppError("INTERNAL", "The D1 database binding is not configured", {
    status: 503,
  });
}

/** Raw D1 binding, used for multi-statement atomic batches. */
export function getD1(): D1Database {
  if (binding) return binding;
  throw new AppError("INTERNAL", "The D1 database binding is not configured", {
    status: 503,
  });
}

export function hasDatabase(): boolean {
  return dbInstance !== null;
}

/**
 * Verify the schema needed to resolve every authenticated workspace. Selecting
 * zero rows still makes SQLite validate the complete Drizzle projection,
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
export function setDbForTests(
  db: Db | null,
  database: D1Database | null = null,
): void {
  dbInstance = db;
  binding = database;
}
