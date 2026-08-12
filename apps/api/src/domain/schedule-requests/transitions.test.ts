import { describe, expect, it } from "vitest";
import {
  assertScheduleRequestTransition,
  canTransitionScheduleRequest,
} from "./transitions.js";
import { AppError } from "../../lib/errors.js";

describe("schedule request transitions", () => {
  it("supports review and fulfill path", () => {
    expect(canTransitionScheduleRequest("pending", "in_review")).toBe(true);
    expect(canTransitionScheduleRequest("in_review", "fulfilled")).toBe(true);
    expect(
      canTransitionScheduleRequest("in_review", "partially_fulfilled"),
    ).toBe(true);
  });

  it("supports cancel and reject", () => {
    expect(canTransitionScheduleRequest("pending", "cancelled")).toBe(true);
    expect(canTransitionScheduleRequest("pending", "rejected")).toBe(true);
    expect(canTransitionScheduleRequest("in_review", "rejected")).toBe(true);
  });

  it("rejects illegal transitions", () => {
    expect(canTransitionScheduleRequest("fulfilled", "pending")).toBe(false);
    expect(() =>
      assertScheduleRequestTransition("cancelled", "in_review"),
    ).toThrow(AppError);
  });
});
