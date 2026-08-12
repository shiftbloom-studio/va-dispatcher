import { describe, expect, it } from "vitest";

import {
  assertFlightInsideAvailability,
  normalizeAvailability,
} from "./availability.js";

const windowStart = new Date("2026-09-10T08:00:00.000Z");
const windowEnd = new Date("2026-09-11T18:00:00.000Z");

describe("schedule availability normalization", () => {
  it("sorts valid intervals and preserves unrelated preferences", () => {
    const normalized = normalizeAvailability({
      windowStart,
      windowEnd,
      preferences: {
        aircraft: "A320",
        availability: [
          {
            startAt: "2026-09-11T14:00:00.000Z",
            endAt: "2026-09-11T18:00:00.000Z",
          },
          {
            startAt: "2026-09-10T08:00:00.000Z",
            endAt: "2026-09-10T12:00:00.000Z",
          },
        ],
      },
    });

    expect(normalized.preferences).toEqual({
      aircraft: "A320",
      availability: [
        {
          startAt: "2026-09-10T08:00:00.000Z",
          endAt: "2026-09-10T12:00:00.000Z",
        },
        {
          startAt: "2026-09-11T14:00:00.000Z",
          endAt: "2026-09-11T18:00:00.000Z",
        },
      ],
    });
  });

  it.each([
    { availability: [] },
    {
      availability: [
        {
          startAt: "not-a-date",
          endAt: "2026-09-10T12:00:00.000Z",
        },
      ],
    },
    {
      availability: [
        {
          startAt: "2026-09-10T08:00:00.000Z",
          endAt: "2026-09-10T12:00:00.000Z",
        },
        {
          startAt: "2026-09-10T11:00:00.000Z",
          endAt: "2026-09-11T18:00:00.000Z",
        },
      ],
    },
  ])("rejects malformed or overlapping availability", (preferences) => {
    expect(() =>
      normalizeAvailability({ windowStart, windowEnd, preferences }),
    ).toThrow();
  });

  it("requires the overall envelope to match normalized intervals", () => {
    expect(() =>
      normalizeAvailability({
        windowStart,
        windowEnd,
        preferences: {
          availability: [
            {
              startAt: "2026-09-10T09:00:00.000Z",
              endAt: "2026-09-11T18:00:00.000Z",
            },
          ],
        },
      }),
    ).toThrow(/overall request window/i);
  });

  it("requires a flight to fit one interval, not merely the envelope", () => {
    const request = {
      windowStart,
      windowEnd,
      preferences: {
        availability: [
          {
            startAt: "2026-09-10T08:00:00.000Z",
            endAt: "2026-09-10T12:00:00.000Z",
          },
          {
            startAt: "2026-09-11T14:00:00.000Z",
            endAt: "2026-09-11T18:00:00.000Z",
          },
        ],
      },
    };

    expect(() =>
      assertFlightInsideAvailability(
        new Date("2026-09-10T09:00:00.000Z"),
        new Date("2026-09-10T10:00:00.000Z"),
        request,
      ),
    ).not.toThrow();
    expect(() =>
      assertFlightInsideAvailability(
        new Date("2026-09-10T11:00:00.000Z"),
        new Date("2026-09-11T15:00:00.000Z"),
        request,
      ),
    ).toThrow(/one detailed availability interval/i);
  });
});
