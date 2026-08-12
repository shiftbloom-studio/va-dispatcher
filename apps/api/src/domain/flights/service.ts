import { writeAudit } from "../../db/repositories/audit.js";
import * as flightRepo from "../../db/repositories/flights.js";
import { findScheduleRequest } from "../../db/repositories/schedule-requests.js";
import { updateScheduleRequestStatus } from "../../db/repositories/schedule-requests.js";
import type { Flight, FlightStatus, MemberRole } from "../../db/schema.js";
import { AppError } from "../../lib/errors.js";
import { roleAtLeast } from "../members/roles.js";
import { assertScheduleRequestTransition } from "../schedule-requests/transitions.js";
import {
  assertFlightTransition,
  pilotMayCancel,
} from "./transitions.js";

export async function createFlight(
  actor: {
    tenantId: string;
    membershipId: string;
    role: MemberRole;
  },
  input: {
    scheduleRequestId?: string | null;
    pilotMembershipId?: string | null;
    flightNumber: string;
    depIcao: string;
    arrIcao: string;
    etd: Date;
    eta: Date;
    aircraftType?: string | null;
    status?: "draft" | "offered";
    dispatcherNotes?: string | null;
  },
): Promise<Flight> {
  if (!roleAtLeast(actor.role, "dispatcher")) {
    throw new AppError("FORBIDDEN", "Dispatchers only");
  }
  if (input.scheduleRequestId) {
    const req = await findScheduleRequest(
      actor.tenantId,
      input.scheduleRequestId,
    );
    if (!req) {
      throw new AppError("NOT_FOUND", "Schedule request not found");
    }
  }

  const flight = await flightRepo.createFlight({
    tenantId: actor.tenantId,
    scheduleRequestId: input.scheduleRequestId,
    pilotMembershipId: input.pilotMembershipId,
    flightNumber: input.flightNumber,
    depIcao: input.depIcao,
    arrIcao: input.arrIcao,
    etd: input.etd,
    eta: input.eta,
    aircraftType: input.aircraftType,
    status: input.status ?? "draft",
    dispatcherNotes: input.dispatcherNotes,
  });

  await writeAudit({
    tenantId: actor.tenantId,
    actorMembershipId: actor.membershipId,
    action: "flight.create",
    entityType: "flight",
    entityId: flight.id,
    meta: { status: flight.status },
  });

  return flight;
}

export async function bulkCreateFlights(
  actor: {
    tenantId: string;
    membershipId: string;
    role: MemberRole;
  },
  input: {
    scheduleRequestId: string;
    flights: Array<{
      flightNumber: string;
      depIcao: string;
      arrIcao: string;
      etd: Date;
      eta: Date;
      aircraftType?: string | null;
      pilotMembershipId?: string | null;
    }>;
  },
): Promise<Flight[]> {
  if (!roleAtLeast(actor.role, "dispatcher")) {
    throw new AppError("FORBIDDEN", "Dispatchers only");
  }
  const req = await findScheduleRequest(
    actor.tenantId,
    input.scheduleRequestId,
  );
  if (!req) {
    throw new AppError("NOT_FOUND", "Schedule request not found");
  }

  const created = await flightRepo.createFlights(
    input.flights.map((f) => ({
      tenantId: actor.tenantId,
      scheduleRequestId: input.scheduleRequestId,
      pilotMembershipId: f.pilotMembershipId ?? req.pilotMembershipId,
      flightNumber: f.flightNumber,
      depIcao: f.depIcao,
      arrIcao: f.arrIcao,
      etd: f.etd,
      eta: f.eta,
      aircraftType: f.aircraftType,
      status: "offered" as const,
    })),
  );

  // Move request into review/partial fulfillment heuristics
  if (req.status === "pending") {
    assertScheduleRequestTransition(req.status, "in_review");
    await updateScheduleRequestStatus(
      actor.tenantId,
      req.id,
      "in_review",
    );
  }

  const offeredCount = created.length;
  if (offeredCount >= req.desiredFlightCount) {
    if (req.status === "in_review" || req.status === "pending") {
      await updateScheduleRequestStatus(
        actor.tenantId,
        req.id,
        "fulfilled",
      );
    }
  } else if (offeredCount > 0) {
    await updateScheduleRequestStatus(
      actor.tenantId,
      req.id,
      "partially_fulfilled",
    );
  }

  await writeAudit({
    tenantId: actor.tenantId,
    actorMembershipId: actor.membershipId,
    action: "flight.bulk_create",
    entityType: "schedule_request",
    entityId: input.scheduleRequestId,
    meta: { count: created.length },
  });

  return created;
}

export async function getFlight(
  tenantId: string,
  id: string,
  actor: { membershipId: string; role: MemberRole },
): Promise<Flight> {
  const flight = await flightRepo.findFlight(tenantId, id);
  if (!flight) {
    throw new AppError("NOT_FOUND", "Flight not found");
  }
  if (
    !roleAtLeast(actor.role, "dispatcher") &&
    flight.pilotMembershipId !== actor.membershipId
  ) {
    throw new AppError("FORBIDDEN", "Not your flight");
  }
  return flight;
}

export async function listFlightsForActor(
  actor: {
    tenantId: string;
    membershipId: string;
    role: MemberRole;
  },
  query: {
    status?: FlightStatus | FlightStatus[];
    fromEtd?: Date;
    toEtd?: Date;
    scheduleRequestId?: string;
    cursor?: string;
    limit: number;
  },
) {
  return flightRepo.listFlights({
    tenantId: actor.tenantId,
    pilotMembershipId: roleAtLeast(actor.role, "dispatcher")
      ? undefined
      : actor.membershipId,
    ...query,
  });
}

export async function transitionFlight(
  actor: {
    tenantId: string;
    membershipId: string;
    role: MemberRole;
  },
  flightId: string,
  to: FlightStatus,
  extra?: {
    reason?: string;
  },
): Promise<Flight> {
  const flight = await flightRepo.findFlight(actor.tenantId, flightId);
  if (!flight) {
    throw new AppError("NOT_FOUND", "Flight not found");
  }

  assertFlightTransition(flight.status, to);

  // Authorization by transition
  if (to === "accepted" || to === "declined") {
    if (flight.pilotMembershipId !== actor.membershipId) {
      throw new AppError("FORBIDDEN", "Only the assigned pilot can respond");
    }
  } else if (to === "cancelled") {
    const isDispatcher = roleAtLeast(actor.role, "dispatcher");
    const isOwner = flight.pilotMembershipId === actor.membershipId;
    if (!isDispatcher && !(isOwner && pilotMayCancel(flight.status))) {
      throw new AppError("FORBIDDEN", "Cannot cancel this flight");
    }
  } else if (to === "offered" || to === "briefed" || to === "active" || to === "completed") {
    if (!roleAtLeast(actor.role, "dispatcher")) {
      throw new AppError("FORBIDDEN", "Dispatchers only");
    }
  }

  const patch: Parameters<typeof flightRepo.updateFlight>[2] = { status: to };
  if (to === "cancelled") {
    patch.cancelReason = extra?.reason ?? null;
  }
  if (to === "declined") {
    patch.declinedReason = extra?.reason ?? null;
  }

  const updated = await flightRepo.updateFlight(
    actor.tenantId,
    flightId,
    patch,
  );
  if (!updated) {
    throw new AppError("NOT_FOUND", "Flight not found");
  }

  await writeAudit({
    tenantId: actor.tenantId,
    actorMembershipId: actor.membershipId,
    action: `flight.${to}`,
    entityType: "flight",
    entityId: flightId,
    meta: { from: flight.status, to, reason: extra?.reason },
  });

  return updated;
}

export async function patchFlight(
  actor: {
    tenantId: string;
    membershipId: string;
    role: MemberRole;
  },
  flightId: string,
  patch: {
    flightNumber?: string;
    depIcao?: string;
    arrIcao?: string;
    etd?: Date;
    eta?: Date;
    aircraftType?: string | null;
    pilotMembershipId?: string | null;
    dispatcherNotes?: string | null;
  },
): Promise<Flight> {
  if (!roleAtLeast(actor.role, "dispatcher")) {
    throw new AppError("FORBIDDEN", "Dispatchers only");
  }
  const flight = await flightRepo.findFlight(actor.tenantId, flightId);
  if (!flight) {
    throw new AppError("NOT_FOUND", "Flight not found");
  }
  if (flight.status === "completed" || flight.status === "cancelled") {
    throw new AppError(
      "CONFLICT",
      "Cannot edit a completed or cancelled flight",
    );
  }

  const updated = await flightRepo.updateFlight(
    actor.tenantId,
    flightId,
    patch,
  );
  if (!updated) {
    throw new AppError("NOT_FOUND", "Flight not found");
  }

  await writeAudit({
    tenantId: actor.tenantId,
    actorMembershipId: actor.membershipId,
    action: "flight.patch",
    entityType: "flight",
    entityId: flightId,
    meta: { fields: Object.keys(patch) },
  });

  return updated;
}

export async function getDispatchBoard(tenantId: string) {
  const boardFlights = await flightRepo.listBoardFlights(tenantId);
  return { flights: boardFlights };
}
