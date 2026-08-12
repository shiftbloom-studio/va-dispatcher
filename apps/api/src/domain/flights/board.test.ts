import { describe, expect, it } from "vitest";

import { dispatchBoardLane } from "./service.js";

const now = new Date("2026-08-12T12:00:00.000Z");

describe("dispatch board lane classification", () => {
  it.each(["accepted", "briefed"] as const)(
    "classifies a past-ETD %s flight as overdue",
    (status) => {
      expect(
        dispatchBoardLane({ status, etd: new Date(now.getTime() - 1) }, now),
      ).toBe("overdue");
    },
  );

  it("keeps exact-ETD and active flights in their operational lanes", () => {
    expect(dispatchBoardLane({ status: "accepted", etd: now }, now)).toBe(
      "accepted",
    );
    expect(
      dispatchBoardLane(
        { status: "active", etd: new Date("2020-01-01T00:00:00.000Z") },
        now,
      ),
    ).toBe("active");
    expect(
      dispatchBoardLane(
        { status: "completed", etd: new Date("2020-01-01T00:00:00.000Z") },
        now,
      ),
    ).toBe("completed");
  });

  it("rejects offered flights because they remain in Flight Management", () => {
    expect(() =>
      dispatchBoardLane({ status: "offered", etd: now }, now),
    ).toThrow("Unsupported dispatch board status: offered");
  });
});
