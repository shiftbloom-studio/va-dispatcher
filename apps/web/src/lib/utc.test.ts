import { describe, expect, it } from "vitest";

import {
  availabilityFromPreferences,
  formatUtc,
  isoToUtcInput,
  utcInputToIso,
} from "@/lib/utc";

describe("UTC helpers", () => {
  it("converts datetime-local values as UTC without applying the browser timezone", () => {
    expect(utcInputToIso("2026-09-03T14:25")).toBe("2026-09-03T14:25:00.000Z");
    expect(isoToUtcInput("2026-09-03T14:25:00.000Z")).toBe("2026-09-03T14:25");
  });

  it("rejects impossible and malformed values", () => {
    expect(() => utcInputToIso("2026-02-30T10:00")).toThrow("valid UTC");
    expect(() => utcInputToIso("03/09/2026 14:25")).toThrow("valid UTC");
  });

  it("reads only valid availability arrays and formats with a Zulu suffix", () => {
    const availability = [
      {
        startAt: "2026-09-03T10:00:00.000Z",
        endAt: "2026-09-03T12:00:00.000Z",
      },
    ];
    expect(availabilityFromPreferences({ availability })).toEqual(availability);
    expect(availabilityFromPreferences({ availability: "nope" })).toEqual([]);
    expect(formatUtc(availability[0].startAt)).toMatch(/Z$/);
  });
});
