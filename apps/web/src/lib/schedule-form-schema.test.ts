import { describe, expect, it } from "vitest";

import { scheduleRequestFormSchema } from "@/lib/schedule-form-schema";

const base = {
  desiredFlightCount: 3,
  title: "Autumn flying",
  notes: "",
};

describe("schedule request availability validation", () => {
  it("accepts multiple separated UTC intervals", () => {
    const result = scheduleRequestFormSchema.safeParse({
      ...base,
      availability: [
        { startAt: "2026-09-01T08:00", endAt: "2026-09-01T12:00" },
        { startAt: "2026-09-02T08:00", endAt: "2026-09-02T12:00" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects overlap and end-before-start", () => {
    const overlap = scheduleRequestFormSchema.safeParse({
      ...base,
      availability: [
        { startAt: "2026-09-01T08:00", endAt: "2026-09-01T12:00" },
        { startAt: "2026-09-01T11:00", endAt: "2026-09-01T14:00" },
      ],
    });
    const backwards = scheduleRequestFormSchema.safeParse({
      ...base,
      availability: [
        { startAt: "2026-09-01T12:00", endAt: "2026-09-01T08:00" },
      ],
    });
    expect(overlap.success).toBe(false);
    expect(backwards.success).toBe(false);
  });

  it("enforces the API flight-count range", () => {
    expect(
      scheduleRequestFormSchema.safeParse({
        ...base,
        desiredFlightCount: 0,
        availability: [
          { startAt: "2026-09-01T08:00", endAt: "2026-09-01T12:00" },
        ],
      }).success,
    ).toBe(false);
    expect(
      scheduleRequestFormSchema.safeParse({
        ...base,
        desiredFlightCount: 51,
        availability: [
          { startAt: "2026-09-01T08:00", endAt: "2026-09-01T12:00" },
        ],
      }).success,
    ).toBe(false);
  });
});
