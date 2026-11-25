/**
 * D1 reports SQLite constraint failures as error messages such as
 * `D1_ERROR: UNIQUE constraint failed: memberships.tenant_id, ...`.
 * Drizzle wraps driver errors, so the whole cause chain is inspected.
 */
function someErrorInChain(
  error: unknown,
  predicate: (message: string) => boolean,
): boolean {
  const seen = new Set<unknown>();
  let current = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const candidate = current as { message?: unknown; cause?: unknown };
    if (typeof candidate.message === "string" && predicate(candidate.message)) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

/** SQLite unique-constraint (or primary-key) violation, including wrapped errors. */
export function isUniqueViolation(error: unknown): boolean {
  return someErrorInChain(
    error,
    (message) =>
      message.includes("UNIQUE constraint failed") ||
      message.includes("SQLITE_CONSTRAINT_UNIQUE") ||
      message.includes("SQLITE_CONSTRAINT_PRIMARYKEY"),
  );
}

/** A guarded atomic batch was rejected by `batch_guard_rejected`. */
export function isBatchGuardRejection(error: unknown): boolean {
  return someErrorInChain(error, (message) =>
    message.includes("batch_guard_rejected"),
  );
}
