import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { D1Database } from "@cloudflare/workers-types";
import { defineRelations, is } from "drizzle-orm";
import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";

import { setDbForTests, type Db } from "../db/client.js";
import * as schema from "../db/schema.js";

const migrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../migrations",
);

function migrationStatements(): string[] {
  return readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .flatMap((name) =>
      readFileSync(path.join(migrationsDir, name), "utf8")
        .split("--> statement-breakpoint")
        .map((statement) => statement.trim())
        .filter(Boolean),
    );
}

/** Table names ordered so that every table precedes the tables it references. */
function childrenFirst(): string[] {
  const tables = Object.values(schema).filter((value): value is SQLiteTable => is(value, SQLiteTable));
  const parents = new Map<string, Set<string>>();
  for (const table of tables) {
    const config = getTableConfig(table);
    parents.set(
      config.name,
      new Set(
        config.foreignKeys
          .map((key) => getTableConfig(key.reference().foreignTable).name)
          .filter((name) => name !== config.name),
      ),
    );
  }
  const ordered: string[] = [];
  const visit = (name: string, trail: Set<string>) => {
    if (ordered.includes(name) || trail.has(name)) return;
    trail.add(name);
    for (const [child, references] of parents) {
      if (references.has(name)) visit(child, trail);
    }
    ordered.push(name);
  };
  for (const name of parents.keys()) visit(name, new Set());
  return ordered;
}

export type TestDatabase = {
  db: Db;
  d1: D1Database;
  /** Deletes every row; the schema is kept. */
  reset(): Promise<void>;
  /** Runs raw SQL with positional parameters and returns the rows. */
  query<T = Record<string, unknown>>(
    statement: string,
    ...params: unknown[]
  ): Promise<T[]>;
  dispose(): Promise<void>;
};

/**
 * Local D1 (workerd SQLite) for repository contract tests. Each call starts
 * an isolated, in-memory Miniflare instance through Wrangler.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const directory = mkdtempSync(path.join(tmpdir(), "va-dispatch-d1-"));
  const configPath = path.join(directory, "wrangler.jsonc");
  writeFileSync(
    configPath,
    JSON.stringify({
      name: "va-dispatch-test",
      compatibility_date: "2026-11-20",
      d1_databases: [
        {
          binding: "DB",
          database_name: "va-dispatch-test",
          database_id: "00000000-0000-4000-8000-000000000000",
        },
      ],
    }),
  );
  const proxy = await getPlatformProxy<{ DB: D1Database }>({
    configPath,
    persist: false,
  });
  const d1 = proxy.env.DB;
  const db = drizzle(d1, { relations: defineRelations(schema) }) as Db;
  const statements = migrationStatements();

  async function migrate(): Promise<void> {
    await d1.batch(statements.map((statement) => d1.prepare(statement)));
  }

  const deleteOrder = childrenFirst();

  async function reset(): Promise<void> {
    await d1.batch([
      d1.prepare("PRAGMA defer_foreign_keys = on"),
      ...deleteOrder.map((name) => d1.prepare(`DELETE FROM "${name}"`)),
    ]);
  }

  await migrate();
  setDbForTests(db, d1);

  return {
    db,
    d1,
    reset,
    async query<T>(statement: string, ...params: unknown[]): Promise<T[]> {
      const result = await d1
        .prepare(statement)
        .bind(...params)
        .all<T>();
      return result.results ?? [];
    },
    async dispose() {
      setDbForTests(null);
      await proxy.dispose();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
