import { describe, expect, it } from "vitest";

import {
  acarsMessagePageSchema,
  bulkFlightResponseSchema,
  dispatchBoardSchema,
  flightResponseSchema,
  meSchema,
  membersSchema,
  scheduleRequestDetailResponseSchema,
  schedulePreferencesSchema,
} from "@/lib/api/schemas";

describe("live API contract smoke fixtures", () => {
  it("parses the current identity and membership serializer", () => {
    expect(
      meSchema.parse({
        user: { clerkUserId: "user_1" },
        membership: {
          id: "m1",
          role: "pilot",
          displayName: "A Pilot",
          pilotCallsign: "SAS101",
          status: "active",
        },
        tenant: {
          id: "t1",
          slug: "vsas",
          name: "Virtual SAS",
          hoppieStation: "VSAS",
        },
      }).membership?.pilotCallsign,
    ).toBe("SAS101");
  });

  it("uses request, flight, board, member, and ACARS field names emitted by Hono", () => {
    const request = {
      id: "r1",
      pilotMembershipId: "m1",
      title: null,
      notes: null,
      windowStart: "2026-09-01T08:00:00.000Z",
      windowEnd: "2026-09-02T08:00:00.000Z",
      desiredFlightCount: 1,
      preferences: {},
      version: 1,
      status: "pending",
      rejectReason: null,
      cancelReason: null,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    };
    expect(
      scheduleRequestDetailResponseSchema.parse({
        request,
        fulfillment: { linkedFlightCount: 0, remainingFlightCount: 1 },
      }).request.id,
    ).toBe("r1");

    const flight = {
      id: "f1",
      scheduleRequestId: "r1",
      replacesFlightId: null,
      pilotMembershipId: "m1",
      flightNumber: "SK100",
      depIcao: "EKCH",
      arrIcao: "ENGM",
      etd: "2026-09-01T08:00:00.000Z",
      eta: "2026-09-01T09:00:00.000Z",
      aircraftType: "A320",
      version: 1,
      status: "offered",
      cancelReason: null,
      declinedReason: null,
      dispatcherNotes: null,
      assignmentRevision: 1,
      assignmentConfirmedRevision: null,
      assignmentConfirmedAt: null,
      assignmentConfirmationRequired: false,
      outAt: null,
      offAt: null,
      onAt: null,
      inAt: null,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    };
    expect(flightResponseSchema.parse({ flight }).flight.depIcao).toBe("EKCH");
    expect(
      bulkFlightResponseSchema.parse({
        flights: [flight],
        fulfillment: {
          scheduleRequestId: "r1",
          requestStatus: "fulfilled",
          requestVersion: 2,
          linkedFlightCount: 1,
          remainingFlightCount: 0,
          flightIds: ["f1"],
        },
      }).fulfillment.flightIds,
    ).toEqual(["f1"]);
    expect(
      flightResponseSchema.parse({
        flight: { ...flight, pilotMembershipId: null, status: "draft" },
      }).flight.pilotMembershipId,
    ).toBeNull();
    expect(
      dispatchBoardSchema.parse({
        flights: [
          {
            id: "f1",
            flightNumber: "SK100",
            depIcao: "EKCH",
            arrIcao: "ENGM",
            etd: flight.etd,
            eta: flight.eta,
            aircraftType: "A320",
            status: "accepted",
            pilotMembershipId: "m1",
            dispatcherNotes: null,
            assignmentRevision: 1,
            assignmentConfirmedRevision: 1,
            assignmentConfirmedAt: flight.updatedAt,
            assignmentConfirmationRequired: false,
            latestReleaseRevision: null,
            outAt: null,
            inAt: null,
          },
        ],
        metrics: {
          window: {
            from: "2026-08-01T00:00:00.000Z",
            toExclusive: "2026-09-01T00:00:00.000Z",
            label: "Current UTC calendar month",
          },
          activeFlights: { value: 0, definition: "Current active flights." },
          onTimePerformance: {
            value: null,
            onTime: 0,
            tracked: 0,
            eligible: 0,
            definition: "Actual OUT tracking.",
          },
          scheduledVsFinished: {
            scheduled: 1,
            finished: 0,
            value: 0,
            definition: "Month-to-date progress.",
          },
        },
        scheduleRequestCounts: { pending: 2 },
      }).scheduleRequestCounts.pending,
    ).toBe(2);
    expect(
      membersSchema.parse({
        items: [
          {
            id: "m1",
            role: "pilot",
            displayName: "A Pilot",
            pilotCallsign: "SAS101",
            status: "active",
            createdAt: "2026-08-01T00:00:00.000Z",
          },
        ],
      }).items,
    ).toHaveLength(1);
    expect(
      acarsMessagePageSchema.parse({
        items: [
          {
            id: "a1",
            direction: "inbound",
            msgType: "telex",
            fromStation: "SAS101",
            toStation: "VSAS",
            body: "HELLO",
            flightId: null,
            provider: "mock",
            createdAt: "2026-08-01T00:00:00.000Z",
            receivedAt: "2026-08-01T00:00:00.000Z",
            sentAt: null,
          },
        ],
        nextCursor: null,
      }).items[0].msgType,
    ).toBe("telex");
  });

  it("validates detailed schedule availability while accepting legacy rows", () => {
    expect(schedulePreferencesSchema.parse({})).toEqual({});
    expect(
      schedulePreferencesSchema.parse({
        availability: [
          {
            startAt: "2026-09-01T08:00:00.000Z",
            endAt: "2026-09-01T10:00:00.000Z",
          },
        ],
      }).availability,
    ).toHaveLength(1);
    expect(() =>
      schedulePreferencesSchema.parse({
        availability: [{ startAt: "invalid", endAt: "also-invalid" }],
      }),
    ).toThrow();
  });
});
