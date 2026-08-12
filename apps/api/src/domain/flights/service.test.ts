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
  createFlights: vi.fn(),
  findFlight: vi.fn(),
  updateFlight: vi.fn(),
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
  createFlights: mocks.createFlights,
  findFlight: mocks.findFlight,
  updateFlight: mocks.updateFlight,
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
} from "./service.js";

const dispatcher = {
  tenantId: "tenant-test",
  membershipId: "dispatcher-test",
  role: "dispatcher" as const,
};

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
      async (_tenantId: string, _flightId: string, patch: Partial<Flight>) => ({
        ...current,
        ...patch,
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
    const updated = await patchFlight(dispatcher, "flight-test", {
      etd: new Date("2026-09-01T11:00:00.000Z"),
      eta: new Date("2026-09-01T12:20:00.000Z"),
    });

    expect(updated.assignmentRevision).toBe(2);
    expect(mocks.updateFlight).toHaveBeenCalledWith(
      "tenant-test",
      "flight-test",
      expect.objectContaining({ assignmentRevision: 2 }),
      { expectedUpdatedAt: new Date("2026-09-01T10:00:00.000Z") },
    );
    expect(mocks.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({ requiresPilotConfirmation: true }),
      }),
    );
  });

  it("keeps a scheduled flight scheduled for non-time planning edits", async () => {
    const updated = await patchFlight(dispatcher, "flight-test", {
      flightNumber: "SK102",
    });

    expect(updated.status).toBe("briefed");
    expect(mocks.updateFlight).toHaveBeenCalledWith(
      "tenant-test",
      "flight-test",
      { flightNumber: "SK102" },
      { expectedUpdatedAt: new Date("2026-09-01T10:00:00.000Z") },
    );
  });

  it("rejects a stale dispatcher edit instead of overwriting newer planning", async () => {
    await expect(
      patchFlight(dispatcher, "flight-test", {
        flightNumber: "SK102",
        expectedUpdatedAt: new Date("2026-09-01T09:59:00.000Z"),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocks.updateFlight).not.toHaveBeenCalled();
  });

  it("rejects an invalid scheduled time window before persistence", async () => {
    await expect(
      patchFlight(dispatcher, "flight-test", {
        eta: new Date("2026-09-01T09:59:00.000Z"),
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", status: 400 });
    expect(mocks.updateFlight).not.toHaveBeenCalled();
  });

  it("does not leave an operational flight without an assigned pilot", async () => {
    await expect(
      patchFlight(dispatcher, "flight-test", { pilotMembershipId: null }),
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
      "tenant-test",
      accepted.id,
      { status: "briefed" },
      { expectedUpdatedAt: accepted.updatedAt },
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
      releaseDraft(),
    );

    expect(result).toMatchObject({
      flight: { status: "briefed" },
      release: { id: release.id, revision: 1 },
    });
    expect(mocks.createDispatchRelease).not.toHaveBeenCalled();
    expect(mocks.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "flight.release_schedule_recover" }),
    );
  });

  it("rejects a release whose block fuel does not equal its breakdown", async () => {
    const draft = releaseDraft();
    await expect(
      publishDispatchRelease(dispatcher, "flight-test", {
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
      "tenant-test",
      scheduled.id,
      {
        assignmentConfirmedRevision: 2,
        assignmentConfirmedAt: new Date("2026-09-01T10:05:00.000Z"),
      },
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
    mocks.findMembershipById.mockResolvedValue({
      id: "pilot-test",
      tenantId: "tenant-test",
      role: "pilot",
      status: "active",
    });
    mocks.findScheduleRequest.mockResolvedValue(scheduleRequest);
    const stored = makeFlight({
      scheduleRequestId: "request-test",
      status: "offered",
      etd: new Date("2026-09-10T08:30:00.000Z"),
      eta: new Date("2026-09-10T10:00:00.000Z"),
    });
    mocks.createFlight.mockResolvedValue(stored);
    mocks.createFlights.mockResolvedValue([stored]);
    mocks.findFlight.mockResolvedValue(stored);
    mocks.updateFlight.mockResolvedValue(stored);
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
      createFlight(
        dispatcher,
        input({ pilotMembershipId: null, scheduleRequestId: null }),
      ),
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

  it("inherits the request owner and rejects assignment overrides", async () => {
    await expect(
      createFlight(
        dispatcher,
        input({
          scheduleRequestId: "request-test",
          pilotMembershipId: "other-pilot",
        }),
      ),
    ).rejects.toMatchObject({ code: "UNPROCESSABLE", status: 422 });

    await createFlight(
      dispatcher,
      input({ scheduleRequestId: "request-test", pilotMembershipId: null }),
    );
    expect(mocks.createFlight).toHaveBeenCalledWith(
      expect.objectContaining({ pilotMembershipId: "pilot-test" }),
    );
  });

  it("rejects a request-linked flight spanning an availability gap", async () => {
    await expect(
      createFlight(
        dispatcher,
        input({
          scheduleRequestId: "request-test",
          etd: new Date("2026-09-10T11:30:00.000Z"),
          eta: new Date("2026-09-10T14:30:00.000Z"),
        }),
      ),
    ).rejects.toMatchObject({ code: "UNPROCESSABLE", status: 422 });
    expect(mocks.createFlight).not.toHaveBeenCalled();
  });

  it("validates every bulk flight before inserting the batch", async () => {
    await expect(
      bulkCreateFlights(dispatcher, {
        scheduleRequestId: "request-test",
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
    expect(mocks.createFlights).not.toHaveBeenCalled();
  });

  it("validates patch times against the merged record", async () => {
    await expect(
      patchFlight(dispatcher, "flight-test", {
        etd: new Date("2026-09-10T11:00:00.000Z"),
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", status: 400 });
    expect(mocks.updateFlight).not.toHaveBeenCalled();
  });
});

function makeFlight(overrides: Partial<Flight> = {}): Flight {
  const now = new Date("2026-09-01T10:00:00.000Z");
  return {
    id: "flight-test",
    tenantId: "tenant-test",
    scheduleRequestId: null,
    pilotMembershipId: "pilot-test",
    flightNumber: "SK101",
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
