import { describe, expect, it } from "vitest";

import { canCancelScheduleRequest, flightActions } from "@/lib/status";

describe("status action matrices", () => {
  it("limits pilots to their documented decisions", () => {
    expect(flightActions("pilot", "offered")).toEqual(["accept", "decline"]);
    expect(flightActions("pilot", "accepted")).toEqual(["cancel"]);
    expect(flightActions("pilot", "briefed")).toEqual(["cancel"]);
    expect(flightActions("pilot", "active")).toEqual([]);
    expect(flightActions("pilot", "completed")).toEqual([]);
  });

  it("exposes only explicit dispatcher transitions", () => {
    expect(flightActions("dispatcher", "draft")).toEqual([
      "edit",
      "offer",
      "cancel",
    ]);
    expect(flightActions("dispatcher", "accepted")).toEqual([
      "edit",
      "brief",
      "cancel",
    ]);
    expect(flightActions("dispatcher", "active")).toEqual([
      "edit",
      "complete",
      "cancel",
    ]);
    expect(flightActions("admin", "cancelled")).toEqual([]);
  });

  it("keeps historical partial requests cancellable", () => {
    expect(canCancelScheduleRequest("partially_fulfilled")).toBe(true);
    expect(canCancelScheduleRequest("fulfilled")).toBe(false);
  });
});
