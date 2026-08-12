import { describe, expect, it } from "vitest";
import {
  assertFlightTransition,
  canTransition,
  pilotMayCancel,
} from "./transitions.js";
import { AppError } from "../../lib/errors.js";

describe("flight transitions", () => {
  it("allows draft → offered → accepted → briefed → active → completed", () => {
    expect(canTransition("draft", "offered")).toBe(true);
    expect(canTransition("offered", "accepted")).toBe(true);
    expect(canTransition("accepted", "briefed")).toBe(true);
    expect(canTransition("briefed", "active")).toBe(true);
    expect(canTransition("active", "completed")).toBe(true);
  });

  it("allows offer decline and cancel paths", () => {
    expect(canTransition("offered", "declined")).toBe(true);
    expect(canTransition("offered", "cancelled")).toBe(true);
    expect(canTransition("accepted", "cancelled")).toBe(true);
  });

  it("rejects illegal jumps", () => {
    expect(canTransition("draft", "active")).toBe(false);
    expect(canTransition("completed", "active")).toBe(false);
    expect(() => assertFlightTransition("declined", "accepted")).toThrow(
      AppError,
    );
  });

  it("pilot cancel window", () => {
    expect(pilotMayCancel("offered")).toBe(true);
    expect(pilotMayCancel("accepted")).toBe(true);
    expect(pilotMayCancel("briefed")).toBe(true);
    expect(pilotMayCancel("active")).toBe(false);
    expect(pilotMayCancel("completed")).toBe(false);
  });
});
