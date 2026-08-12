import { describe, expect, it } from "vitest";

import {
  decodeCursor,
  decodeFlightCursor,
  encodeCursor,
  encodeFlightCursor,
  flightCursorQuerySchema,
} from "./pagination.js";

const flightId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function opaque(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

describe("generic pagination cursors", () => {
  it("uses the sort value that backs the query order", () => {
    const cursor = encodeCursor({
      sortAt: "2026-08-12T12:00:00.000Z",
      id: "flight_123",
    });

    expect(decodeCursor(cursor)).toEqual({
      sortAt: "2026-08-12T12:00:00.000Z",
      id: "flight_123",
      legacy: false,
    });
  });

  it("keeps old generic cursors usable outside the flight list", () => {
    const legacyCursor = opaque({
      createdAt: "2026-08-12T12:00:00.000Z",
      id: "flight_123",
    });

    expect(decodeCursor(legacyCursor)).toEqual({
      sortAt: "2026-08-12T12:00:00.000Z",
      id: "flight_123",
      legacy: true,
    });
  });
});

describe("flight cursor contract", () => {
  it("round-trips the versioned ETD ordering tuple", () => {
    const cursor = encodeFlightCursor({
      etd: "2026-09-10T08:30:00.000Z",
      id: flightId,
    });

    expect(decodeFlightCursor(cursor)).toEqual({
      v: 1,
      kind: "flight-etd-desc",
      etd: "2026-09-10T08:30:00.000Z",
      id: flightId,
    });
    expect(flightCursorQuerySchema.parse(cursor)).toEqual(
      decodeFlightCursor(cursor),
    );
  });

  it("refuses to emit an invalid ordering tuple", () => {
    expect(() =>
      encodeFlightCursor({ etd: "not-a-time", id: flightId }),
    ).toThrow();
  });

  it.each([
    encodeCursor({
      sortAt: "2026-09-10T08:30:00.000Z",
      id: flightId,
    }),
    opaque({
      createdAt: "2026-09-10T08:30:00.000Z",
      id: flightId,
    }),
    opaque({
      v: 2,
      kind: "flight-etd-desc",
      etd: "2026-09-10T08:30:00.000Z",
      id: flightId,
    }),
    opaque({
      v: 1,
      kind: "schedule-request-created-desc",
      etd: "2026-09-10T08:30:00.000Z",
      id: flightId,
    }),
    opaque({
      v: 1,
      kind: "flight-etd-desc",
      etd: "not-a-time",
      id: flightId,
    }),
    opaque({
      v: 1,
      kind: "flight-etd-desc",
      etd: "2026-09-10T08:30:00.000Z",
      id: "not-a-uuid",
    }),
    opaque({
      v: 1,
      kind: "flight-etd-desc",
      etd: "2026-09-10T08:30:00.000Z",
      id: flightId,
      createdAt: "2026-09-10T00:00:00.000Z",
    }),
  ])("rejects an old or incompatible cursor payload", (cursor) => {
    expect(() => decodeFlightCursor(cursor)).toThrow(
      "Invalid or incompatible flight cursor",
    );
    expect(flightCursorQuerySchema.safeParse(cursor).success).toBe(false);
  });
});
