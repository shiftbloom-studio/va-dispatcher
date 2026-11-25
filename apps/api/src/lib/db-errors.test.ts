import { describe, expect, it } from "vitest";
import { isBatchGuardRejection, isUniqueViolation } from "./db-errors.js";

describe("isUniqueViolation", () => {
  it("recognizes direct and wrapped D1 unique errors", () => {
    expect(
      isUniqueViolation(
        new Error(
          "D1_ERROR: UNIQUE constraint failed: tenants.slug: SQLITE_CONSTRAINT",
        ),
      ),
    ).toBe(true);
    expect(
      isUniqueViolation(
        new Error("Failed query", {
          cause: new Error("UNIQUE constraint failed: memberships.id"),
        }),
      ),
    ).toBe(true);
  });

  it("does not hide unrelated database failures", () => {
    expect(
      isUniqueViolation(new Error("FOREIGN KEY constraint failed")),
    ).toBe(false);
    expect(isUniqueViolation(new Error("connection lost"))).toBe(false);
  });
});

describe("isBatchGuardRejection", () => {
  it("recognizes the batch guard check constraint", () => {
    expect(
      isBatchGuardRejection(
        new Error("D1_ERROR: CHECK constraint failed: batch_guard_rejected"),
      ),
    ).toBe(true);
    expect(isBatchGuardRejection(new Error("CHECK constraint failed: x"))).toBe(
      false,
    );
  });
});
