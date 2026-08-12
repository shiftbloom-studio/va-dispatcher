import { describe, expect, it } from "vitest";
import { isUniqueViolation } from "./postgres.js";

describe("isUniqueViolation", () => {
  it("recognizes direct and wrapped PostgreSQL unique errors", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(isUniqueViolation({ cause: { code: "23505" } })).toBe(true);
  });

  it("does not hide unrelated database failures", () => {
    expect(isUniqueViolation({ code: "08006" })).toBe(false);
    expect(isUniqueViolation(new Error("connection lost"))).toBe(false);
  });
});
