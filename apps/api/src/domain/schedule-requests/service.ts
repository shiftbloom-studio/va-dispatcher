import * as scheduleRepo from "../../db/repositories/schedule-requests.js";
import { countNonCancelledScheduleRequestFlights } from "../../db/repositories/flights.js";
import type { MemberRole, ScheduleRequest } from "../../db/schema.js";
import { AppError } from "../../lib/errors.js";
import { roleAtLeast } from "../members/roles.js";
import { normalizeAvailability } from "./availability.js";
import { assertScheduleRequestTransition } from "./transitions.js";

export async function createRequest(
  actor: {
    tenantId: string;
    membershipId: string;
  },
  input: {
    title?: string | null;
    notes?: string | null;
    windowStart: Date;
    windowEnd: Date;
    desiredFlightCount: number;
    preferences?: Record<string, unknown>;
  },
): Promise<ScheduleRequest> {
  if (input.desiredFlightCount < 1 || input.desiredFlightCount > 50) {
    throw new AppError(
      "BAD_REQUEST",
      "desiredFlightCount must be between 1 and 50",
    );
  }

  const normalizedAvailability = normalizeAvailability({
    preferences: input.preferences,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
  });

  const scheduleRequest = await scheduleRepo.createScheduleRequest({
    tenantId: actor.tenantId,
    pilotMembershipId: actor.membershipId,
    actorMembershipId: actor.membershipId,
    ...input,
    preferences: normalizedAvailability.preferences,
  });

  return scheduleRequest;
}

export async function getRequest(
  tenantId: string,
  id: string,
  actor: { membershipId: string; role: MemberRole },
) {
  const scheduleRequest = await scheduleRepo.findScheduleRequest(tenantId, id);
  if (!scheduleRequest) {
    throw new AppError("NOT_FOUND", "Schedule request not found");
  }
  if (
    !roleAtLeast(actor.role, "dispatcher") &&
    scheduleRequest.pilotMembershipId !== actor.membershipId
  ) {
    throw new AppError("FORBIDDEN", "Not your schedule request");
  }

  const linkedFlightCount = await countNonCancelledScheduleRequestFlights(
    tenantId,
    id,
  );

  return {
    request: scheduleRequest,
    fulfillment: {
      linkedFlightCount,
      remainingFlightCount: Math.max(
        0,
        scheduleRequest.desiredFlightCount - linkedFlightCount,
      ),
    },
  };
}

export async function listRequests(
  actor: {
    tenantId: string;
    membershipId: string;
    role: MemberRole;
  },
  query: {
    status?: ScheduleRequest["status"];
    cursor?: string;
    limit: number;
  },
) {
  return scheduleRepo.listScheduleRequests({
    tenantId: actor.tenantId,
    pilotMembershipId: roleAtLeast(actor.role, "dispatcher")
      ? undefined
      : actor.membershipId,
    ...query,
  });
}

export async function editRequest(
  actor: {
    tenantId: string;
    membershipId: string;
    role: MemberRole;
  },
  id: string,
  expectedVersion: number,
  input: {
    title?: string | null;
    notes?: string | null;
    windowStart: Date;
    windowEnd: Date;
    desiredFlightCount: number;
    preferences?: Record<string, unknown>;
  },
): Promise<ScheduleRequest> {
  const scheduleRequest = await scheduleRepo.findScheduleRequest(
    actor.tenantId,
    id,
  );
  if (!scheduleRequest) {
    throw new AppError("NOT_FOUND", "Schedule request not found");
  }
  if (
    actor.role !== "pilot" ||
    scheduleRequest.pilotMembershipId !== actor.membershipId
  ) {
    throw new AppError(
      "FORBIDDEN",
      "Only the owning pilot can edit a schedule request",
    );
  }
  assertExpectedRequestVersion(scheduleRequest, expectedVersion);
  if (scheduleRequest.status !== "pending") {
    throw new AppError(
      "CONFLICT",
      "A schedule request is locked once dispatch starts review",
      {
        details: { latest: safeScheduleRequestRepresentation(scheduleRequest) },
      },
    );
  }
  if (input.desiredFlightCount < 1 || input.desiredFlightCount > 50) {
    throw new AppError(
      "BAD_REQUEST",
      "desiredFlightCount must be between 1 and 50",
    );
  }

  const normalizedAvailability = normalizeAvailability({
    preferences: input.preferences,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
  });
  const patch = {
    title: input.title ?? null,
    notes: input.notes ?? null,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    desiredFlightCount: input.desiredFlightCount,
    preferences: normalizedAvailability.preferences,
  };
  const changedFields = changedRequestFields(scheduleRequest, patch);
  if (changedFields.length === 0) return scheduleRequest;

  const linkedFlightCount = await countNonCancelledScheduleRequestFlights(
    actor.tenantId,
    id,
  );
  if (linkedFlightCount > 0) {
    throw new AppError(
      "CONFLICT",
      "A request with linked flights cannot be edited; dispatch must cancel or replace the affected records",
      {
        details: { latest: safeScheduleRequestRepresentation(scheduleRequest) },
      },
    );
  }

  const updated = await scheduleRepo.updateScheduleRequest({
    tenantId: actor.tenantId,
    id,
    expectedVersion,
    expectedStatus: "pending",
    actorMembershipId: actor.membershipId,
    action: "schedule_request.edited",
    auditMeta: {
      fromVersion: scheduleRequest.version,
      toVersion: scheduleRequest.version + 1,
      changedFields,
    },
    patch,
  });
  if (!updated) return throwLatestRequestConflict(actor.tenantId, id);
  return updated;
}

export async function transitionRequest(
  actor: {
    tenantId: string;
    membershipId: string;
    role: MemberRole;
  },
  id: string,
  nextStatus: ScheduleRequest["status"],
  transitionDetails: { expectedVersion: number; reason?: string },
): Promise<ScheduleRequest> {
  const scheduleRequest = await scheduleRepo.findScheduleRequest(
    actor.tenantId,
    id,
  );
  if (!scheduleRequest) {
    throw new AppError("NOT_FOUND", "Schedule request not found");
  }

  if (
    nextStatus === "in_review" ||
    nextStatus === "rejected" ||
    nextStatus === "fulfilled" ||
    nextStatus === "partially_fulfilled"
  ) {
    if (!roleAtLeast(actor.role, "dispatcher")) {
      throw new AppError("FORBIDDEN", "Dispatchers only");
    }
  } else {
    throw new AppError(
      "BAD_REQUEST",
      "Use the schedule cancellation workflow to cancel a request",
    );
  }

  assertExpectedRequestVersion(
    scheduleRequest,
    transitionDetails.expectedVersion,
  );
  assertScheduleRequestTransition(scheduleRequest.status, nextStatus);
  const updatedScheduleRequest = await scheduleRepo.transitionScheduleRequest({
    tenantId: actor.tenantId,
    id,
    expectedVersion: transitionDetails.expectedVersion,
    expectedStatus: scheduleRequest.status,
    status: nextStatus,
    actorMembershipId: actor.membershipId,
    action: `schedule_request.${nextStatus}`,
    reason: transitionDetails.reason,
    auditMeta: {
      from: scheduleRequest.status,
      to: nextStatus,
      reason: transitionDetails.reason,
    },
  });
  if (!updatedScheduleRequest) {
    return throwLatestRequestConflict(actor.tenantId, id);
  }

  return updatedScheduleRequest;
}

export async function cancelRequest(
  actor: {
    tenantId: string;
    membershipId: string;
    role: MemberRole;
  },
  id: string,
  input: {
    expectedVersion: number;
    linkedFlightAction: scheduleRepo.LinkedFlightCancellationAction;
    reason?: string;
  },
): Promise<ScheduleRequest> {
  const scheduleRequest = await scheduleRepo.findScheduleRequest(
    actor.tenantId,
    id,
  );
  if (!scheduleRequest) {
    throw new AppError("NOT_FOUND", "Schedule request not found");
  }
  const isOwner = scheduleRequest.pilotMembershipId === actor.membershipId;
  const isDispatcher = roleAtLeast(actor.role, "dispatcher");
  if (!isOwner && !isDispatcher) {
    throw new AppError("FORBIDDEN", "Cannot cancel this request");
  }
  assertExpectedRequestVersion(scheduleRequest, input.expectedVersion);
  assertScheduleRequestTransition(scheduleRequest.status, "cancelled");

  const cancelled = await scheduleRepo.cancelScheduleRequest({
    tenantId: actor.tenantId,
    id,
    expectedVersion: input.expectedVersion,
    expectedStatus: scheduleRequest.status,
    actorMembershipId: actor.membershipId,
    linkedFlightAction: input.linkedFlightAction,
    reason: input.reason,
  });
  if (!cancelled) return throwLatestRequestConflict(actor.tenantId, id);
  return cancelled;
}

function assertExpectedRequestVersion(
  scheduleRequest: ScheduleRequest,
  expectedVersion: number,
): void {
  if (scheduleRequest.version !== expectedVersion) {
    throw new AppError(
      "CONFLICT",
      "Schedule request changed since it was loaded",
      {
        details: { latest: safeScheduleRequestRepresentation(scheduleRequest) },
      },
    );
  }
}

async function throwLatestRequestConflict(
  tenantId: string,
  id: string,
): Promise<never> {
  const latest = await scheduleRepo.findScheduleRequest(tenantId, id);
  if (!latest) throw new AppError("NOT_FOUND", "Schedule request not found");
  throw new AppError(
    "CONFLICT",
    "Schedule request changed since it was loaded",
    { details: { latest: safeScheduleRequestRepresentation(latest) } },
  );
}

function changedRequestFields(
  scheduleRequest: ScheduleRequest,
  patch: {
    title: string | null;
    notes: string | null;
    windowStart: Date;
    windowEnd: Date;
    desiredFlightCount: number;
    preferences: Record<string, unknown>;
  },
): string[] {
  const changedFields: string[] = [];
  if (scheduleRequest.title !== patch.title) changedFields.push("title");
  if (scheduleRequest.notes !== patch.notes) changedFields.push("notes");
  if (scheduleRequest.windowStart.getTime() !== patch.windowStart.getTime()) {
    changedFields.push("windowStart");
  }
  if (scheduleRequest.windowEnd.getTime() !== patch.windowEnd.getTime()) {
    changedFields.push("windowEnd");
  }
  if (scheduleRequest.desiredFlightCount !== patch.desiredFlightCount) {
    changedFields.push("desiredFlightCount");
  }
  if (
    JSON.stringify(scheduleRequest.preferences) !==
    JSON.stringify(patch.preferences)
  ) {
    changedFields.push("preferences");
  }
  return changedFields;
}

function safeScheduleRequestRepresentation(scheduleRequest: ScheduleRequest) {
  return {
    id: scheduleRequest.id,
    pilotMembershipId: scheduleRequest.pilotMembershipId,
    title: scheduleRequest.title,
    notes: scheduleRequest.notes,
    windowStart: scheduleRequest.windowStart.toISOString(),
    windowEnd: scheduleRequest.windowEnd.toISOString(),
    desiredFlightCount: scheduleRequest.desiredFlightCount,
    preferences: scheduleRequest.preferences,
    version: scheduleRequest.version,
    status: scheduleRequest.status,
    rejectReason: scheduleRequest.rejectReason,
    cancelReason: scheduleRequest.cancelReason,
    updatedAt: scheduleRequest.updatedAt.toISOString(),
  };
}
