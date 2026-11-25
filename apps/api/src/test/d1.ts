import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { D1Database } from "@cloudflare/workers-types";
import { defineRelations } from "drizzle-orm";
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

export type TestDatabase = {
  db: Db;
  d1: D1Database;
  /** Drops every table and re-applies the migrations. */
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

  async function reset(): Promise<void> {
    const tables = await d1
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
      )
      .all<{ name: string }>();
    await d1.batch([
      d1.prepare("PRAGMA defer_foreign_keys = on"),
      ...tables.results.map(({ name }) =>
        d1.prepare(`DROP TABLE IF EXISTS "${name}"`),
      ),
    ]);
    await migrate();
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
