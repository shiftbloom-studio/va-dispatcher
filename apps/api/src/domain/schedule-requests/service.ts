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
    throw new AppError(
      "BAD_REQUEST",
      "windowEnd must be after windowStart",
    );
  }
  if (input.desiredFlightCount < 1 || input.desiredFlightCount > 50) {
    throw new AppError(
      "BAD_REQUEST",
      "desiredFlightCount must be between 1 and 50",
    );
  }

  const row = await scheduleRepo.createScheduleRequest({
    tenantId: actor.tenantId,
    pilotMembershipId: actor.membershipId,
    ...input,
  });

  await writeAudit({
    tenantId: actor.tenantId,
    actorMembershipId: actor.membershipId,
    action: "schedule_request.create",
    entityType: "schedule_request",
    entityId: row.id,
  });

  return row;
}

export async function getRequest(
  tenantId: string,
  id: string,
  actor: { membershipId: string; role: MemberRole },
) {
  const req = await scheduleRepo.findScheduleRequest(tenantId, id);
  if (!req) {
    throw new AppError("NOT_FOUND", "Schedule request not found");
  }
  if (
    !roleAtLeast(actor.role, "dispatcher") &&
    req.pilotMembershipId !== actor.membershipId
  ) {
    throw new AppError("FORBIDDEN", "Not your schedule request");
  }

  const linked = await listFlights({
    tenantId,
    scheduleRequestId: id,
    limit: 100,
  });

  return { request: req, flights: linked.items };
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
  to: ScheduleRequest["status"],
  extra?: { reason?: string },
): Promise<ScheduleRequest> {
  const req = await scheduleRepo.findScheduleRequest(actor.tenantId, id);
  if (!req) {
    throw new AppError("NOT_FOUND", "Schedule request not found");
  }

  assertScheduleRequestTransition(req.status, to);

  if (to === "cancelled") {
    const isOwner = req.pilotMembershipId === actor.membershipId;
    const isDispatcher = roleAtLeast(actor.role, "dispatcher");
    if (!isOwner && !isDispatcher) {
      throw new AppError("FORBIDDEN", "Cannot cancel this request");
    }
  } else if (
    to === "in_review" ||
    to === "rejected" ||
    to === "fulfilled" ||
    to === "partially_fulfilled"
  ) {
    if (!roleAtLeast(actor.role, "dispatcher")) {
      throw new AppError("FORBIDDEN", "Dispatchers only");
    }
  }

  const updated = await scheduleRepo.updateScheduleRequestStatus(
    actor.tenantId,
    id,
    to,
    { rejectReason: to === "rejected" ? (extra?.reason ?? null) : undefined },
  );
  if (!updated) {
    throw new AppError("NOT_FOUND", "Schedule request not found");
  }

  await writeAudit({
    tenantId: actor.tenantId,
    actorMembershipId: actor.membershipId,
    action: `schedule_request.${to}`,
    entityType: "schedule_request",
    entityId: id,
    meta: { from: req.status, to, reason: extra?.reason },
  });

  return updated;
}
