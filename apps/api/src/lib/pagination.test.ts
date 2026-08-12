import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "./pagination.js";

describe("pagination cursors", () => {
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

  it("keeps cursors issued before the sort field rename usable", () => {
    const legacyCursor = Buffer.from(
      JSON.stringify({
        createdAt: "2026-08-12T12:00:00.000Z",
        id: "flight_123",
      }),
      "utf8",
    ).toString("base64url");

    expect(decodeCursor(legacyCursor)).toEqual({
      sortAt: "2026-08-12T12:00:00.000Z",
      id: "flight_123",
      legacy: true,
    });
  });
});
