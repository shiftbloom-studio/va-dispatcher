import { randomBytes, randomUUID } from "node:crypto";

import * as telemetryRepo from "../../db/repositories/telemetry.js";
import { findFlight } from "../../db/repositories/flights.js";
import type {
  Flight,
  FlightOooiEvent,
  FlightTelemetryCurrent,
  MemberRole,
  SimulatorDevice,
} from "../../db/schema.js";
import { env } from "../../env.js";
import { createTokenMac, verifyTokenMac } from "../../lib/crypto.js";
import { AppError } from "../../lib/errors.js";
import { roleAtLeast } from "../members/roles.js";
import type { OooiCorrection, TelemetryIngest } from "./validation.js";

const INGEST_MINIMUM_INTERVAL_MS = 2_000;
const ONLINE_AFTER_MS = 30_000;
const STALE_AFTER_MS = 2 * 60_000;
const FLIGHT_WRITER_LEASE_MS = STALE_AFTER_MS;
const MAX_DEVICE_NAME_LENGTH = 80;

export type TelemetryActor = {
  tenantId: string;
  membershipId: string;
  role: MemberRole;
};

export type PresenceState = "online" | "stale" | "disconnected";

export function presenceState(
  sampleAt: Date | null,
  now = new Date(),
): PresenceState {
  if (!sampleAt) return "disconnected";
  const age = Math.max(0, now.getTime() - sampleAt.getTime());
  if (age <= ONLINE_AFTER_MS) return "online";
  if (age <= STALE_AFTER_MS) return "stale";
  return "disconnected";
}

export async function createDevice(
  actor: TelemetryActor,
  name: string,
): Promise<{ device: SimulatorDevice; token: string }> {
  if (actor.role !== "pilot") {
    throw new AppError(
      "FORBIDDEN",
      "Only pilots can create simulator device credentials",
    );
  }
  const normalizedName = name.trim();
  if (!normalizedName || normalizedName.length > MAX_DEVICE_NAME_LENGTH) {
    throw new AppError("BAD_REQUEST", "Use a device name up to 80 characters");
  }
  const id = randomUUID();
  const secret = randomBytes(32).toString("base64url");
  const token = `v1.${id}.${secret}`;
  const device = await telemetryRepo.createSimulatorDeviceAtomic({
    id,
    tenantId: actor.tenantId,
    membershipId: actor.membershipId,
    name: normalizedName,
    tokenMac: createTokenMac(
      secret,
      requireSecretsKey(),
      "simulator-device-token",
    ),
  });
  return { device, token };
}

export async function listDevices(
  actor: TelemetryActor,
): Promise<SimulatorDevice[]> {
  return telemetryRepo.listSimulatorDevices({
    tenantId: actor.tenantId,
    membershipId: actor.membershipId,
  });
}

export async function revokeDevice(
  actor: TelemetryActor,
  id: string,
): Promise<SimulatorDevice> {
  const revokedAt = new Date();
  const device = await telemetryRepo.revokeSimulatorDeviceAtomic({
    tenantId: actor.tenantId,
    membershipId: actor.membershipId,
    id,
    revokedAt,
  });
  if (!device) throw new AppError("NOT_FOUND", "Simulator device not found");
  return device;
}

export async function ingestTelemetry(
  authorization: string | undefined,
  sample: TelemetryIngest,
): Promise<{
  current: FlightTelemetryCurrent;
  presence: PresenceState;
  oooiEvents: FlightOooiEvent[];
}> {
  const authenticated = await authenticateDevice(authorization);
  const flight = await findFlight(
    authenticated.device.tenantId,
    sample.flightId,
  );
  if (
    !flight ||
    flight.pilotMembershipId !== authenticated.device.membershipId
  ) {
    // Do not reveal whether another tenant/member owns the supplied flight ID.
    throw new AppError("NOT_FOUND", "Assigned flight not found");
  }
  if (!isTelemetryEligibleFlight(flight)) {
    throw new AppError(
      "CONFLICT",
      `Telemetry is not accepted for a ${flight.status} flight`,
    );
  }

  const receivedAt = new Date();
  if (
    Math.abs(receivedAt.getTime() - sample.simulatorTime.getTime()) >
    24 * 60 * 60 * 1_000
  ) {
    throw new AppError(
      "BAD_REQUEST",
      "Simulator time is outside the accepted 24-hour clock-skew window",
    );
  }
  const result = await telemetryRepo.ingestFlightTelemetryAtomic({
    tenantId: flight.tenantId,
    membershipId: authenticated.device.membershipId,
    deviceId: authenticated.device.id,
    flightId: flight.id,
    minimumIntervalMs: INGEST_MINIMUM_INTERVAL_MS,
    leaseMs: FLIGHT_WRITER_LEASE_MS,
    sample: { ...sample, sampleAt: receivedAt },
  });
  if (result.status === "lease_conflict") {
    throw new AppError(
      "CONFLICT",
      "Another simulator device holds the active writer lease for this flight",
    );
  }
  if (result.status === "credential_invalid") {
    throw new AppError(
      "UNAUTHORIZED",
      "Simulator credential is no longer valid",
    );
  }
  if (result.status === "ineligible") {
    throw new AppError(
      "CONFLICT",
      "The assigned flight or pilot is no longer eligible for telemetry",
    );
  }
  if (result.status === "replay_or_rate") {
    throw new AppError(
      "CONFLICT",
      "Telemetry sequence was replayed or samples arrived too quickly",
      { status: 429 },
    );
  }
  if (!result.current) {
    throw new AppError("INTERNAL", "Accepted telemetry state is unavailable");
  }
  return {
    current: result.current,
    presence: "online",
    oooiEvents: result.oooiEvent ? [result.oooiEvent] : [],
  };
}

export async function getFlightTelemetry(
  actor: TelemetryActor,
  flightId: string,
  trackLimit: number,
) {
  const flight = await requireAccessibleFlight(actor, flightId);
  const [current, track, oooiEvents] = await Promise.all([
    telemetryRepo.findCurrentFlightTelemetry(actor.tenantId, flight.id),
    telemetryRepo.listFlightTrack({
      tenantId: actor.tenantId,
      flightId: flight.id,
      limit: trackLimit,
    }),
    telemetryRepo.listOooiEvents(actor.tenantId, flight.id),
  ]);
  return {
    flight,
    current,
    track,
    oooiEvents,
    presence: presenceState(current?.sampleAt ?? null),
  };
}

export async function listLiveTelemetry(actor: TelemetryActor) {
  if (!roleAtLeast(actor.role, "dispatcher")) {
    throw new AppError("FORBIDDEN", "Dispatchers only");
  }
  const current = await telemetryRepo.listCurrentFlightTelemetry({
    tenantId: actor.tenantId,
  });
  return current.map((item) => ({
    ...item,
    presence: presenceState(item.sampleAt),
  }));
}

export async function correctOooi(
  actor: TelemetryActor,
  flightId: string,
  correction: OooiCorrection,
): Promise<{
  flight: Flight;
  oooiEvents: FlightOooiEvent[];
}> {
  if (!roleAtLeast(actor.role, "dispatcher")) {
    throw new AppError("FORBIDDEN", "Dispatchers only");
  }
  const flight = await requireAccessibleFlight(actor, flightId);
  if (flight.version !== correction.expectedVersion) {
    throw flightVersionConflict(flight);
  }
  const operationAt = new Date();
  const applied = await telemetryRepo.correctOooiAtomic({
    tenantId: actor.tenantId,
    flightId,
    actorMembershipId: actor.membershipId,
    expectedVersion: correction.expectedVersion,
    reason: correction.reason,
    outAt: correction.outAt,
    offAt: correction.offAt,
    onAt: correction.onAt,
    inAt: correction.inAt,
    operationAt,
  });
  if (!applied) {
    const latest = await findFlight(actor.tenantId, flightId);
    if (!latest) throw new AppError("NOT_FOUND", "Flight not found");
    if (latest.version !== correction.expectedVersion) {
      throw flightVersionConflict(latest);
    }
    throw new AppError(
      "UNPROCESSABLE",
      "OOOI timestamps must remain chronological",
    );
  }
  const [updated, events] = await Promise.all([
    findFlight(actor.tenantId, flightId),
    telemetryRepo.listOooiEvents(actor.tenantId, flightId),
  ]);
  if (!updated) throw new AppError("NOT_FOUND", "Flight not found");
  return { flight: updated, oooiEvents: events };
}

function flightVersionConflict(flight: Flight): AppError {
  return new AppError("CONFLICT", "Flight changed since it was loaded", {
    details: { latest: { id: flight.id, version: flight.version } },
  });
}

async function authenticateDevice(
  authorization: string | undefined,
): Promise<{ device: SimulatorDevice }> {
  const value = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  const match = value?.match(
    /^v1\.([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/i,
  );
  if (!match?.[1] || !match[2]) {
    throw new AppError("UNAUTHORIZED", "Invalid simulator device token");
  }
  const device = await telemetryRepo.findSimulatorDeviceById(match[1]);
  if (
    !device ||
    device.status !== "active" ||
    !verifyTokenMac(
      match[2],
      device.tokenMac,
      requireSecretsKey(),
      "simulator-device-token",
    )
  ) {
    throw new AppError("UNAUTHORIZED", "Invalid simulator device token");
  }
  return { device };
}

async function requireAccessibleFlight(
  actor: TelemetryActor,
  flightId: string,
): Promise<Flight> {
  const flight = await findFlight(actor.tenantId, flightId);
  if (!flight) throw new AppError("NOT_FOUND", "Flight not found");
  if (
    !roleAtLeast(actor.role, "dispatcher") &&
    flight.pilotMembershipId !== actor.membershipId
  ) {
    throw new AppError("NOT_FOUND", "Flight not found");
  }
  return flight;
}

function isTelemetryEligibleFlight(flight: Flight): boolean {
  return ["accepted", "briefed", "active"].includes(flight.status);
}

function requireSecretsKey(): string {
  const key = env().TENANT_SECRETS_KEY;
  if (!key) {
    throw new AppError(
      "INTERNAL",
      "Simulator device authentication is not configured",
      {
        status: 503,
      },
    );
  }
  return key;
}
