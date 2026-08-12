import { writeAudit } from "../../db/repositories/audit.js";
import * as scheduleRepo from "../../db/repositories/schedule-requests.js";
import { listFlights } from "../../db/repositories/flights.js";
import type { MemberRole, ScheduleRequest } from "../../db/schema.js";
import { AppError } from "../../lib/errors.js";
import { roleAtLeast } from "../members/roles.js";
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
  if (input.windowEnd <= input.windowStart) {
    throw new AppError("BAD_REQUEST", "windowEnd must be after windowStart");
  }
  if (input.desiredFlightCount < 1 || input.desiredFlightCount > 50) {
    throw new AppError(
      "BAD_REQUEST",
      "desiredFlightCount must be between 1 and 50",
    );
  }

  const scheduleRequest = await scheduleRepo.createScheduleRequest({
    tenantId: actor.tenantId,
    pilotMembershipId: actor.membershipId,
    ...input,
  });

  await writeAudit({
    tenantId: actor.tenantId,
    actorMembershipId: actor.membershipId,
    action: "schedule_request.create",
    entityType: "schedule_request",
    entityId: scheduleRequest.id,
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

  const linkedFlights = await listFlights({
    tenantId,
    scheduleRequestId: id,
    limit: 100,
  });

  return { request: scheduleRequest, flights: linkedFlights.items };
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

export async function transitionRequest(
  actor: {
    tenantId: string;
    membershipId: string;
    role: MemberRole;
  },
  id: string,
  nextStatus: ScheduleRequest["status"],
  transitionDetails?: { reason?: string },
): Promise<ScheduleRequest> {
  const scheduleRequest = await scheduleRepo.findScheduleRequest(
    actor.tenantId,
    id,
  );
  if (!scheduleRequest) {
    throw new AppError("NOT_FOUND", "Schedule request not found");
  }

  assertScheduleRequestTransition(scheduleRequest.status, nextStatus);

  if (nextStatus === "cancelled") {
    const isOwner = scheduleRequest.pilotMembershipId === actor.membershipId;
    const isDispatcher = roleAtLeast(actor.role, "dispatcher");
    if (!isOwner && !isDispatcher) {
      throw new AppError("FORBIDDEN", "Cannot cancel this request");
    }
  } else if (
    nextStatus === "in_review" ||
    nextStatus === "rejected" ||
    nextStatus === "fulfilled" ||
    nextStatus === "partially_fulfilled"
  ) {
    if (!roleAtLeast(actor.role, "dispatcher")) {
      throw new AppError("FORBIDDEN", "Dispatchers only");
    }
  }

  const updatedScheduleRequest = await scheduleRepo.updateScheduleRequestStatus(
    actor.tenantId,
    id,
    nextStatus,
    {
      rejectReason:
        nextStatus === "rejected"
          ? (transitionDetails?.reason ?? null)
          : undefined,
    },
  );
  if (!updatedScheduleRequest) {
    throw new AppError("NOT_FOUND", "Schedule request not found");
  }

  await writeAudit({
    tenantId: actor.tenantId,
    actorMembershipId: actor.membershipId,
    action: `schedule_request.${nextStatus}`,
    entityType: "schedule_request",
    entityId: id,
    meta: {
      from: scheduleRequest.status,
      to: nextStatus,
      reason: transitionDetails?.reason,
    },
  });

  return updatedScheduleRequest;
}
