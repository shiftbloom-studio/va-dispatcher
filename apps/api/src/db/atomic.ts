import type { D1PreparedStatement } from "@cloudflare/workers-types";
import { sql, type SQL } from "drizzle-orm";
import { SQLiteDialect } from "drizzle-orm/sqlite-core";
import { getD1 } from "./client.js";
import { isBatchGuardRejection } from "../lib/db-errors.js";

/**
 * Atomic multi-statement writes for Cloudflare D1.
 *
 * D1 has no interactive transactions. A `batch()` is, however, executed as a
 * single SQLite transaction, and D1 serializes all writes to one database.
 * The repositories therefore express each compare-and-set operation as:
 *
 *   1. one or more `guard(condition)` statements that abort the batch when a
 *      precondition (version, status, ownership, capacity, ...) does not hold;
 *   2. unconditional writes that may read the current state in subqueries;
 *   3. optional trailing SELECTs that return the post-state.
 *
 * A failed guard rolls back every statement in the batch and `runAtomic`
 * resolves to `null`, which matches the "zero rows" result the previous
 * single-statement PostgreSQL CTEs produced.
 */

const dialect = new SQLiteDialect();

/** D1 accepts at most 100 bound parameters in a single statement. */
export const D1_MAX_BOUND_PARAMETERS = 100;

export function guard(condition: SQL): SQL {
  return sql`INSERT INTO batch_guards (reason) SELECT 'rejected' WHERE NOT (${condition})`;
}

/** Epoch milliseconds, the storage format of every timestamp column. */
export function ms(value: Date): number {
  return value.getTime();
}

/** JSON text for a JSON column or `json()` expression. */
export function json(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function toD1Value(value: unknown): unknown {
  if (value === undefined) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "bigint") return Number(value);
  return value;
}

/** A raw SQL fragment or a Drizzle query builder (insert/update/delete/select). */
export type AtomicStatement =
  | SQL
  | { toSQL(): { sql: string; params: unknown[] } };

function compile(statement: AtomicStatement): {
  sql: string;
  params: unknown[];
} {
  if (isSql(statement)) return dialect.sqlToQuery(statement);
  return statement.toSQL();
}

export function prepare(statement: AtomicStatement): D1PreparedStatement {
  const query = compile(statement);
  if (query.params.length > D1_MAX_BOUND_PARAMETERS) {
    throw new Error(
      `D1 statement binds ${query.params.length} parameters; the limit is ${D1_MAX_BOUND_PARAMETERS}`,
    );
  }
  return getD1()
    .prepare(query.sql)
    .bind(...query.params.map(toD1Value));
}

/**
 * Runs the statements in one D1 transaction. Returns the rows of every
 * statement, or `null` when a guard rejected the batch.
 */
export async function runAtomic<
  T extends Record<string, unknown> = Record<string, unknown>,
>(statements: readonly AtomicStatement[]): Promise<T[][] | null> {
  if (statements.length === 0) return [];
  try {
    const results = await getD1().batch<T>(statements.map(prepare));
    return results.map((result) => result.results ?? []);
  } catch (error) {
    if (isBatchGuardRejection(error)) return null;
    throw error;
  }
}

/** Runs one raw statement and returns its rows. */
export async function queryRows<
  T extends Record<string, unknown> = Record<string, unknown>,
>(statement: AtomicStatement): Promise<T[]> {
  const result = await prepare(statement).all<T>();
  return result.results ?? [];
}

/** Splits values so each chunk can be bound without exceeding D1 limits. */
export function chunk<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

/** SQL fragment for an audit-event insert, used inside atomic batches. */
export function insertAudit(input: {
  tenantId: string | SQL;
  actorMembershipId: string | null | SQL;
  action: string;
  entityType: string;
  entityId: string | SQL;
  meta: Record<string, unknown> | SQL;
  createdAt?: Date;
  /** Optional predicate; the audit row is only written when it holds. */
  when?: SQL;
  /**
   * Optional `FROM` source (e.g. `memberships WHERE ...`); one audit row is
   * written per source row, and column names may be used in the values.
   */
  from?: SQL;
}): SQL {
  const meta =
    input.meta && typeof input.meta === "object" && !isSql(input.meta)
      ? sql`json(${json(input.meta)})`
      : input.meta;
  const createdAt = input.createdAt
    ? sql`${ms(input.createdAt)}`
    : sql`cast(unixepoch('subsec') * 1000 as integer)`;
  return sql`
    INSERT INTO audit_events (
      tenant_id, actor_membership_id, action, entity_type, entity_id, meta,
      created_at
    )
    SELECT ${input.tenantId}, ${input.actorMembershipId}, ${input.action},
      ${input.entityType}, ${input.entityId}, ${meta}, ${createdAt}
    ${input.from ? sql`FROM ${input.from}` : sql``}
    ${input.when ? (input.from ? sql`AND ${input.when}` : sql`WHERE ${input.when}`) : sql``}
  `;
}

function isSql(value: unknown): value is SQL {
  return (
    typeof value === "object" &&
    value !== null &&
    "queryChunks" in (value as Record<string, unknown>)
  );
}

/**
 * ISO-8601 UTC string (`YYYY-MM-DDTHH:MM:SS.mmmZ`, identical to
 * `Date#toISOString`) for an epoch-millisecond column expression. Built from
 * integer arithmetic so milliseconds are exact.
 */
export function isoTimestampSql(column: SQL): SQL {
  return sql`(strftime('%Y-%m-%dT%H:%M:%S', ${column} / 1000, 'unixepoch') || '.' || printf('%03d', ${column} % 1000) || 'Z')`;
}

/** JSON `true`/`false` (not 1/0) for a boolean SQL expression. */
export function jsonBooleanSql(condition: SQL): SQL {
  return sql`json(CASE WHEN ${condition} THEN 'true' ELSE 'false' END)`;
}
