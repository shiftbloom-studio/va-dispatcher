import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DispatchRelease, Flight } from "../../db/schema.js";

const mocks = vi.hoisted(() => ({
  writeAudit: vi.fn(),
  findLatestDispatchRelease: vi.fn(),
  createDispatchRelease: vi.fn(),
  listDispatchReleaseRevisions: vi.fn(),
  findLatestDispatchReleases: vi.fn(),
  createFlightEvent: vi.fn(),
  listFlightEvents: vi.fn(),
  createFlight: vi.fn(),
  fulfillScheduleRequest: vi.fn(),
  findScheduleFulfillmentAttempt: vi.fn(),
  replayScheduleFulfillment: vi.fn(),
  countNonCancelledScheduleRequestFlights: vi.fn(),
  findFlight: vi.fn(),
  findReplacementFlight: vi.fn(),
  updateFlight: vi.fn(),
  createReplacementFlight: vi.fn(),
  listFlights: vi.fn(),
  listBoardFlights: vi.fn(),
  listMonthMetricFlights: vi.fn(),
  findMembershipById: vi.fn(),
  findScheduleRequest: vi.fn(),
  updateScheduleRequestStatus: vi.fn(),
  fetchWeatherSnapshot: vi.fn(),
}));

vi.mock("../../db/repositories/audit.js", () => ({
  writeAudit: mocks.writeAudit,
}));
vi.mock("../../db/repositories/dispatch-releases.js", () => ({
  findLatestDispatchRelease: mocks.findLatestDispatchRelease,
  createDispatchRelease: mocks.createDispatchRelease,
  listDispatchReleaseRevisions: mocks.listDispatchReleaseRevisions,
  findLatestDispatchReleases: mocks.findLatestDispatchReleases,
}));
vi.mock("../../db/repositories/flight-events.js", () => ({
  createFlightEvent: mocks.createFlightEvent,
  listFlightEvents: mocks.listFlightEvents,
}));
vi.mock("../../db/repositories/flights.js", () => ({
  createFlight: mocks.createFlight,
  fulfillScheduleRequest: mocks.fulfillScheduleRequest,
  findScheduleFulfillmentAttempt: mocks.findScheduleFulfillmentAttempt,
  replayScheduleFulfillment: mocks.replayScheduleFulfillment,
  countNonCancelledScheduleRequestFlights:
    mocks.countNonCancelledScheduleRequestFlights,
  findFlight: mocks.findFlight,
  findReplacementFlight: mocks.findReplacementFlight,
  updateFlight: mocks.updateFlight,
  createReplacementFlight: mocks.createReplacementFlight,
  listFlights: mocks.listFlights,
  listBoardFlights: mocks.listBoardFlights,
  listMonthMetricFlights: mocks.listMonthMetricFlights,
}));
vi.mock("../../db/repositories/memberships.js", () => ({
  findMembershipById: mocks.findMembershipById,
}));
vi.mock("../../db/repositories/schedule-requests.js", () => ({
  findScheduleRequest: mocks.findScheduleRequest,
  updateScheduleRequestStatus: mocks.updateScheduleRequestStatus,
}));
vi.mock("./weather.js", () => ({
  fetchWeatherSnapshot: mocks.fetchWeatherSnapshot,
}));

import {
  applyHoppieProgress,
  bulkCreateFlights,
  createFlight,
  getDispatchBoard,
  patchFlight,
  publishDispatchRelease,
  reofferDeclinedFlight,
  transitionFlight,
} from "./service.js";

const dispatcher = {
  tenantId: "tenant-test",
  membershipId: "dispatcher-test",
  role: "dispatcher" as const,
};
const actor = dispatcher;
const flightRepo = mocks;
const scheduleRepo = mocks;
const findMembershipById = mocks.findMembershipById;
const writeAudit = mocks.writeAudit;
const pilotId = "pilot-test";
const requestId = "request-test";
const flightId = "flight-test";
const idempotencyKey = "offer-batch-2026-09-10-001";
const request = {
  id: requestId,
  tenantId: actor.tenantId,
  pilotMembershipId: pilotId,
  title: null,
  notes: null,
  windowStart: new Date("2026-09-10T08:00:00.000Z"),
  windowEnd: new Date("2026-09-10T18:00:00.000Z"),
  desiredFlightCount: 2,
  preferences: {
    availability: [
      {
        startAt: "2026-09-10T08:00:00.000Z",
        endAt: "2026-09-10T12:00:00.000Z",
      },
      {
        startAt: "2026-09-10T14:00:00.000Z",
        endAt: "2026-09-10T18:00:00.000Z",
      },
    ],
  },
  version: 1,
  status: "in_review" as const,
  rejectReason: null,
  cancelReason: null,
  createdAt: new Date("2026-08-12T00:00:00.000Z"),
  updatedAt: new Date("2026-08-12T00:00:00.000Z"),
};
const activePilot = {
  id: pilotId,
  tenantId: actor.tenantId,
  clerkUserId: "user_pilot",
  role: "pilot" as const,
  displayName: "Test Pilot",
  pilotCallsign: null,
  simbriefUserId: null,
  simbriefVerifiedAt: null,
  navigraphSubject: null,
  navigraphUsername: null,
  navigraphConnectedAt: null,
  status: "active" as const,
  createdAt: new Date("2026-08-12T00:00:00.000Z"),
  updatedAt: new Date("2026-08-12T00:00:00.000Z"),
};
const storedFlight = {
  id: flightId,
  tenantId: actor.tenantId,
  scheduleRequestId: requestId,
  replacesFlightId: null,
  pilotMembershipId: pilotId,
  flightNumber: "SK101",
  depIcao: "EKCH",
  arrIcao: "ENGM",
  etd: new Date("2026-09-10T08:30:00.000Z"),
  eta: new Date("2026-09-10T10:00:00.000Z"),
  aircraftType: "A320",
  version: 1,
  status: "offered" as const,
  cancelReason: null,
  declinedReason: null,
  dispatcherNotes: null,
  assignmentRevision: 1,
  assignmentConfirmedRevision: null,
  assignmentConfirmedAt: null,
  outAt: null,
  offAt: null,
  onAt: null,
  inAt: null,
  createdAt: new Date("2026-08-12T00:00:00.000Z"),
  updatedAt: new Date("2026-08-12T00:00:00.000Z"),
};
const fulfillmentResult = {
  flights: [storedFlight],
  fulfillment: {
    scheduleRequestId: requestId,
    requestStatus: "partially_fulfilled" as const,
    requestVersion: 2,
    linkedFlightCount: 1,
    remainingFlightCount: 1,
    flightIds: [flightId],
  },
};
function fulfillmentAttempt(payloadHash: string) {
  return {
    id: "ffffffff-ffff-4fff-8fff-fffffffffff0",
    tenantId: actor.tenantId,
    scheduleRequestId: requestId,
    idempotencyKey,
    payloadHash,
    flightIds: [flightId],
    requestStatus: "partially_fulfilled" as const,
    requestVersion: 2,
    linkedFlightCount: 1,
    remainingFlightCount: 1,
    createdAt: new Date("2026-08-12T00:00:00.000Z"),
  };
}

function bulkInput(
  overrides: Partial<Parameters<typeof bulkCreateFlights>[1]> = {},
): Parameters<typeof bulkCreateFlights>[1] {
  return {
    scheduleRequestId: requestId,
    idempotencyKey,
    expectedRequestVersion: 1,
    flights: [
      {
        flightNumber: "SK101",
        depIcao: "EKCH",
        arrIcao: "ENGM",
        etd: new Date("2026-09-10T08:30:00.000Z"),
        eta: new Date("2026-09-10T10:00:00.000Z"),
      },
    ],
    ...overrides,
  };
}

describe("flight planning service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const current = makeFlight();
    mocks.findFlight.mockResolvedValue(current);
    mocks.findMembershipById.mockResolvedValue({
      id: "pilot-test",
      role: "pilot",
      status: "active",
    });
    mocks.updateFlight.mockImplementation(
      async (input: { patch: Partial<Flight> }) => ({
        ...current,
        ...input.patch,
        version: current.version + 1,
      }),
    );
    mocks.writeAudit.mockResolvedValue(undefined);
    mocks.fetchWeatherSnapshot.mockResolvedValue({
      source: "aviationweather.gov",
      fetchedAt: "2026-09-01T10:00:00.000Z",
      stations: ["EKCH", "ENGM", "ESSA"],
      metar: [],
      taf: [],
      unavailable: [],
    });
  });

  it("increments the assignment revision for schedule changes", async () => {
    const updated = await patchFlight(
      dispatcher,
      "flight-test",
      1,
      "Schedule adjustment",
      {
        etd: new Date("2026-09-01T11:00:00.000Z"),
        eta: new Date("2026-09-01T12:20:00.000Z"),
      },
    );

    expect(updated.assignmentRevision).toBe(2);
    expect(mocks.updateFlight).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedVersion: 1,
        patch: expect.objectContaining({
          assignmentRevision: 2,
          status: "offered",
        }),
        auditMeta: expect.objectContaining({
          requiresPilotConfirmation: true,
        }),
      }),
    );
  });

  it("keeps a scheduled flight scheduled for notes-only edits", async () => {
    const updated = await patchFlight(dispatcher, "flight-test", 1, undefined, {
      dispatcherNotes: "Updated operational note",
    });

    expect(updated.status).toBe("briefed");
    expect(mocks.updateFlight).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedVersion: 1,
        patch: { dispatcherNotes: "Updated operational note" },
      }),
    );
  });

  it("rejects a stale dispatcher edit instead of overwriting newer planning", async () => {
    mocks.findFlight.mockResolvedValue(makeFlight({ version: 2 }));
    await expect(
      patchFlight(dispatcher, "flight-test", 1, "Route update", {
        flightNumber: "SK102",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocks.updateFlight).not.toHaveBeenCalled();
  });

  it("rejects an invalid scheduled time window before persistence", async () => {
    await expect(
      patchFlight(dispatcher, "flight-test", 1, "Timing correction", {
        eta: new Date("2026-09-01T09:59:00.000Z"),
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", status: 400 });
    expect(mocks.updateFlight).not.toHaveBeenCalled();
  });

  it("does not leave an operational flight without an assigned pilot", async () => {
    await expect(
      patchFlight(dispatcher, "flight-test", 1, "Crew removal", {
        pilotMembershipId: null,
      }),
    ).rejects.toMatchObject({ code: "UNPROCESSABLE" });
    expect(mocks.updateFlight).not.toHaveBeenCalled();
  });

  it("publishes an immutable release before moving Accepted to Scheduled", async () => {
    const accepted = makeFlight({ status: "accepted" });
    const release = makeRelease();
    mocks.findFlight.mockResolvedValue(accepted);
    mocks.findLatestDispatchRelease.mockResolvedValue(null);
    mocks.createDispatchRelease.mockResolvedValue(release);
    mocks.updateFlight.mockResolvedValue({ ...accepted, status: "briefed" });

    const result = await publishDispatchRelease(
      dispatcher,
      accepted.id,
      accepted.version,
      releaseDraft(),
    );

    expect(result.flight.status).toBe("briefed");
    expect(result.release.revision).toBe(1);
    expect(mocks.createDispatchRelease).toHaveBeenCalledWith(
      expect.objectContaining({
        revision: 1,
        operationalRoute: "NEXEN Z711 MONAK",
      }),
    );
    expect(mocks.updateFlight).toHaveBeenCalledWith(
      expect.objectContaining({
        id: accepted.id,
        expectedVersion: accepted.version,
        patch: { status: "briefed" },
        action: "flight.release_publish",
      }),
    );
  });

  it("repairs an Accepted flight whose immutable release already exists", async () => {
    const accepted = makeFlight({ status: "accepted" });
    const release = makeRelease();
    mocks.findFlight.mockResolvedValue(accepted);
    mocks.findLatestDispatchRelease.mockResolvedValue(release);
    mocks.updateFlight.mockResolvedValue({ ...accepted, status: "briefed" });

    const result = await publishDispatchRelease(
      dispatcher,
      accepted.id,
      accepted.version,
      releaseDraft(),
    );

    expect(result).toMatchObject({
      flight: { status: "briefed" },
      release: { id: release.id, revision: 1 },
    });
    expect(mocks.createDispatchRelease).not.toHaveBeenCalled();
    expect(mocks.updateFlight).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "flight.release_schedule_recover",
        expectedVersion: accepted.version,
      }),
    );
  });

  it("rejects a release whose block fuel does not equal its breakdown", async () => {
    const draft = releaseDraft();
    await expect(
      publishDispatchRelease(dispatcher, "flight-test", 1, {
        ...draft,
        blockFuel: draft.blockFuel + 1,
      }),
    ).rejects.toMatchObject({ code: "UNPROCESSABLE" });
    expect(mocks.createDispatchRelease).not.toHaveBeenCalled();
  });

  it("uses FLT INIT to confirm assignment without treating it as departure", async () => {
    const scheduled = makeFlight({
      assignmentRevision: 2,
      assignmentConfirmedRevision: 1,
    });
    mocks.findLatestDispatchRelease.mockResolvedValue(makeRelease());
    mocks.updateFlight.mockResolvedValue({
      ...scheduled,
      assignmentConfirmedRevision: 2,
      assignmentConfirmedAt: new Date("2026-09-01T10:05:00.000Z"),
    });

    const result = await applyHoppieProgress({
      tenantId: "tenant-test",
      flight: scheduled,
      kind: "flt_init",
      occurredAt: new Date("2026-09-01T10:05:00.000Z"),
      acarsMessageId: "acars-test",
    });

    expect(result?.status).toBe("briefed");
    expect(mocks.updateFlight).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-test",
        id: scheduled.id,
        expectedVersion: scheduled.version,
        action: "flight.progress",
        patch: {
          assignmentConfirmedRevision: 2,
          assignmentConfirmedAt: new Date("2026-09-01T10:05:00.000Z"),
        },
      }),
    );
  });
});

describe("dispatch KPI calculations", () => {
  it("uses tracked OUT times and discloses missing coverage", async () => {
    const now = new Date("2026-09-20T12:00:00.000Z");
    const active = makeFlight({ id: "active", status: "active" });
    const onTime = makeFlight({
      id: "on-time",
      status: "briefed",
      etd: new Date("2026-09-05T10:00:00.000Z"),
      outAt: new Date("2026-09-05T10:10:00.000Z"),
    });
    const late = makeFlight({
      id: "late",
      status: "completed",
      etd: new Date("2026-09-06T10:00:00.000Z"),
      outAt: new Date("2026-09-06T10:20:00.000Z"),
    });
    const untracked = makeFlight({
      id: "untracked",
      status: "completed",
      etd: new Date("2026-09-07T10:00:00.000Z"),
      outAt: null,
    });
    mocks.listBoardFlights.mockResolvedValue([active]);
    mocks.findLatestDispatchReleases.mockResolvedValue(new Map());
    mocks.listMonthMetricFlights.mockResolvedValue([onTime, late, untracked]);

    const board = await getDispatchBoard("tenant-test", now);

    expect(mocks.listBoardFlights).toHaveBeenCalledWith("tenant-test", now);
    expect(board.metrics.activeFlights.value).toBe(1);
    expect(board.metrics.onTimePerformance).toMatchObject({
      value: 0.5,
      onTime: 1,
      tracked: 2,
      eligible: 3,
    });
    expect(board.metrics.scheduledVsFinished).toMatchObject({
      scheduled: 3,
      finished: 2,
      value: 2 / 3,
    });
  });
});

describe("flight server invariants", () => {
  const scheduleRequest = {
    id: "request-test",
    tenantId: "tenant-test",
    pilotMembershipId: "pilot-test",
    title: null,
    notes: null,
    windowStart: new Date("2026-09-10T08:00:00.000Z"),
    windowEnd: new Date("2026-09-10T18:00:00.000Z"),
    desiredFlightCount: 2,
    preferences: {
      availability: [
        {
          startAt: "2026-09-10T08:00:00.000Z",
          endAt: "2026-09-10T12:00:00.000Z",
        },
        {
          startAt: "2026-09-10T14:00:00.000Z",
          endAt: "2026-09-10T18:00:00.000Z",
        },
      ],
    },
    status: "in_review" as const,
    rejectReason: null,
    createdAt: new Date("2026-08-12T00:00:00.000Z"),
    updatedAt: new Date("2026-08-12T00:00:00.000Z"),
  };

  function input(
    overrides: Partial<Parameters<typeof createFlight>[1]> = {},
  ): Parameters<typeof createFlight>[1] {
    return {
      flightNumber: "SK101",
      depIcao: "EKCH",
      arrIcao: "ENGM",
      etd: new Date("2026-09-10T08:30:00.000Z"),
      eta: new Date("2026-09-10T10:00:00.000Z"),
      status: "offered",
      pilotMembershipId: "pilot-test",
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    findMembershipById.mockResolvedValue(activePilot);
    scheduleRepo.findScheduleRequest.mockResolvedValue(request);
    flightRepo.countNonCancelledScheduleRequestFlights.mockResolvedValue(0);
    flightRepo.createFlight.mockResolvedValue(storedFlight);
    flightRepo.findScheduleFulfillmentAttempt.mockResolvedValue(null);
    flightRepo.fulfillScheduleRequest.mockResolvedValue(fulfillmentResult);
    flightRepo.replayScheduleFulfillment.mockResolvedValue(fulfillmentResult);
    flightRepo.findFlight.mockResolvedValue(storedFlight);
    flightRepo.findReplacementFlight.mockResolvedValue(null);
    flightRepo.updateFlight.mockResolvedValue(storedFlight);
    flightRepo.createReplacementFlight.mockResolvedValue({
      ...storedFlight,
      id: "replacement-flight",
      replacesFlightId: flightId,
      version: 1,
    });
  });

  it("rejects ETA at or before ETD before inserting", async () => {
    await expect(
      createFlight(
        dispatcher,
        input({ eta: new Date("2026-09-10T08:30:00.000Z") }),
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", status: 400 });
    expect(mocks.createFlight).not.toHaveBeenCalled();
  });

  it("requires an assigned active pilot for an offered flight", async () => {
    await expect(
      createFlight(actor, input({ pilotMembershipId: null })),
    ).rejects.toMatchObject({ code: "UNPROCESSABLE", status: 422 });
    expect(mocks.createFlight).not.toHaveBeenCalled();
  });

  it("does not accept a membership outside the tenant", async () => {
    mocks.findMembershipById.mockResolvedValue(null);
    await expect(createFlight(dispatcher, input())).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
    expect(mocks.findMembershipById).toHaveBeenCalledWith(
      "tenant-test",
      "pilot-test",
    );
    expect(mocks.createFlight).not.toHaveBeenCalled();
  });

  it.each([
    { status: "disabled", role: "pilot" },
    { status: "active", role: "dispatcher" },
  ] as const)(
    "rejects a $status $role assignment",
    async ({ status, role }) => {
      mocks.findMembershipById.mockResolvedValue({
        id: "pilot-test",
        tenantId: "tenant-test",
        status,
        role,
      });
      await expect(createFlight(dispatcher, input())).rejects.toMatchObject({
        code: "UNPROCESSABLE",
        status: 422,
      });
      expect(mocks.createFlight).not.toHaveBeenCalled();
    },
  );

  it("rejects an assignment override on a request-linked batch", async () => {
    await expect(
      bulkCreateFlights(actor, {
        scheduleRequestId: requestId,
        idempotencyKey,
        expectedRequestVersion: 1,
        flights: [
          {
            ...input(),
            pilotMembershipId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "UNPROCESSABLE", status: 422 });
    expect(flightRepo.fulfillScheduleRequest).not.toHaveBeenCalled();
  });

  it("creates single flights as explicitly ad-hoc records", async () => {
    await createFlight(actor, input());
    expect(flightRepo.createFlight).toHaveBeenCalledWith(
      expect.objectContaining({
        actorMembershipId: actor.membershipId,
        scheduleRequestId: null,
        pilotMembershipId: pilotId,
      }),
    );
  });

  it("rejects a request-linked batch flight spanning the gap between slots", async () => {
    await expect(
      bulkCreateFlights(actor, {
        scheduleRequestId: requestId,
        idempotencyKey,
        expectedRequestVersion: 1,
        flights: [
          {
            ...input(),
            etd: new Date("2026-09-10T11:30:00.000Z"),
            eta: new Date("2026-09-10T14:30:00.000Z"),
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "UNPROCESSABLE", status: 422 });
    expect(flightRepo.fulfillScheduleRequest).not.toHaveBeenCalled();
  });

  it("validates every bulk flight before inserting the batch", async () => {
    await expect(
      bulkCreateFlights(actor, {
        scheduleRequestId: requestId,
        idempotencyKey,
        expectedRequestVersion: 1,
        flights: [
          {
            flightNumber: "SK101",
            depIcao: "EKCH",
            arrIcao: "ENGM",
            etd: new Date("2026-09-10T08:30:00.000Z"),
            eta: new Date("2026-09-10T10:00:00.000Z"),
          },
          {
            flightNumber: "SK102",
            depIcao: "ENGM",
            arrIcao: "EKCH",
            etd: new Date("2026-09-10T14:00:00.000Z"),
            eta: new Date("2026-09-10T14:00:00.000Z"),
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", status: 400 });
    expect(flightRepo.fulfillScheduleRequest).not.toHaveBeenCalled();
  });

  it("appends only the cumulative remainder of a partially fulfilled request", async () => {
    scheduleRepo.findScheduleRequest.mockResolvedValueOnce({
      ...request,
      desiredFlightCount: 3,
      version: 4,
      status: "partially_fulfilled",
    });
    flightRepo.fulfillScheduleRequest.mockResolvedValueOnce(fulfillmentResult);

    await bulkCreateFlights(actor, {
      scheduleRequestId: requestId,
      idempotencyKey,
      expectedRequestVersion: 4,
      flights: [
        {
          flightNumber: "SK103",
          depIcao: "EKCH",
          arrIcao: "ENGM",
          etd: new Date("2026-09-10T08:30:00.000Z"),
          eta: new Date("2026-09-10T10:00:00.000Z"),
        },
      ],
    });

    expect(flightRepo.fulfillScheduleRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedRequestVersion: 4,
        expectedRequestStatus: "partially_fulfilled",
        actorMembershipId: actor.membershipId,
        flights: [expect.objectContaining({ flightNumber: "SK103" })],
      }),
    );
  });

  it("rejects a follow-up batch that exceeds cumulative remaining capacity", async () => {
    scheduleRepo.findScheduleRequest.mockResolvedValueOnce({
      ...request,
      desiredFlightCount: 2,
      status: "partially_fulfilled",
    });
    flightRepo.fulfillScheduleRequest.mockResolvedValueOnce(null);
    flightRepo.countNonCancelledScheduleRequestFlights.mockResolvedValueOnce(1);

    await expect(
      bulkCreateFlights(actor, {
        scheduleRequestId: requestId,
        idempotencyKey,
        expectedRequestVersion: 1,
        flights: [
          {
            flightNumber: "SK103",
            depIcao: "EKCH",
            arrIcao: "ENGM",
            etd: new Date("2026-09-10T08:30:00.000Z"),
            eta: new Date("2026-09-10T10:00:00.000Z"),
          },
          {
            flightNumber: "SK104",
            depIcao: "EKCH",
            arrIcao: "ENGM",
            etd: new Date("2026-09-10T10:15:00.000Z"),
            eta: new Date("2026-09-10T11:30:00.000Z"),
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
      details: { existingFlightCount: 1, remainingFlightCount: 1 },
    });
    expect(flightRepo.fulfillScheduleRequest).toHaveBeenCalledTimes(1);
  });

  it("rejects fulfillment while the request is pending or terminal", async () => {
    scheduleRepo.findScheduleRequest.mockResolvedValueOnce({
      ...request,
      status: "pending",
    });
    await expect(
      bulkCreateFlights(actor, {
        scheduleRequestId: requestId,
        idempotencyKey,
        expectedRequestVersion: 1,
        flights: [],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });

    scheduleRepo.findScheduleRequest.mockResolvedValueOnce({
      ...request,
      status: "cancelled",
    });
    await expect(
      bulkCreateFlights(actor, {
        scheduleRequestId: requestId,
        idempotencyKey,
        expectedRequestVersion: 1,
        flights: [],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    expect(flightRepo.fulfillScheduleRequest).not.toHaveBeenCalled();
  });

  it("replays the original ordered result before checking a now-terminal request", async () => {
    const input = bulkInput();
    await bulkCreateFlights(actor, input);
    const payloadHash = flightRepo.fulfillScheduleRequest.mock.calls[0]![0]
      .payloadHash as string;
    flightRepo.findScheduleFulfillmentAttempt.mockResolvedValue(
      fulfillmentAttempt(payloadHash),
    );
    scheduleRepo.findScheduleRequest.mockResolvedValue({
      ...request,
      version: 2,
      status: "fulfilled",
    });

    await expect(bulkCreateFlights(actor, input)).resolves.toEqual(
      fulfillmentResult,
    );

    expect(flightRepo.fulfillScheduleRequest).toHaveBeenCalledTimes(1);
    expect(scheduleRepo.findScheduleRequest).toHaveBeenCalledTimes(1);
    expect(flightRepo.replayScheduleFulfillment).toHaveBeenCalledWith(
      expect.objectContaining({
        flightIds: [flightId],
        requestStatus: "partially_fulfilled",
        requestVersion: 2,
      }),
    );
  });

  it("rejects reuse of an idempotency key with a different canonical payload", async () => {
    flightRepo.findScheduleFulfillmentAttempt.mockResolvedValue(
      fulfillmentAttempt("0".repeat(64)),
    );

    await expect(bulkCreateFlights(actor, bulkInput())).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
      message:
        "Idempotency-Key was already used with a different fulfillment payload",
      details: {
        scheduleRequestId: requestId,
        requestStatus: "partially_fulfilled",
        requestVersion: 2,
      },
    });

    expect(scheduleRepo.findScheduleRequest).not.toHaveBeenCalled();
    expect(flightRepo.fulfillScheduleRequest).not.toHaveBeenCalled();
    expect(flightRepo.replayScheduleFulfillment).not.toHaveBeenCalled();
  });

  it("returns the winning result when a same-key concurrent submission loses the row lock", async () => {
    flightRepo.fulfillScheduleRequest.mockResolvedValueOnce(null);
    flightRepo.findScheduleFulfillmentAttempt
      .mockResolvedValueOnce(null)
      .mockImplementationOnce(() =>
        Promise.resolve(
          fulfillmentAttempt(
            flightRepo.fulfillScheduleRequest.mock.calls[0]![0]
              .payloadHash as string,
          ),
        ),
      );

    await expect(bulkCreateFlights(actor, bulkInput())).resolves.toEqual(
      fulfillmentResult,
    );

    expect(flightRepo.fulfillScheduleRequest).toHaveBeenCalledTimes(1);
    expect(flightRepo.replayScheduleFulfillment).toHaveBeenCalledTimes(1);
    expect(
      flightRepo.countNonCancelledScheduleRequestFlights,
    ).not.toHaveBeenCalled();
  });

  it("canonicalizes fulfillment payload fields before hashing and inserting", async () => {
    await bulkCreateFlights(
      actor,
      bulkInput({
        flights: [
          {
            flightNumber: " sk101 ",
            depIcao: " ekch ",
            arrIcao: " engm ",
            aircraftType: " a320 ",
            etd: new Date("2026-09-10T08:30:00.000Z"),
            eta: new Date("2026-09-10T10:00:00.000Z"),
          },
        ],
      }),
    );

    expect(flightRepo.fulfillScheduleRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey,
        payloadHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        flights: [
          expect.objectContaining({
            flightNumber: "SK101",
            depIcao: "EKCH",
            arrIcao: "ENGM",
            aircraftType: "A320",
          }),
        ],
      }),
    );
  });

  it("validates patch times against the merged record", async () => {
    await expect(
      patchFlight(actor, flightId, 1, "Correct invalid timing", {
        etd: new Date("2026-09-10T11:00:00.000Z"),
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", status: 400 });
    expect(mocks.updateFlight).not.toHaveBeenCalled();
  });

  it("returns the latest safe representation for a stale dispatcher edit", async () => {
    flightRepo.findFlight
      .mockResolvedValueOnce(storedFlight)
      .mockResolvedValueOnce({
        ...storedFlight,
        dispatcherNotes: "Changed elsewhere",
        version: 2,
      });
    flightRepo.updateFlight.mockResolvedValueOnce(null);

    await expect(
      patchFlight(actor, flightId, 1, undefined, {
        dispatcherNotes: "My edit",
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
      details: {
        latest: {
          id: flightId,
          dispatcherNotes: "Changed elsewhere",
          version: 2,
        },
      },
    });
  });

  it("invalidates acceptance after a material equipment edit", async () => {
    const accepted = { ...storedFlight, status: "accepted" as const };
    flightRepo.findFlight.mockResolvedValueOnce(accepted);
    flightRepo.updateFlight.mockResolvedValueOnce({
      ...accepted,
      aircraftType: "A321",
      status: "offered",
      version: 2,
    });

    await patchFlight(actor, flightId, 1, "Aircraft substitution", {
      aircraftType: "A321",
    });

    expect(flightRepo.updateFlight).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "flight.patch",
        actorMembershipId: actor.membershipId,
        expectedVersion: 1,
        patch: { aircraftType: "A321", status: "offered" },
        auditMeta: expect.objectContaining({
          oldAssignment: pilotId,
          newAssignment: pilotId,
          oldStatus: "accepted",
          newStatus: "offered",
          acceptanceInvalidated: true,
        }),
      }),
    );
  });

  it("keeps accepted status for a dispatcher-notes-only edit", async () => {
    const accepted = { ...storedFlight, status: "accepted" as const };
    flightRepo.findFlight.mockResolvedValueOnce(accepted);
    flightRepo.updateFlight.mockResolvedValueOnce({
      ...accepted,
      dispatcherNotes: "Revised operational briefing",
      version: 2,
    });

    await patchFlight(actor, flightId, 1, undefined, {
      dispatcherNotes: "Revised operational briefing",
    });

    expect(flightRepo.updateFlight).toHaveBeenCalledWith(
      expect.objectContaining({
        patch: { dispatcherNotes: "Revised operational briefing" },
        auditMeta: expect.objectContaining({
          changedFields: ["dispatcherNotes"],
          oldStatus: "accepted",
          newStatus: "accepted",
          acceptanceInvalidated: false,
        }),
      }),
    );
  });

  it("requires an audited reason for material edits", async () => {
    await expect(
      patchFlight(actor, flightId, 1, undefined, {
        flightNumber: "SK202",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", status: 400 });
    expect(flightRepo.updateFlight).not.toHaveBeenCalled();
  });

  it("reassigns an accepted ad-hoc flight only as a renewed offer", async () => {
    const newPilotId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const accepted = {
      ...storedFlight,
      scheduleRequestId: null,
      status: "accepted" as const,
    };
    flightRepo.findFlight.mockResolvedValueOnce(accepted);
    findMembershipById.mockResolvedValueOnce({
      ...activePilot,
      id: newPilotId,
      clerkUserId: "user_new_pilot",
    });
    flightRepo.updateFlight.mockResolvedValueOnce({
      ...accepted,
      pilotMembershipId: newPilotId,
      status: "offered",
      version: 2,
    });

    await patchFlight(actor, flightId, 1, "Crew reassignment", {
      pilotMembershipId: newPilotId,
    });

    expect(flightRepo.updateFlight).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedVersion: 1,
        patch: expect.objectContaining({
          pilotMembershipId: newPilotId,
          status: "offered",
          assignmentRevision: 2,
        }),
        auditMeta: expect.objectContaining({
          oldAssignment: pilotId,
          newAssignment: newPilotId,
          oldStatus: "accepted",
          newStatus: "offered",
        }),
      }),
    );
  });

  it("blocks material edits after activation", async () => {
    flightRepo.findFlight.mockResolvedValueOnce({
      ...storedFlight,
      status: "active",
    });
    await expect(
      patchFlight(actor, flightId, 1, "Aircraft substitution", {
        aircraftType: "A321",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    expect(flightRepo.updateFlight).not.toHaveBeenCalled();
  });

  it("keeps every terminal status immutable", async () => {
    flightRepo.findFlight.mockResolvedValueOnce({
      ...storedFlight,
      status: "declined",
    });
    await expect(
      patchFlight(actor, flightId, 1, undefined, {
        dispatcherNotes: "rewrite",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    expect(flightRepo.updateFlight).not.toHaveBeenCalled();
  });

  it("rejects a stale pilot response before changing state", async () => {
    await expect(
      transitionFlight(
        {
          tenantId: actor.tenantId,
          membershipId: pilotId,
          role: "pilot",
        },
        flightId,
        "accepted",
        { expectedVersion: 2 },
      ),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      details: { latest: { id: flightId, version: 1 } },
    });
    expect(flightRepo.updateFlight).not.toHaveBeenCalled();
  });

  it("persists a pilot response and its audit through one repository call", async () => {
    flightRepo.updateFlight.mockResolvedValueOnce({
      ...storedFlight,
      status: "accepted",
      version: 2,
    });

    await transitionFlight(
      {
        tenantId: actor.tenantId,
        membershipId: pilotId,
        role: "pilot",
      },
      flightId,
      "accepted",
      { expectedVersion: 1 },
    );

    expect(flightRepo.updateFlight).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: actor.tenantId,
        id: flightId,
        expectedVersion: 1,
        actorMembershipId: pilotId,
        action: "flight.accepted",
        patch: expect.objectContaining({
          status: "accepted",
          assignmentConfirmedRevision: 1,
        }),
        auditMeta: { from: "offered", to: "accepted", reason: undefined },
      }),
    );
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("creates a history-linked replacement instead of rewriting a decline", async () => {
    const declined = { ...storedFlight, status: "declined" as const };
    flightRepo.findFlight.mockResolvedValueOnce(declined);

    const replacement = await reofferDeclinedFlight(actor, flightId, {
      expectedVersion: 1,
      reason: "Pilot availability restored",
    });

    expect(replacement.replacesFlightId).toBe(flightId);
    expect(flightRepo.updateFlight).not.toHaveBeenCalled();
    expect(flightRepo.createReplacementFlight).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceFlightId: flightId,
        expectedVersion: 1,
        oldPilotMembershipId: pilotId,
        pilotMembershipId: pilotId,
        reason: "Pilot availability restored",
      }),
    );
  });

  it("does not reassign a request-linked replacement", async () => {
    flightRepo.findFlight.mockResolvedValueOnce({
      ...storedFlight,
      status: "declined",
    });
    await expect(
      reofferDeclinedFlight(actor, flightId, {
        expectedVersion: 1,
        pilotMembershipId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        reason: "Different pilot requested",
      }),
    ).rejects.toMatchObject({ code: "UNPROCESSABLE", status: 422 });
    expect(flightRepo.createReplacementFlight).not.toHaveBeenCalled();
  });

  it("returns the winning replacement when a concurrent re-offer loses", async () => {
    const declined = { ...storedFlight, status: "declined" as const };
    const winningReplacement = {
      ...storedFlight,
      id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      replacesFlightId: flightId,
      status: "offered" as const,
    };
    flightRepo.findFlight.mockResolvedValueOnce(declined);
    flightRepo.createReplacementFlight.mockResolvedValueOnce(null);
    flightRepo.findReplacementFlight.mockResolvedValueOnce(winningReplacement);

    await expect(
      reofferDeclinedFlight(actor, flightId, {
        expectedVersion: 1,
        reason: "Concurrent retry",
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
      details: {
        latest: { id: flightId, status: "declined", version: 1 },
        replacement: {
          id: winningReplacement.id,
          replacesFlightId: flightId,
          status: "offered",
        },
      },
    });
    expect(flightRepo.findReplacementFlight).toHaveBeenCalledWith(
      actor.tenantId,
      flightId,
    );
  });
});

function makeFlight(overrides: Partial<Flight> = {}): Flight {
  const now = new Date("2026-09-01T10:00:00.000Z");
  return {
    id: "flight-test",
    tenantId: "tenant-test",
    scheduleRequestId: null,
    replacesFlightId: null,
    pilotMembershipId: "pilot-test",
    flightNumber: "SK101",
    depIcao: "EKCH",
    arrIcao: "ENGM",
    etd: now,
    eta: new Date("2026-09-01T11:20:00.000Z"),
    aircraftType: "A320",
    version: 1,
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

function releaseDraft() {
  return {
    operationalRoute: " nexen z711 monak ",
    sid: "NEXEN2A",
    star: "MONAK3M",
    cruiseLevel: 350,
    alternateIcao: "ESSA",
    fuelUnit: "kg" as const,
    payloadUnit: "kg" as const,
    taxiFuel: 200,
    tripFuel: 4_000,
    contingencyFuel: 200,
    alternateFuel: 700,
    finalReserveFuel: 900,
    additionalFuel: 0,
    blockFuel: 6_000,
    plannedPayload: 14_000,
    releaseNotes: "Review NOTAMs.",
    dispatcherRemarks: null,
  };
}

function makeRelease(): DispatchRelease {
  return {
    id: "release-test",
    tenantId: "tenant-test",
    flightId: "flight-test",
    revision: 1,
    operationalRoute: "NEXEN Z711 MONAK",
    sid: "NEXEN2A",
    star: "MONAK3M",
    cruiseLevel: 350,
    alternateIcao: "ESSA",
    fuelUnit: "kg",
    payloadUnit: "kg",
    taxiFuel: 200,
    tripFuel: 4_000,
    contingencyFuel: 200,
    alternateFuel: 700,
    finalReserveFuel: 900,
    additionalFuel: 0,
    blockFuel: 6_000,
    plannedPayload: 14_000,
    weatherSnapshot: {},
    releaseNotes: "Review NOTAMs.",
    dispatcherRemarks: null,
    releasedByMembershipId: "dispatcher-test",
    releasedAt: new Date("2026-09-01T09:00:00.000Z"),
  };
}
