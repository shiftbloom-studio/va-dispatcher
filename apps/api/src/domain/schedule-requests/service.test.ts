import { beforeEach, describe, expect, it, vi } from "vitest";

const scheduleRepo = vi.hoisted(() => ({
  createScheduleRequest: vi.fn(),
  findScheduleRequest: vi.fn(),
  listScheduleRequests: vi.fn(),
  updateScheduleRequest: vi.fn(),
  transitionScheduleRequest: vi.fn(),
  cancelScheduleRequest: vi.fn(),
}));
const countNonCancelledScheduleRequestFlights = vi.hoisted(() => vi.fn());

vi.mock("../../db/repositories/schedule-requests.js", () => scheduleRepo);
vi.mock("../../db/repositories/flights.js", () => ({
  countNonCancelledScheduleRequestFlights,
}));

import {
  cancelRequest,
  createRequest,
  editRequest,
  transitionRequest,
} from "./service.js";

const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const pilotMembershipId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const dispatcherMembershipId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const requestId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const storedRequest = {
  id: requestId,
  tenantId,
  pilotMembershipId,
  title: "Original request",
  notes: null,
  windowStart: new Date("2026-09-10T08:00:00.000Z"),
  windowEnd: new Date("2026-09-10T12:00:00.000Z"),
  desiredFlightCount: 1,
  preferences: {
    availability: [
      {
        startAt: "2026-09-10T08:00:00.000Z",
        endAt: "2026-09-10T12:00:00.000Z",
      },
    ],
  },
  version: 1,
  status: "pending" as const,
  rejectReason: null,
  cancelReason: null,
  createdAt: new Date("2026-08-12T00:00:00.000Z"),
  updatedAt: new Date("2026-08-12T00:00:00.000Z"),
};

const pilot = {
  tenantId,
  membershipId: pilotMembershipId,
  role: "pilot" as const,
};
const dispatcher = {
  tenantId,
  membershipId: dispatcherMembershipId,
  role: "dispatcher" as const,
};

describe("schedule request lifecycle service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scheduleRepo.createScheduleRequest.mockResolvedValue(storedRequest);
    scheduleRepo.findScheduleRequest.mockResolvedValue(storedRequest);
    scheduleRepo.updateScheduleRequest.mockResolvedValue({
      ...storedRequest,
      title: "Revised request",
      version: 2,
    });
    scheduleRepo.transitionScheduleRequest.mockResolvedValue({
      ...storedRequest,
      version: 2,
      status: "in_review",
    });
    scheduleRepo.cancelScheduleRequest.mockResolvedValue({
      ...storedRequest,
      version: 2,
      status: "cancelled",
      cancelReason: "Unavailable",
    });
    countNonCancelledScheduleRequestFlights.mockResolvedValue(0);
  });

  it("delegates request creation and actor audit to one repository command", async () => {
    await createRequest(pilot, {
      title: storedRequest.title,
      windowStart: storedRequest.windowStart,
      windowEnd: storedRequest.windowEnd,
      desiredFlightCount: 1,
      preferences: storedRequest.preferences,
    });

    expect(scheduleRepo.createScheduleRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        pilotMembershipId,
        actorMembershipId: pilotMembershipId,
      }),
    );
  });

  it("lets the owning pilot edit pending normalized availability with CAS", async () => {
    const updated = await editRequest(pilot, requestId, 1, {
      title: "Revised request",
      notes: "Prefer regional routes",
      windowStart: new Date("2026-09-11T08:00:00.000Z"),
      windowEnd: new Date("2026-09-12T12:00:00.000Z"),
      desiredFlightCount: 2,
      preferences: {
        availability: [
          {
            startAt: "2026-09-12T08:00:00.000Z",
            endAt: "2026-09-12T12:00:00.000Z",
          },
          {
            startAt: "2026-09-11T08:00:00.000Z",
            endAt: "2026-09-11T12:00:00.000Z",
          },
        ],
      },
    });

    expect(updated.version).toBe(2);
    expect(scheduleRepo.updateScheduleRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        id: requestId,
        expectedVersion: 1,
        expectedStatus: "pending",
        actorMembershipId: pilotMembershipId,
        auditMeta: expect.objectContaining({
          fromVersion: 1,
          toVersion: 2,
          changedFields: expect.arrayContaining([
            "title",
            "notes",
            "windowStart",
            "windowEnd",
            "desiredFlightCount",
            "preferences",
          ]),
        }),
        patch: expect.objectContaining({
          preferences: {
            availability: [
              {
                startAt: "2026-09-11T08:00:00.000Z",
                endAt: "2026-09-11T12:00:00.000Z",
              },
              {
                startAt: "2026-09-12T08:00:00.000Z",
                endAt: "2026-09-12T12:00:00.000Z",
              },
            ],
          },
        }),
      }),
    );
  });

  it("locks request contents from dispatchers and after review starts", async () => {
    await expect(
      editRequest(dispatcher, requestId, 1, {
        windowStart: storedRequest.windowStart,
        windowEnd: storedRequest.windowEnd,
        desiredFlightCount: 1,
        preferences: storedRequest.preferences,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });

    scheduleRepo.findScheduleRequest.mockResolvedValueOnce({
      ...storedRequest,
      status: "in_review",
    });
    await expect(
      editRequest(pilot, requestId, 1, {
        windowStart: storedRequest.windowStart,
        windowEnd: storedRequest.windowEnd,
        desiredFlightCount: 1,
        preferences: storedRequest.preferences,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    expect(scheduleRepo.updateScheduleRequest).not.toHaveBeenCalled();
  });

  it("returns the latest safe request on a stale pilot edit", async () => {
    await expect(
      editRequest(pilot, requestId, 9, {
        windowStart: storedRequest.windowStart,
        windowEnd: storedRequest.windowEnd,
        desiredFlightCount: 1,
        preferences: storedRequest.preferences,
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
      details: { latest: { id: requestId, version: 1, status: "pending" } },
    });
  });

  it("starts review through one versioned mutation-and-audit command", async () => {
    await transitionRequest(dispatcher, requestId, "in_review", {
      expectedVersion: 1,
    });

    expect(scheduleRepo.transitionScheduleRequest).toHaveBeenCalledWith({
      tenantId,
      id: requestId,
      expectedVersion: 1,
      expectedStatus: "pending",
      status: "in_review",
      actorMembershipId: dispatcherMembershipId,
      action: "schedule_request.in_review",
      reason: undefined,
      auditMeta: { from: "pending", to: "in_review", reason: undefined },
    });
  });

  it.each([pilot, dispatcher])(
    "allows an authorized %s cancellation with an explicit linked-flight policy",
    async (actor) => {
      await cancelRequest(actor, requestId, {
        expectedVersion: 1,
        linkedFlightAction: "cancel_predeparture",
        reason: "Unavailable",
      });

      expect(scheduleRepo.cancelScheduleRequest).toHaveBeenCalledWith({
        tenantId,
        id: requestId,
        expectedVersion: 1,
        expectedStatus: "pending",
        actorMembershipId: actor.membershipId,
        linkedFlightAction: "cancel_predeparture",
        reason: "Unavailable",
      });
    },
  );

  it("does not reveal or cancel another pilot's request", async () => {
    await expect(
      cancelRequest(
        {
          tenantId,
          membershipId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          role: "pilot",
        },
        requestId,
        {
          expectedVersion: 1,
          linkedFlightAction: "keep",
        },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(scheduleRepo.cancelScheduleRequest).not.toHaveBeenCalled();
  });
});
