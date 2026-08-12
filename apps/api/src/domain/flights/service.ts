import { writeAudit } from "../../db/repositories/audit.js";
import * as flightRepo from "../../db/repositories/flights.js";
import {
  findScheduleRequest,
  updateScheduleRequestStatus,
} from "../../db/repositories/schedule-requests.js";
import type { Flight, FlightStatus, MemberRole } from "../../db/schema.js";
import { AppError } from "../../lib/errors.js";
import { roleAtLeast } from "../members/roles.js";
import { assertScheduleRequestTransition } from "../schedule-requests/transitions.js";
import { assertFlightTransition, pilotMayCancel } from "./transitions.js";

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
    const scheduleRequest = await findScheduleRequest(
      actor.tenantId,
      input.scheduleRequestId,
    );
    if (!scheduleRequest) {
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
  const scheduleRequest = await findScheduleRequest(
    actor.tenantId,
    input.scheduleRequestId,
  );
  if (!scheduleRequest) {
    throw new AppError("NOT_FOUND", "Schedule request not found");
  }

  const createdFlights = await flightRepo.createFlights(
    input.flights.map((flight) => ({
      tenantId: actor.tenantId,
      scheduleRequestId: input.scheduleRequestId,
      pilotMembershipId:
        flight.pilotMembershipId ?? scheduleRequest.pilotMembershipId,
      flightNumber: flight.flightNumber,
      depIcao: flight.depIcao,
      arrIcao: flight.arrIcao,
      etd: flight.etd,
      eta: flight.eta,
      aircraftType: flight.aircraftType,
      status: "offered" as const,
    })),
  );

  // Move request into review/partial fulfillment heuristics
  if (scheduleRequest.status === "pending") {
    assertScheduleRequestTransition(scheduleRequest.status, "in_review");
    await updateScheduleRequestStatus(
      actor.tenantId,
      scheduleRequest.id,
      "in_review",
    );
  }

  const offeredCount = createdFlights.length;
  if (offeredCount >= scheduleRequest.desiredFlightCount) {
    if (
      scheduleRequest.status === "in_review" ||
      scheduleRequest.status === "pending"
    ) {
      await updateScheduleRequestStatus(
        actor.tenantId,
        scheduleRequest.id,
        "fulfilled",
      );
    }
  } else if (offeredCount > 0) {
    await updateScheduleRequestStatus(
      actor.tenantId,
      scheduleRequest.id,
      "partially_fulfilled",
    );
  }

  await writeAudit({
    tenantId: actor.tenantId,
    actorMembershipId: actor.membershipId,
    action: "flight.bulk_create",
    entityType: "schedule_request",
    entityId: input.scheduleRequestId,
    meta: { count: createdFlights.length },
  });

  return createdFlights;
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
  nextStatus: FlightStatus,
  transitionDetails?: {
    reason?: string;
  },
): Promise<Flight> {
  const flight = await flightRepo.findFlight(actor.tenantId, flightId);
  if (!flight) {
    throw new AppError("NOT_FOUND", "Flight not found");
  }

  assertFlightTransition(flight.status, nextStatus);

  // Authorization by transition
  if (nextStatus === "accepted" || nextStatus === "declined") {
    if (flight.pilotMembershipId !== actor.membershipId) {
      throw new AppError("FORBIDDEN", "Only the assigned pilot can respond");
    }
  } else if (nextStatus === "cancelled") {
    const isDispatcher = roleAtLeast(actor.role, "dispatcher");
    const isOwner = flight.pilotMembershipId === actor.membershipId;
    if (!isDispatcher && !(isOwner && pilotMayCancel(flight.status))) {
      throw new AppError("FORBIDDEN", "Cannot cancel this flight");
    }
  } else if (
    nextStatus === "offered" ||
    nextStatus === "briefed" ||
    nextStatus === "active" ||
    nextStatus === "completed"
  ) {
    if (!roleAtLeast(actor.role, "dispatcher")) {
      throw new AppError("FORBIDDEN", "Dispatchers only");
    }
  }

  const patch: Parameters<typeof flightRepo.updateFlight>[2] = {
    status: nextStatus,
  };
  if (nextStatus === "cancelled") {
    patch.cancelReason = transitionDetails?.reason ?? null;
  }
  if (nextStatus === "declined") {
    patch.declinedReason = transitionDetails?.reason ?? null;
  }

  const updatedFlight = await flightRepo.updateFlight(
    actor.tenantId,
    flightId,
    patch,
  );
  if (!updatedFlight) {
    throw new AppError("NOT_FOUND", "Flight not found");
  }

  await writeAudit({
    tenantId: actor.tenantId,
    actorMembershipId: actor.membershipId,
    action: `flight.${nextStatus}`,
    entityType: "flight",
    entityId: flightId,
    meta: {
      from: flight.status,
      to: nextStatus,
      reason: transitionDetails?.reason,
    },
  });

  return updatedFlight;
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

  const updatedFlight = await flightRepo.updateFlight(
    actor.tenantId,
    flightId,
    patch,
  );
  if (!updatedFlight) {
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

  return updatedFlight;
}

export async function getDispatchBoard(tenantId: string) {
  const boardFlights = await flightRepo.listBoardFlights(tenantId);
  return { flights: boardFlights };
}
