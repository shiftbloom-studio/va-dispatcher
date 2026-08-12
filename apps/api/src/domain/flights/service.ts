import { createHash } from "node:crypto";
import { writeAudit } from "../../db/repositories/audit.js";
import * as releaseRepo from "../../db/repositories/dispatch-releases.js";
import {
  createFlightEvent,
  listFlightEvents,
} from "../../db/repositories/flight-events.js";
import * as flightRepo from "../../db/repositories/flights.js";
import { findMembershipById } from "../../db/repositories/memberships.js";
import { findScheduleRequest } from "../../db/repositories/schedule-requests.js";
import type {
  DispatchRelease,
  DispatchUnit,
  Flight,
  FlightEventKind,
  FlightStatus,
  MemberRole,
  ScheduleRequest,
  ScheduleFulfillmentAttempt,
} from "../../db/schema.js";
import { AppError } from "../../lib/errors.js";
import { isUniqueViolation } from "../../lib/postgres.js";
import type { FlightCursorPayload } from "../../lib/pagination.js";
import { roleAtLeast } from "../members/roles.js";
import { assertFlightInsideAvailability } from "../schedule-requests/availability.js";
import { assertScheduleRequestTransition } from "../schedule-requests/transitions.js";
import { fetchWeatherSnapshot } from "./weather.js";
import { assertFlightTransition, pilotMayCancel } from "./transitions.js";

type Actor = {
  tenantId: string;
  membershipId: string;
  role: MemberRole;
};

export type DispatchReleaseDraft = {
  operationalRoute: string;
  sid?: string | null;
  star?: string | null;
  cruiseLevel: number;
  alternateIcao: string;
  fuelUnit: DispatchUnit;
  payloadUnit: DispatchUnit;
  taxiFuel: number;
  tripFuel: number;
  contingencyFuel: number;
  alternateFuel: number;
  finalReserveFuel: number;
  additionalFuel: number;
  blockFuel: number;
  plannedPayload: number;
  releaseNotes?: string | null;
  dispatcherRemarks?: string | null;
};

export async function createFlight(
  actor: Actor,
  input: {
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
  requireDispatcher(actor);
  assertFlightTimes(input.etd, input.eta);

  const pilotMembershipId = input.pilotMembershipId ?? null;
  await assertActivePilot(actor.tenantId, pilotMembershipId, {
    required: (input.status ?? "draft") === "offered",
  });

  const flight = await flightRepo.createFlight({
    tenantId: actor.tenantId,
    actorMembershipId: actor.membershipId,
    scheduleRequestId: null,
    pilotMembershipId,
    flightNumber: input.flightNumber,
    depIcao: input.depIcao,
    arrIcao: input.arrIcao,
    etd: input.etd,
    eta: input.eta,
    aircraftType: input.aircraftType,
    status: input.status ?? "draft",
    dispatcherNotes: input.dispatcherNotes,
  });

  return flight;
}

export async function bulkCreateFlights(
  actor: Actor,
  input: {
    scheduleRequestId: string;
    idempotencyKey: string;
    expectedRequestVersion: number;
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
): Promise<flightRepo.ScheduleFulfillmentResult> {
  requireDispatcher(actor);
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const normalizedFlights = input.flights.map(normalizeFulfillmentFlight);
  const payloadHash = fulfillmentPayloadHash({
    scheduleRequestId: input.scheduleRequestId,
    expectedRequestVersion: input.expectedRequestVersion,
    flights: normalizedFlights,
  });
  const existingAttempt = await flightRepo.findScheduleFulfillmentAttempt(
    actor.tenantId,
    input.scheduleRequestId,
    idempotencyKey,
  );
  if (existingAttempt) {
    return replayMatchingFulfillment(existingAttempt, payloadHash);
  }
  const scheduleRequest = await findScheduleRequest(
    actor.tenantId,
    input.scheduleRequestId,
  );
  if (!scheduleRequest) {
    throw new AppError("NOT_FOUND", "Schedule request not found");
  }
  if (scheduleRequest.version !== input.expectedRequestVersion) {
    throw scheduleRequestConflict(scheduleRequest);
  }
  if (
    scheduleRequest.status !== "in_review" &&
    scheduleRequest.status !== "partially_fulfilled"
  ) {
    throw new AppError(
      "CONFLICT",
      "Flights can only be appended while a request is in review or partially fulfilled",
      { details: { latest: safeScheduleRequestForConflict(scheduleRequest) } },
    );
  }

  if (normalizedFlights.length === 0) {
    throw new AppError("BAD_REQUEST", "At least one flight is required");
  }

  await assertActivePilot(actor.tenantId, scheduleRequest.pilotMembershipId, {
    required: true,
  });
  for (const flight of normalizedFlights) {
    assertFlightTimes(flight.etd, flight.eta);
    const pilotMembershipId = resolveRequestAssignment(
      flight.pilotMembershipId,
      scheduleRequest,
    );
    await assertActivePilot(actor.tenantId, pilotMembershipId, {
      required: true,
    });
    assertFlightInsideAvailability(flight.etd, flight.eta, scheduleRequest);
  }

  const createdFlights = await flightRepo.fulfillScheduleRequest({
    tenantId: actor.tenantId,
    scheduleRequestId: input.scheduleRequestId,
    idempotencyKey,
    payloadHash,
    expectedRequestVersion: input.expectedRequestVersion,
    expectedRequestStatus: scheduleRequest.status,
    actorMembershipId: actor.membershipId,
    flights: normalizedFlights.map((flight) => ({
      flightNumber: flight.flightNumber,
      depIcao: flight.depIcao,
      arrIcao: flight.arrIcao,
      etd: flight.etd,
      eta: flight.eta,
      aircraftType: flight.aircraftType,
    })),
  });
  if (!createdFlights) {
    const concurrentAttempt = await flightRepo.findScheduleFulfillmentAttempt(
      actor.tenantId,
      input.scheduleRequestId,
      idempotencyKey,
    );
    if (concurrentAttempt) {
      return replayMatchingFulfillment(concurrentAttempt, payloadHash);
    }
    const latest = await findScheduleRequest(
      actor.tenantId,
      scheduleRequest.id,
    );
    if (!latest) throw new AppError("NOT_FOUND", "Schedule request not found");
    const existingFlightCount =
      await flightRepo.countNonCancelledScheduleRequestFlights(
        actor.tenantId,
        scheduleRequest.id,
      );
    throw new AppError(
      "CONFLICT",
      "The request changed or the batch exceeds its remaining flight count",
      {
        details: {
          latest: safeScheduleRequestForConflict(latest),
          existingFlightCount,
          remainingFlightCount: Math.max(
            0,
            latest.desiredFlightCount - existingFlightCount,
          ),
        },
      },
    );
  }
  return createdFlights;
}

function normalizeIdempotencyKey(value: string): string {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 200) {
    throw new AppError(
      "BAD_REQUEST",
      "Idempotency-Key must contain between 1 and 200 characters",
    );
  }
  return normalized;
}

function normalizeFulfillmentFlight(flight: {
  flightNumber: string;
  depIcao: string;
  arrIcao: string;
  etd: Date;
  eta: Date;
  aircraftType?: string | null;
  pilotMembershipId?: string | null;
}) {
  return {
    flightNumber: flight.flightNumber.trim().toUpperCase(),
    depIcao: flight.depIcao.trim().toUpperCase(),
    arrIcao: flight.arrIcao.trim().toUpperCase(),
    etd: flight.etd,
    eta: flight.eta,
    aircraftType: flight.aircraftType?.trim().toUpperCase() || null,
    pilotMembershipId: flight.pilotMembershipId ?? null,
  };
}

function fulfillmentPayloadHash(input: {
  scheduleRequestId: string;
  expectedRequestVersion: number;
  flights: Array<ReturnType<typeof normalizeFulfillmentFlight>>;
}): string {
  const canonicalPayload = {
    scheduleRequestId: input.scheduleRequestId,
    expectedRequestVersion: input.expectedRequestVersion,
    flights: input.flights.map((flight) => ({
      flightNumber: flight.flightNumber,
      depIcao: flight.depIcao,
      arrIcao: flight.arrIcao,
      etd: flight.etd.toISOString(),
      eta: flight.eta.toISOString(),
      aircraftType: flight.aircraftType,
      pilotMembershipId: flight.pilotMembershipId,
    })),
  };
  return createHash("sha256")
    .update(JSON.stringify(canonicalPayload))
    .digest("hex");
}

async function replayMatchingFulfillment(
  attempt: ScheduleFulfillmentAttempt,
  payloadHash: string,
): Promise<flightRepo.ScheduleFulfillmentResult> {
  if (attempt.payloadHash !== payloadHash) {
    throw new AppError(
      "CONFLICT",
      "Idempotency-Key was already used with a different fulfillment payload",
      {
        details: {
          scheduleRequestId: attempt.scheduleRequestId,
          requestStatus: attempt.requestStatus,
          requestVersion: attempt.requestVersion,
        },
      },
    );
  }
  return flightRepo.replayScheduleFulfillment(attempt);
}

function scheduleRequestConflict(scheduleRequest: ScheduleRequest): AppError {
  return new AppError(
    "CONFLICT",
    "Schedule request changed since it was loaded",
    { details: { latest: safeScheduleRequestForConflict(scheduleRequest) } },
  );
}

function safeScheduleRequestForConflict(scheduleRequest: ScheduleRequest) {
  return {
    id: scheduleRequest.id,
    pilotMembershipId: scheduleRequest.pilotMembershipId,
    desiredFlightCount: scheduleRequest.desiredFlightCount,
    version: scheduleRequest.version,
    status: scheduleRequest.status,
    updatedAt: scheduleRequest.updatedAt.toISOString(),
  };
}

export async function getFlight(
  tenantId: string,
  id: string,
  actor: { membershipId: string; role: MemberRole },
): Promise<Flight> {
  const flight = await requireFlight(tenantId, id);
  assertFlightVisibleToActor(flight, actor);
  return flight;
}

export async function getFlightDetail(
  tenantId: string,
  id: string,
  actor: { membershipId: string; role: MemberRole },
) {
  const flight = await getFlight(tenantId, id, actor);
  const [releases, events] = await Promise.all([
    releaseRepo.listDispatchReleaseRevisions(tenantId, id),
    listFlightEvents(tenantId, id),
  ]);
  return {
    flight,
    release: releases[0] ?? null,
    releaseRevisions: releases,
    events,
  };
}

export async function listFlightsForActor(
  actor: Actor,
  query: {
    status?: FlightStatus | FlightStatus[];
    fromEtd?: Date;
    toEtd?: Date;
    scheduleRequestId?: string;
    cursor?: FlightCursorPayload;
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
  actor: Actor,
  flightId: string,
  to: FlightStatus,
  transitionDetails: {
    expectedVersion: number;
    reason?: string;
  },
): Promise<Flight> {
  if (to === "active") {
    return startFlight(
      actor,
      flightId,
      new Date(),
      transitionDetails.expectedVersion,
    );
  }
  if (to === "completed") {
    return finishFlight(
      actor,
      flightId,
      new Date(),
      transitionDetails.expectedVersion,
    );
  }
  if (to === "briefed") {
    throw new AppError(
      "UNPROCESSABLE",
      "Publish a complete dispatch release to schedule this flight",
    );
  }

  const flight = await requireFlight(actor.tenantId, flightId);
  assertExpectedFlightVersion(flight, transitionDetails.expectedVersion);
  assertFlightTransition(flight.status, to);

  if (to === "offered") {
    assertFlightTimes(flight.etd, flight.eta);
    await assertActivePilot(actor.tenantId, flight.pilotMembershipId, {
      required: true,
    });
    if (flight.scheduleRequestId) {
      const scheduleRequest = await findScheduleRequest(
        actor.tenantId,
        flight.scheduleRequestId,
      );
      if (!scheduleRequest) {
        throw new AppError("NOT_FOUND", "Schedule request not found");
      }
      resolveRequestAssignment(flight.pilotMembershipId, scheduleRequest);
      assertFlightInsideAvailability(flight.etd, flight.eta, scheduleRequest);
    }
  }

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
  } else if (to === "offered") {
    requireDispatcher(actor);
  }

  const patch: flightRepo.UpdateFlightPatch = { status: to };
  if (to === "accepted") {
    patch.assignmentConfirmedRevision = flight.assignmentRevision;
    patch.assignmentConfirmedAt = new Date();
  }
  if (to === "cancelled") {
    patch.cancelReason = transitionDetails.reason ?? null;
  }
  if (to === "declined") {
    patch.declinedReason = transitionDetails.reason ?? null;
  }

  const updatedFlight = await updateFlightWithVersion({
    actor,
    flightId,
    expectedVersion: transitionDetails.expectedVersion,
    patch,
    action: `flight.${to}`,
    auditMeta: {
      from: flight.status,
      to,
      reason: transitionDetails.reason,
    },
  });
  return updatedFlight;
}

export async function patchFlight(
  actor: Actor,
  flightId: string,
  expectedVersion: number,
  changeReason: string | undefined,
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
  requireDispatcher(actor);
  const flight = await requireFlight(actor.tenantId, flightId);
  assertExpectedFlightVersion(flight, expectedVersion);
  if (
    flight.status === "declined" ||
    flight.status === "completed" ||
    flight.status === "cancelled"
  ) {
    throw new AppError(
      "CONFLICT",
      "Terminal flights are immutable; create a replacement offer for a declined flight",
    );
  }
  if (
    patch.pilotMembershipId === null &&
    ["accepted", "briefed", "active"].includes(flight.status)
  ) {
    throw new AppError(
      "UNPROCESSABLE",
      "Choose an active replacement pilot for an operational flight",
    );
  }

  const changedFields = changedPatchFields(flight, patch);
  const materialChange = changedFields.some((field) =>
    materialFlightFields.has(field),
  );
  if (materialChange && !changeReason?.trim()) {
    throw new AppError(
      "BAD_REQUEST",
      "A reason is required for material flight changes",
    );
  }
  if (flight.status === "active" && materialChange) {
    throw new AppError(
      "CONFLICT",
      "An active flight cannot be materially edited; cancel it and create a replacement",
      { details: { latest: safeFlightRepresentation(flight) } },
    );
  }
  const status =
    materialChange &&
    (flight.status === "accepted" || flight.status === "briefed")
      ? "offered"
      : flight.status;
  const resultingFlight = { ...flight, ...patch, status };
  assertFlightTimes(resultingFlight.etd, resultingFlight.eta);
  let scheduleRequest: ScheduleRequest | null = null;
  if (resultingFlight.scheduleRequestId) {
    scheduleRequest = await findScheduleRequest(
      actor.tenantId,
      resultingFlight.scheduleRequestId,
    );
    if (!scheduleRequest) {
      throw new AppError("NOT_FOUND", "Schedule request not found");
    }
  }
  const pilotMembershipId = resolveRequestAssignment(
    resultingFlight.pilotMembershipId,
    scheduleRequest,
  );
  await assertActivePilot(actor.tenantId, pilotMembershipId, {
    required: resultingFlight.status !== "draft",
  });
  if (scheduleRequest) {
    assertFlightInsideAvailability(
      resultingFlight.etd,
      resultingFlight.eta,
      scheduleRequest,
    );
  }

  const validatedPatch: flightRepo.UpdateFlightPatch = {
    ...patch,
  };
  if (status !== flight.status) {
    validatedPatch.status = status;
  }
  if (resultingFlight.pilotMembershipId !== pilotMembershipId) {
    validatedPatch.pilotMembershipId = pilotMembershipId;
  }
  const changedPilot =
    validatedPatch.pilotMembershipId !== undefined &&
    validatedPatch.pilotMembershipId !== flight.pilotMembershipId;
  const changedTime =
    (validatedPatch.etd !== undefined &&
      validatedPatch.etd.getTime() !== flight.etd.getTime()) ||
    (validatedPatch.eta !== undefined &&
      validatedPatch.eta.getTime() !== flight.eta.getTime());
  const requiresReconfirmation =
    (changedPilot || changedTime) &&
    ["accepted", "briefed", "active"].includes(flight.status);
  if (requiresReconfirmation) {
    validatedPatch.assignmentRevision = flight.assignmentRevision + 1;
  }

  const auditMeta = {
    fields: Object.keys(validatedPatch),
    changedFields,
    oldAssignment: flight.pilotMembershipId,
    newAssignment: pilotMembershipId,
    oldSchedule: {
      flightNumber: flight.flightNumber,
      depIcao: flight.depIcao,
      arrIcao: flight.arrIcao,
      etd: flight.etd.toISOString(),
      eta: flight.eta.toISOString(),
      aircraftType: flight.aircraftType,
    },
    newSchedule: {
      flightNumber: resultingFlight.flightNumber,
      depIcao: resultingFlight.depIcao,
      arrIcao: resultingFlight.arrIcao,
      etd: resultingFlight.etd.toISOString(),
      eta: resultingFlight.eta.toISOString(),
      aircraftType: resultingFlight.aircraftType,
    },
    oldStatus: flight.status,
    newStatus: status,
    acceptanceInvalidated: status !== flight.status,
    requiresPilotConfirmation: requiresReconfirmation,
    assignmentRevision:
      validatedPatch.assignmentRevision ?? flight.assignmentRevision,
    reason: changeReason?.trim(),
  };
  const updatedFlight = await updateFlightWithVersion({
    actor,
    flightId,
    expectedVersion,
    patch: validatedPatch,
    action: "flight.patch",
    auditMeta,
  });
  return updatedFlight;
}

export async function confirmAssignment(
  actor: Actor,
  flightId: string,
  expectedVersion: number,
): Promise<Flight> {
  const flight = await requireFlight(actor.tenantId, flightId);
  assertExpectedFlightVersion(flight, expectedVersion);
  if (flight.pilotMembershipId !== actor.membershipId) {
    throw new AppError("FORBIDDEN", "Only the assigned pilot can confirm");
  }
  if (!["accepted", "briefed", "active"].includes(flight.status)) {
    throw new AppError("CONFLICT", "This assignment cannot be confirmed now");
  }
  if (!assignmentNeedsConfirmation(flight)) return flight;
  return recordAssignmentConfirmation(actor, flight, "pilot_web", new Date());
}

export async function publishDispatchRelease(
  actor: Actor,
  flightId: string,
  expectedVersion: number,
  draft: DispatchReleaseDraft,
): Promise<{ flight: Flight; release: DispatchRelease }> {
  requireDispatcher(actor);
  const flight = await requireFlight(actor.tenantId, flightId);
  assertExpectedFlightVersion(flight, expectedVersion);
  if (flight.status !== "accepted" && flight.status !== "briefed") {
    throw new AppError(
      "CONFLICT",
      "Dispatch releases can only be published for accepted or scheduled flights",
    );
  }
  validateFuelBreakdown(draft);

  const weatherSnapshot = await fetchWeatherSnapshot([
    flight.depIcao,
    flight.arrIcao,
    draft.alternateIcao,
  ]);
  const published = await releaseRepo.publishDispatchReleaseAtomic({
    tenantId: actor.tenantId,
    flightId,
    expectedFlightVersion: expectedVersion,
    ...draft,
    operationalRoute: draft.operationalRoute.trim().toUpperCase(),
    alternateIcao: draft.alternateIcao.toUpperCase(),
    sid: draft.sid?.trim().toUpperCase() ?? null,
    star: draft.star?.trim().toUpperCase() ?? null,
    weatherSnapshot,
    releasedByMembershipId: actor.membershipId,
    publishedAt: new Date(),
  });
  if (!published) {
    throw new AppError(
      "CONFLICT",
      "The flight changed or another dispatcher published first. Reload and review the current release.",
    );
  }
  return published;
}

export async function startFlight(
  actor: Actor,
  flightId: string,
  occurredAt = new Date(),
  expectedVersion?: number,
): Promise<Flight> {
  const flight = await requireFlight(actor.tenantId, flightId);
  if (expectedVersion !== undefined) {
    assertExpectedFlightVersion(flight, expectedVersion);
  }
  const isDispatcher = roleAtLeast(actor.role, "dispatcher");
  if (!isDispatcher && flight.pilotMembershipId !== actor.membershipId) {
    throw new AppError(
      "FORBIDDEN",
      "Only the assigned pilot can start this flight",
    );
  }
  if (flight.status === "active") return flight;
  if (flight.status !== "briefed") {
    throw new AppError(
      "CONFLICT",
      "A scheduled flight is required before start",
    );
  }
  await requireRelease(actor.tenantId, flightId);
  assertFlightTransition(flight.status, "active");

  const patch: flightRepo.UpdateFlightPatch = {
    status: "active",
    outAt: flight.outAt ?? occurredAt,
  };
  if (!isDispatcher) {
    patch.assignmentConfirmedRevision = flight.assignmentRevision;
    patch.assignmentConfirmedAt = occurredAt;
  }
  const updated = await updateFlightWithVersion({
    actor,
    flightId,
    expectedVersion: expectedVersion ?? flight.version,
    patch,
    action: "flight.progress",
    auditMeta: {
      kind: "manual_start",
      source: isDispatcher ? "dispatcher" : "pilot_web",
      fromStatus: flight.status,
      toStatus: "active",
    },
  });

  await createFlightEvent({
    tenantId: actor.tenantId,
    flightId,
    kind: "manual_start",
    source: isDispatcher ? "dispatcher" : "pilot_web",
    occurredAt,
    actorMembershipId: actor.membershipId,
  });
  return updated;
}

export async function finishFlight(
  actor: Actor,
  flightId: string,
  occurredAt = new Date(),
  expectedVersion?: number,
): Promise<Flight> {
  const flight = await requireFlight(actor.tenantId, flightId);
  if (expectedVersion !== undefined) {
    assertExpectedFlightVersion(flight, expectedVersion);
  }
  const isDispatcher = roleAtLeast(actor.role, "dispatcher");
  if (!isDispatcher && flight.pilotMembershipId !== actor.membershipId) {
    throw new AppError(
      "FORBIDDEN",
      "Only the assigned pilot can finish this flight",
    );
  }
  if (flight.status === "completed") return flight;
  if (flight.status !== "active") {
    throw new AppError("CONFLICT", "Only an active flight can be finished");
  }
  assertFlightTransition(flight.status, "completed");
  const updated = await updateFlightWithVersion({
    actor,
    flightId,
    expectedVersion: expectedVersion ?? flight.version,
    patch: { status: "completed", inAt: flight.inAt ?? occurredAt },
    action: "flight.progress",
    auditMeta: {
      kind: "manual_finish",
      source: isDispatcher ? "dispatcher" : "pilot_web",
      fromStatus: flight.status,
      toStatus: "completed",
    },
  });

  await createFlightEvent({
    tenantId: actor.tenantId,
    flightId,
    kind: "manual_finish",
    source: isDispatcher ? "dispatcher" : "pilot_web",
    occurredAt,
    actorMembershipId: actor.membershipId,
  });
  return updated;
}

export async function applyHoppieProgress(input: {
  tenantId: string;
  flight: Flight;
  kind: Extract<FlightEventKind, "flt_init" | "out" | "off" | "on" | "in">;
  occurredAt: Date;
  acarsMessageId: string;
}): Promise<Flight | null> {
  const { flight, kind, occurredAt } = input;
  const patch: flightRepo.UpdateFlightPatch = {};

  if (kind === "flt_init" || kind === "out" || kind === "off") {
    if (flight.status !== "briefed" && flight.status !== "active") return null;
    await requireRelease(input.tenantId, flight.id);
    // Public aircraft/Hoppie documentation does not establish FLT INIT as an
    // OUT event. It confirms the assignment, while exact OUT/OFF interactions
    // (or audited web controls) are what start a scheduled flight.
    if (kind !== "flt_init" && flight.status === "briefed") {
      patch.status = "active";
    }
    patch.assignmentConfirmedRevision = flight.assignmentRevision;
    patch.assignmentConfirmedAt = occurredAt;
  }
  if (kind === "out" && !flight.outAt) patch.outAt = occurredAt;
  if (kind === "off" && !flight.offAt) patch.offAt = occurredAt;
  if (kind === "on") {
    if (flight.status !== "active") return null;
    if (!flight.onAt) patch.onAt = occurredAt;
  }
  if (kind === "in") {
    if (flight.status !== "active" && flight.status !== "completed")
      return null;
    if (flight.status === "active") patch.status = "completed";
    if (!flight.inAt) patch.inAt = occurredAt;
  }

  const updated = await flightRepo.updateFlight({
    tenantId: input.tenantId,
    id: flight.id,
    expectedVersion: flight.version,
    actorMembershipId: null,
    action: "flight.progress",
    auditMeta: {
      kind,
      source: "hoppie",
      acarsMessageId: input.acarsMessageId,
      fromStatus: flight.status,
    },
    patch,
  });
  if (!updated) return null;
  await createFlightEvent({
    tenantId: input.tenantId,
    flightId: flight.id,
    kind,
    source: "hoppie",
    occurredAt,
    acarsMessageId: input.acarsMessageId,
    meta: { fromStatus: flight.status, toStatus: updated.status },
  });
  return updated;
}

export type DispatchBoardLane =
  "overdue" | "accepted" | "briefed" | "active" | "completed";

export async function getDispatchBoard(tenantId: string, now = new Date()) {
  const window = flightRepo.dispatchBoardWindow(now);
  const boardFlights = await flightRepo.listBoardFlights(tenantId, now);
  const latestReleases = await releaseRepo.findLatestDispatchReleases(
    tenantId,
    boardFlights.map((flight) => flight.id),
  );
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  const nextMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  );
  const metricFlights = await flightRepo.listMonthMetricFlights(
    tenantId,
    monthStart,
    nextMonth,
  );
  const departureEligible = metricFlights.filter(
    (flight) => flight.etd.getTime() <= now.getTime(),
  );
  const trackedDepartures = departureEligible.filter((flight) => flight.outAt);
  const onTimeDepartures = trackedDepartures.filter(
    (flight) =>
      flight.outAt!.getTime() <= flight.etd.getTime() + 15 * 60 * 1000,
  );
  const finished = metricFlights.filter(
    (flight) => flight.status === "completed",
  ).length;

  return {
    flights: boardFlights.map((flight) => ({
      flight,
      lane: dispatchBoardLane(flight, now),
      latestReleaseRevision: latestReleases.get(flight.id)?.revision ?? null,
      assignmentConfirmationRequired: assignmentNeedsConfirmation(flight),
    })),
    window,
    metrics: {
      window: {
        from: monthStart.toISOString(),
        toExclusive: nextMonth.toISOString(),
        label: "Current UTC calendar month",
      },
      activeFlights: {
        value: boardFlights.filter((flight) => flight.status === "active")
          .length,
        definition: "Flights currently in Active status.",
      },
      onTimePerformance: {
        value:
          trackedDepartures.length === 0
            ? null
            : onTimeDepartures.length / trackedDepartures.length,
        onTime: onTimeDepartures.length,
        tracked: trackedDepartures.length,
        eligible: departureEligible.length,
        definition:
          "Actual OUT at or before ETD + 15 minutes. Flights without an OUT event are excluded from the rate and shown in coverage.",
      },
      scheduledVsFinished: {
        scheduled: metricFlights.length,
        finished,
        value:
          metricFlights.length === 0 ? null : finished / metricFlights.length,
        definition:
          "Finished flights divided by Scheduled, Active, and Finished flights with ETD in the current UTC month.",
      },
    },
  };
}

export function dispatchBoardLane(
  flight: Pick<Flight, "status" | "etd">,
  now: Date,
): DispatchBoardLane {
  if (flight.status === "active" || flight.status === "completed") {
    return flight.status;
  }
  if (
    (flight.status === "accepted" || flight.status === "briefed") &&
    flight.etd.getTime() < now.getTime()
  ) {
    return "overdue";
  }
  if (flight.status === "accepted" || flight.status === "briefed") {
    return flight.status;
  }
  throw new Error(`Unsupported dispatch board status: ${flight.status}`);
}

export function assignmentNeedsConfirmation(flight: Flight): boolean {
  return (
    flight.pilotMembershipId !== null &&
    flight.assignmentConfirmedRevision !== flight.assignmentRevision &&
    ["accepted", "briefed", "active"].includes(flight.status)
  );
}

async function recordAssignmentConfirmation(
  actor: Actor,
  flight: Flight,
  source: "pilot_web",
  occurredAt: Date,
): Promise<Flight> {
  const updated = await updateFlightWithVersion({
    actor,
    flightId: flight.id,
    expectedVersion: flight.version,
    patch: {
      assignmentConfirmedRevision: flight.assignmentRevision,
      assignmentConfirmedAt: occurredAt,
    },
    action: "flight.assignment_confirm",
    auditMeta: { revision: flight.assignmentRevision, source },
  });
  await createFlightEvent({
    tenantId: actor.tenantId,
    flightId: flight.id,
    kind: "assignment_confirmed",
    source,
    occurredAt,
    actorMembershipId: actor.membershipId,
    meta: { revision: flight.assignmentRevision },
  });
  return updated;
}

function validateFuelBreakdown(draft: DispatchReleaseDraft): void {
  if (draft.tripFuel <= 0 || draft.blockFuel <= 0) {
    throw new AppError(
      "UNPROCESSABLE",
      "Trip fuel and block fuel must be greater than zero",
    );
  }
  const expectedBlock =
    draft.taxiFuel +
    draft.tripFuel +
    draft.contingencyFuel +
    draft.alternateFuel +
    draft.finalReserveFuel +
    draft.additionalFuel;
  if (draft.blockFuel !== expectedBlock) {
    throw new AppError(
      "UNPROCESSABLE",
      `Block fuel must equal the fuel breakdown total (${expectedBlock} ${draft.fuelUnit})`,
    );
  }
}

async function requireFlight(tenantId: string, id: string): Promise<Flight> {
  const flight = await flightRepo.findFlight(tenantId, id);
  if (!flight) throw new AppError("NOT_FOUND", "Flight not found");
  return flight;
}

async function requireRelease(
  tenantId: string,
  flightId: string,
): Promise<DispatchRelease> {
  const release = await releaseRepo.findLatestDispatchRelease(
    tenantId,
    flightId,
  );
  if (!release) {
    throw new AppError(
      "CONFLICT",
      "A complete dispatch release is required before start",
    );
  }
  return release;
}

function requireDispatcher(actor: Actor): void {
  if (!roleAtLeast(actor.role, "dispatcher")) {
    throw new AppError("FORBIDDEN", "Dispatchers only");
  }
}

function assertFlightVisibleToActor(
  flight: Flight,
  actor: { membershipId: string; role: MemberRole },
): void {
  if (
    !roleAtLeast(actor.role, "dispatcher") &&
    flight.pilotMembershipId !== actor.membershipId
  ) {
    throw new AppError("FORBIDDEN", "Not your flight");
  }
}

// Dispatcher notes are operational annotations and intentionally do not revoke
// an accepted/briefed offer. Assignment, route, time, and equipment changes do.
const materialFlightFields = new Set([
  "pilotMembershipId",
  "flightNumber",
  "depIcao",
  "arrIcao",
  "etd",
  "eta",
  "aircraftType",
]);

export async function reofferDeclinedFlight(
  actor: {
    tenantId: string;
    membershipId: string;
    role: MemberRole;
  },
  sourceFlightId: string,
  input: {
    expectedVersion: number;
    pilotMembershipId?: string | null;
    reason: string;
  },
): Promise<Flight> {
  if (!roleAtLeast(actor.role, "dispatcher")) {
    throw new AppError("FORBIDDEN", "Dispatchers only");
  }
  const source = await flightRepo.findFlight(actor.tenantId, sourceFlightId);
  if (!source) {
    throw new AppError("NOT_FOUND", "Flight not found");
  }
  assertExpectedFlightVersion(source, input.expectedVersion);
  if (source.status !== "declined") {
    throw new AppError(
      "CONFLICT",
      "Only a declined flight can be replaced through the re-offer workflow",
      { details: { latest: safeFlightRepresentation(source) } },
    );
  }

  let scheduleRequest: ScheduleRequest | null = null;
  if (source.scheduleRequestId) {
    scheduleRequest = await findScheduleRequest(
      actor.tenantId,
      source.scheduleRequestId,
    );
    if (!scheduleRequest) {
      throw new AppError("NOT_FOUND", "Schedule request not found");
    }
  }
  const pilotMembershipId = resolveRequestAssignment(
    input.pilotMembershipId ?? source.pilotMembershipId,
    scheduleRequest,
  );
  await assertActivePilot(actor.tenantId, pilotMembershipId, {
    required: true,
  });
  assertFlightTimes(source.etd, source.eta);
  if (scheduleRequest) {
    assertFlightInsideAvailability(source.etd, source.eta, scheduleRequest);
  }

  const replacement = await flightRepo.createReplacementFlight({
    tenantId: actor.tenantId,
    sourceFlightId,
    expectedVersion: input.expectedVersion,
    actorMembershipId: actor.membershipId,
    scheduleRequestId: source.scheduleRequestId,
    oldPilotMembershipId: source.pilotMembershipId,
    pilotMembershipId: pilotMembershipId!,
    flightNumber: source.flightNumber,
    depIcao: source.depIcao,
    arrIcao: source.arrIcao,
    etd: source.etd,
    eta: source.eta,
    aircraftType: source.aircraftType,
    dispatcherNotes: source.dispatcherNotes,
    reason: input.reason,
  });
  if (!replacement) {
    const existingReplacement = await flightRepo.findReplacementFlight(
      actor.tenantId,
      sourceFlightId,
    );
    if (existingReplacement) {
      throw new AppError(
        "CONFLICT",
        "A replacement offer already exists for this declined flight",
        {
          details: {
            latest: safeFlightRepresentation(source),
            replacement: safeFlightRepresentation(existingReplacement),
          },
        },
      );
    }
    return throwLatestFlightConflict(actor.tenantId, sourceFlightId);
  }
  return replacement;
}

function assertFlightTimes(etd: Date, eta: Date): void {
  if (
    !Number.isFinite(etd.getTime()) ||
    !Number.isFinite(eta.getTime()) ||
    eta <= etd
  ) {
    throw new AppError("BAD_REQUEST", "eta must be after etd");
  }
}

/**
 * Request-linked flights always belong to the requesting pilot. Dispatchers
 * may omit the assignment to inherit it, but cannot override it to a different
 * member because that would silently transfer another pilot's availability.
 */
function resolveRequestAssignment(
  requestedPilotMembershipId: string | null | undefined,
  scheduleRequest: ScheduleRequest | null,
): string | null {
  if (!scheduleRequest) return requestedPilotMembershipId ?? null;
  if (
    requestedPilotMembershipId &&
    requestedPilotMembershipId !== scheduleRequest.pilotMembershipId
  ) {
    throw new AppError(
      "UNPROCESSABLE",
      "A request-linked flight must be assigned to the requesting pilot",
    );
  }
  return scheduleRequest.pilotMembershipId;
}

async function assertActivePilot(
  tenantId: string,
  pilotMembershipId: string | null,
  options: { required: boolean },
): Promise<void> {
  if (!pilotMembershipId) {
    if (options.required) {
      throw new AppError(
        "UNPROCESSABLE",
        "A pilot must be assigned before a flight can be offered",
      );
    }
    return;
  }

  const membership = await findMembershipById(tenantId, pilotMembershipId);
  if (!membership) {
    throw new AppError("NOT_FOUND", "Pilot membership not found");
  }
  if (membership.status !== "active" || membership.role !== "pilot") {
    throw new AppError(
      "UNPROCESSABLE",
      "The assigned membership must be an active pilot",
    );
  }
}

function assertExpectedFlightVersion(
  flight: Flight,
  expectedVersion: number,
): void {
  if (flight.version !== expectedVersion) {
    throw new AppError("CONFLICT", "Flight changed since it was loaded", {
      details: { latest: safeFlightRepresentation(flight) },
    });
  }
}

async function updateFlightWithVersion(input: {
  actor: { tenantId: string; membershipId: string };
  flightId: string;
  expectedVersion: number;
  patch: flightRepo.UpdateFlightPatch;
  action: string;
  auditMeta: Record<string, unknown>;
}): Promise<Flight> {
  const updated = await flightRepo.updateFlight({
    tenantId: input.actor.tenantId,
    id: input.flightId,
    expectedVersion: input.expectedVersion,
    actorMembershipId: input.actor.membershipId,
    action: input.action,
    auditMeta: input.auditMeta,
    patch: input.patch,
  });
  if (updated) return updated;
  return throwLatestFlightConflict(input.actor.tenantId, input.flightId);
}

async function throwLatestFlightConflict(
  tenantId: string,
  flightId: string,
): Promise<never> {
  const latest = await flightRepo.findFlight(tenantId, flightId);
  if (!latest) {
    throw new AppError("NOT_FOUND", "Flight not found");
  }
  throw new AppError("CONFLICT", "Flight changed since it was loaded", {
    details: { latest: safeFlightRepresentation(latest) },
  });
}

function changedPatchFields(
  flight: Flight,
  patch: flightRepo.UpdateFlightPatch,
): string[] {
  return Object.entries(patch)
    .filter(([field, nextValue]) => {
      const currentValue = flight[field as keyof Flight];
      if (currentValue instanceof Date && nextValue instanceof Date) {
        return currentValue.getTime() !== nextValue.getTime();
      }
      return currentValue !== nextValue;
    })
    .map(([field]) => field);
}

function safeFlightRepresentation(flight: Flight) {
  return {
    id: flight.id,
    scheduleRequestId: flight.scheduleRequestId,
    replacesFlightId: flight.replacesFlightId,
    pilotMembershipId: flight.pilotMembershipId,
    flightNumber: flight.flightNumber,
    depIcao: flight.depIcao,
    arrIcao: flight.arrIcao,
    etd: flight.etd.toISOString(),
    eta: flight.eta.toISOString(),
    aircraftType: flight.aircraftType,
    status: flight.status,
    dispatcherNotes: flight.dispatcherNotes,
    version: flight.version,
    updatedAt: flight.updatedAt.toISOString(),
  };
}
