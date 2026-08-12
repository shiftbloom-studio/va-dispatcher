import { describe, expect, it } from "vitest";
import type { Flight } from "../../db/schema.js";
import { matchOperationalFlight } from "./service.js";
import { parseOperationalInteraction } from "./progress.js";

const reference = new Date("2026-09-02T00:02:00.000Z");

describe("ACARS operational interaction parsing", () => {
  it("parses only complete progress payloads", () => {
    expect(parseOperationalInteraction("SK101 FLT INIT", reference)).toEqual({
      kind: "flt_init",
      flightNumber: "SK101",
      occurredAt: reference,
    });
    expect(parseOperationalInteraction("OUT/2358Z SK101", reference)).toEqual({
      kind: "out",
      flightNumber: "SK101",
      occurredAt: new Date("2026-09-01T23:58:00.000Z"),
    });
  });

  it("rejects conversational text and impossible times", () => {
    expect(
      parseOperationalInteraction("WE ARE OUT OF FUEL", reference),
    ).toBeNull();
    expect(
      parseOperationalInteraction("REPORT IN WHEN READY", reference),
    ).toBeNull();
    expect(parseOperationalInteraction("OUT 2460Z", reference)).toBeNull();
  });
});

describe("safe ACARS flight matching", () => {
  const scheduled = makeFlight({
    id: "flight-scheduled",
    flightNumber: "SK101",
    status: "briefed",
  });
  const active = makeFlight({
    id: "flight-active",
    flightNumber: "SK202",
    status: "active",
  });

  it("uses an exact flight number when supplied", () => {
    expect(matchOperationalFlight([scheduled, active], "out", "SK101")).toBe(
      scheduled,
    );
    expect(
      matchOperationalFlight([scheduled, active], "out", "SK999"),
    ).toBeNull();
  });

  it("uses a unique status match but rejects ambiguity", () => {
    expect(matchOperationalFlight([scheduled, active], "in", null)).toBe(
      active,
    );
    expect(
      matchOperationalFlight(
        [scheduled, makeFlight({ id: "flight-two", status: "briefed" })],
        "out",
        null,
      ),
    ).toBeNull();
  });
});

function makeFlight(overrides: Partial<Flight> = {}): Flight {
  const now = new Date("2026-09-01T10:00:00.000Z");
  return {
    id: "flight-default",
    tenantId: "tenant-test",
    scheduleRequestId: null,
    pilotMembershipId: "pilot-test",
    flightNumber: "SK100",
    depIcao: "EKCH",
    arrIcao: "ENGM",
    etd: now,
    eta: new Date("2026-09-01T11:20:00.000Z"),
    aircraftType: "A320",
    status: "briefed",
    cancelReason: null,
    declinedReason: null,
    dispatcherNotes: null,
    assignmentRevision: 1,
    assignmentConfirmedRevision: 1,
    assignmentConfirmedAt: now,
    outAt: null,
    offAt: null,
    onAt: null,
    inAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
