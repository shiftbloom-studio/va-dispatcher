import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";

import { getDb } from "../client.js";
import { guard, insertAudit, ms, runAtomic } from "../atomic.js";
import {
  flightOooiEvents,
  flightTelemetryCurrent,
  flightTelemetryLeases,
  flightTelemetryTrack,
  flights,
  memberships,
  simulatorDevices,
  type Flight,
  type FlightOooiEvent,
  type FlightTelemetryCurrent,
  type FlightTelemetryLease,
  type FlightTelemetryTrack,
  type SimulatorDevice,
  type TelemetryPhase,
} from "../schema.js";

const TRACK_RETENTION_MS = 24 * 60 * 60 * 1_000;
const TRACK_MAX_SAMPLES_PER_FLIGHT = 5_000;

export type TelemetrySample = {
  phase: TelemetryPhase;
  latitude: number;
  longitude: number;
  altitudeFeet: number;
  groundSpeedKnots: number;
  headingDegrees: number;
  simulatorTime: Date;
  sampleAt: Date;
  sequence: number;
};

/** Atomically creates the credential verifier and its issuance audit record. */
export async function createSimulatorDeviceAtomic(input: {
  id: string;
  tenantId: string;
  membershipId: string;
  name: string;
  tokenMac: string;
}): Promise<SimulatorDevice> {
  const db = getDb();
  const now = new Date();
  await runAtomic([
    db.insert(simulatorDevices).values({
      id: input.id,
      tenantId: input.tenantId,
      membershipId: input.membershipId,
      name: input.name,
      tokenMac: input.tokenMac,
      createdAt: now,
      updatedAt: now,
    }),
    insertAudit({
      tenantId: input.tenantId,
      actorMembershipId: input.membershipId,
      action: "telemetry.device_create",
      entityType: "simulator_device",
      entityId: input.id,
      meta: { name: input.name },
      createdAt: now,
    }),
  ]);
  const created = await findSimulatorDeviceById(input.id);
  if (!created)
    throw new Error("Atomic simulator-device creation returned no row");
  return created;
}

export async function findSimulatorDeviceById(
  id: string,
): Promise<SimulatorDevice | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(simulatorDevices)
    .where(eq(simulatorDevices.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function listSimulatorDevices(input: {
  tenantId: string;
  membershipId?: string;
}): Promise<SimulatorDevice[]> {
  const db = getDb();
  const conditions = [eq(simulatorDevices.tenantId, input.tenantId)];
  if (input.membershipId) {
    conditions.push(eq(simulatorDevices.membershipId, input.membershipId));
  }
  return db
    .select()
    .from(simulatorDevices)
    .where(and(...conditions))
    .orderBy(desc(simulatorDevices.createdAt), desc(simulatorDevices.id));
}

/** Atomically revokes the credential, releases pairings, and records audit. */
export async function revokeSimulatorDeviceAtomic(input: {
  tenantId: string;
  membershipId: string;
  id: string;
  revokedAt: Date;
}): Promise<SimulatorDevice | null> {
  const db = getDb();
  const owned = and(
    eq(simulatorDevices.id, input.id),
    eq(simulatorDevices.tenantId, input.tenantId),
    eq(simulatorDevices.membershipId, input.membershipId),
    eq(simulatorDevices.status, "active"),
  )!;
  const result = await runAtomic([
    guard(sql`EXISTS (SELECT 1 FROM ${simulatorDevices} WHERE ${owned})`),
    insertAudit({
      tenantId: input.tenantId,
      actorMembershipId: input.membershipId,
      action: "telemetry.device_revoke",
      entityType: "simulator_device",
      entityId: input.id,
      meta: sql`json_object('releasedPairings', (
        SELECT count(*)
        FROM flight_telemetry_leases lease
        WHERE lease.device_id = ${input.id}
          AND lease.tenant_id = ${input.tenantId}
      ))`,
      createdAt: input.revokedAt,
    }),
    db
      .delete(flightTelemetryLeases)
      .where(
        and(
          eq(flightTelemetryLeases.deviceId, input.id),
          eq(flightTelemetryLeases.tenantId, input.tenantId),
        ),
      ),
    db
      .update(simulatorDevices)
      .set({
        status: "revoked",
        tokenMac: "revoked",
        revokedAt: input.revokedAt,
        updatedAt: input.revokedAt,
      })
      .where(owned),
  ]);
  if (!result) return null;
  return findSimulatorDeviceById(input.id);
}

export async function findCurrentFlightTelemetry(
  tenantId: string,
  flightId: string,
): Promise<FlightTelemetryCurrent | null> {
  const db = getDb();
  const rows = await db
    .select({ current: flightTelemetryCurrent })
    .from(flightTelemetryCurrent)
    .innerJoin(
      flights,
      and(
        eq(flights.id, flightTelemetryCurrent.flightId),
        eq(flights.tenantId, flightTelemetryCurrent.tenantId),
        eq(flights.pilotMembershipId, flightTelemetryCurrent.membershipId),
        inArray(flights.status, ["accepted", "briefed", "active"]),
      ),
    )
    .innerJoin(
      memberships,
      and(
        eq(memberships.id, flightTelemetryCurrent.membershipId),
        eq(memberships.tenantId, flightTelemetryCurrent.tenantId),
        eq(memberships.role, "pilot"),
        eq(memberships.status, "active"),
      ),
    )
    .innerJoin(
      simulatorDevices,
      and(
        eq(simulatorDevices.id, flightTelemetryCurrent.deviceId),
        eq(simulatorDevices.tenantId, flightTelemetryCurrent.tenantId),
        eq(simulatorDevices.membershipId, flightTelemetryCurrent.membershipId),
        eq(simulatorDevices.status, "active"),
      ),
    )
    .where(
      and(
        eq(flightTelemetryCurrent.tenantId, tenantId),
        eq(flightTelemetryCurrent.flightId, flightId),
      ),
    )
    .limit(1);
  return rows[0]?.current ?? null;
}

export async function listCurrentFlightTelemetry(input: {
  tenantId: string;
  membershipId?: string;
}): Promise<FlightTelemetryCurrent[]> {
  const db = getDb();
  const conditions = [eq(flightTelemetryCurrent.tenantId, input.tenantId)];
  if (input.membershipId) {
    conditions.push(
      eq(flightTelemetryCurrent.membershipId, input.membershipId),
    );
  }
  const rows = await db
    .select({ current: flightTelemetryCurrent })
    .from(flightTelemetryCurrent)
    .innerJoin(
      flights,
      and(
        eq(flights.id, flightTelemetryCurrent.flightId),
        eq(flights.tenantId, flightTelemetryCurrent.tenantId),
        eq(flights.pilotMembershipId, flightTelemetryCurrent.membershipId),
        inArray(flights.status, ["accepted", "briefed", "active"]),
      ),
    )
    .innerJoin(
      memberships,
      and(
        eq(memberships.id, flightTelemetryCurrent.membershipId),
        eq(memberships.tenantId, flightTelemetryCurrent.tenantId),
        eq(memberships.role, "pilot"),
        eq(memberships.status, "active"),
      ),
    )
    .innerJoin(
      simulatorDevices,
      and(
        eq(simulatorDevices.id, flightTelemetryCurrent.deviceId),
        eq(simulatorDevices.tenantId, flightTelemetryCurrent.tenantId),
        eq(simulatorDevices.membershipId, flightTelemetryCurrent.membershipId),
        eq(simulatorDevices.status, "active"),
      ),
    )
    .where(and(...conditions))
    .orderBy(desc(flightTelemetryCurrent.sampleAt));
  return rows.map((row) => row.current);
}

export type AtomicTelemetryStatus =
  | "accepted"
  | "credential_invalid"
  | "ineligible"
  | "lease_conflict"
  | "replay_or_rate";

/**
 * Atomically claims the device sequence and single-writer flight lease, stores
 * current/track telemetry, applies one deterministic OOOI transition, and
 * records both provenance and audit. A rejected claim performs no telemetry or
 * OOOI writes.
 *
 * D1 has no row locks, so the decision is made from one consistent read and
 * then committed by a batch whose guards re-assert every value the decision
 * depended on. A concurrent writer makes a guard fail; the ingest is then
 * re-evaluated against the new state.
 */
export async function ingestFlightTelemetryAtomic(input: {
  tenantId: string;
  membershipId: string;
  deviceId: string;
  flightId: string;
  minimumIntervalMs: number;
  leaseMs: number;
  sample: TelemetrySample;
}): Promise<{
  status: AtomicTelemetryStatus;
  current: FlightTelemetryCurrent | null;
  oooiEvent: FlightOooiEvent | null;
}> {
  for (let attempt = 0; attempt < INGEST_ATTEMPTS; attempt += 1) {
    const outcome = await tryIngestFlightTelemetry(input);
    if (outcome) return outcome;
  }
  throw new Error("Telemetry ingest lost every optimistic-concurrency attempt");
}

const INGEST_ATTEMPTS = 3;

type IngestState = {
  device: SimulatorDevice;
  flight: Flight;
  member: { role: string; status: string };
  deviceLeases: FlightTelemetryLease[];
  flightLease: FlightTelemetryLease | null;
  previousPhase: TelemetryPhase | null;
};

async function readIngestState(input: {
  tenantId: string;
  membershipId: string;
  deviceId: string;
  flightId: string;
}): Promise<IngestState | null> {
  const db = getDb();
  // Joined selections run outside `db.batch`: batched D1 results are keyed by
  // column name, so same-named columns of joined tables would collide. The
  // write batch re-asserts everything read here, so separate reads are safe.
  const [assigned, [deviceLeases, flightLeases, previous]] = await Promise.all([
    db
      .select({
        device: simulatorDevices,
        flight: flights,
        memberRole: memberships.role,
        memberStatus: memberships.status,
      })
      .from(simulatorDevices)
      .innerJoin(
        flights,
        and(
          eq(flights.id, input.flightId),
          eq(flights.tenantId, simulatorDevices.tenantId),
          eq(flights.pilotMembershipId, simulatorDevices.membershipId),
        ),
      )
      .innerJoin(
        memberships,
        and(
          eq(memberships.id, simulatorDevices.membershipId),
          eq(memberships.tenantId, simulatorDevices.tenantId),
        ),
      )
      .where(
        and(
          eq(simulatorDevices.id, input.deviceId),
          eq(simulatorDevices.tenantId, input.tenantId),
          eq(simulatorDevices.membershipId, input.membershipId),
          eq(simulatorDevices.status, "active"),
        ),
      )
      .limit(1),
    db.batch([
      db
        .select()
        .from(flightTelemetryLeases)
        .where(eq(flightTelemetryLeases.deviceId, input.deviceId)),
      db
        .select()
        .from(flightTelemetryLeases)
        .where(eq(flightTelemetryLeases.flightId, input.flightId))
        .limit(1),
      db
        .select({ phase: flightTelemetryCurrent.phase })
        .from(flightTelemetryCurrent)
        .where(
          and(
            eq(flightTelemetryCurrent.flightId, input.flightId),
            eq(flightTelemetryCurrent.tenantId, input.tenantId),
          ),
        )
        .limit(1),
    ]),
  ]);
  const row = assigned[0];
  if (!row) return null;
  return {
    device: row.device,
    flight: row.flight,
    member: { role: row.memberRole, status: row.memberStatus },
    deviceLeases,
    flightLease: flightLeases[0] ?? null,
    previousPhase: previous[0]?.phase ?? null,
  };
}

function detectOooiTransition(
  previous: TelemetryPhase | null,
  next: TelemetryPhase,
  flight: Flight,
  sampleAt: Date,
): "out" | "off" | "on" | "in" | null {
  const at = sampleAt.getTime();
  const notAfter = (value: Date | null) =>
    value === null || at <= value.getTime();
  const notBefore = (value: Date | null) =>
    value === null || value.getTime() <= at;
  if (
    previous === "preflight" &&
    next === "taxi_out" &&
    flight.outAt === null &&
    !flight.outManualOverride &&
    notAfter(flight.offAt) &&
    notAfter(flight.onAt) &&
    notAfter(flight.inAt)
  ) {
    return "out";
  }
  if (
    (previous === "preflight" || previous === "taxi_out") &&
    next === "airborne" &&
    flight.offAt === null &&
    !flight.offManualOverride &&
    notBefore(flight.outAt) &&
    notAfter(flight.onAt) &&
    notAfter(flight.inAt)
  ) {
    return "off";
  }
  if (
    previous === "airborne" &&
    next === "taxi_in" &&
    flight.onAt === null &&
    !flight.onManualOverride &&
    notBefore(flight.outAt) &&
    notBefore(flight.offAt) &&
    notAfter(flight.inAt)
  ) {
    return "on";
  }
  if (
    previous === "taxi_in" &&
    next === "parked" &&
    flight.inAt === null &&
    !flight.inManualOverride &&
    notBefore(flight.outAt) &&
    notBefore(flight.offAt) &&
    notBefore(flight.onAt)
  ) {
    return "in";
  }
  return null;
}

const OOOI_COLUMN = {
  out: "out_at",
  off: "off_at",
  on: "on_at",
  in: "in_at",
} as const;

async function tryIngestFlightTelemetry(input: {
  tenantId: string;
  membershipId: string;
  deviceId: string;
  flightId: string;
  minimumIntervalMs: number;
  leaseMs: number;
  sample: TelemetrySample;
}): Promise<{
  status: AtomicTelemetryStatus;
  current: FlightTelemetryCurrent | null;
  oooiEvent: FlightOooiEvent | null;
} | null> {
  const db = getDb();
  const rejected = (status: AtomicTelemetryStatus) => ({
    status,
    current: null,
    oooiEvent: null,
  });
  const state = await readIngestState(input);
  if (!state) return rejected("credential_invalid");

  const { device, flight, sample } = { ...state, sample: input.sample };
  const sampleAt = sample.sampleAt;
  if (
    !["accepted", "briefed", "active"].includes(flight.status) ||
    state.member.role !== "pilot" ||
    state.member.status !== "active"
  ) {
    return rejected("ineligible");
  }
  const rateCutoff = sampleAt.getTime() - input.minimumIntervalMs;
  if (
    (device.lastSequence !== null && device.lastSequence >= sample.sequence) ||
    (device.lastIngestAt !== null && device.lastIngestAt.getTime() > rateCutoff)
  ) {
    return rejected("replay_or_rate");
  }
  const otherLeases = state.deviceLeases.filter(
    (lease) => lease.flightId !== input.flightId,
  );
  if (
    otherLeases.some(
      (lease) => lease.leaseExpiresAt.getTime() > sampleAt.getTime(),
    )
  ) {
    return rejected("lease_conflict");
  }
  const flightLease = state.flightLease;
  if (
    flightLease &&
    flightLease.deviceId !== input.deviceId &&
    flightLease.leaseExpiresAt.getTime() > sampleAt.getTime()
  ) {
    return rejected("lease_conflict");
  }

  const leaseExpiresAt = new Date(sampleAt.getTime() + input.leaseMs);
  const trackCutoff = new Date(sampleAt.getTime() - TRACK_RETENTION_MS);
  const transition = detectOooiTransition(
    state.previousPhase,
    sample.phase,
    flight,
    sampleAt,
  );
  const eventId = transition ? crypto.randomUUID() : null;

  const statements = [
    // Re-assert every value the decision above was based on.
    guard(sql`EXISTS (
      SELECT 1
      FROM simulator_devices sd
      WHERE sd.id = ${device.id}
        AND sd.status = 'active'
        AND sd.last_sequence IS ${device.lastSequence}
        AND sd.last_ingest_at IS ${device.lastIngestAt ? ms(device.lastIngestAt) : null}
    )`),
    guard(sql`EXISTS (
      SELECT 1
      FROM flights f
      JOIN memberships member
        ON member.id = f.pilot_membership_id
       AND member.tenant_id = f.tenant_id
      WHERE f.id = ${flight.id}
        AND f.tenant_id = ${input.tenantId}
        AND f.version = ${flight.version}
        AND f.pilot_membership_id = ${input.membershipId}
        AND f.status IN ('accepted', 'briefed', 'active')
        AND member.role = 'pilot'
        AND member.status = 'active'
    )`),
    guard(
      flightLease
        ? sql`EXISTS (
            SELECT 1 FROM flight_telemetry_leases lease
            WHERE lease.flight_id = ${input.flightId}
              AND lease.device_id = ${flightLease.deviceId}
              AND lease.lease_expires_at = ${ms(flightLease.leaseExpiresAt)}
          )`
        : sql`NOT EXISTS (
            SELECT 1 FROM flight_telemetry_leases lease
            WHERE lease.flight_id = ${input.flightId}
          )`,
    ),
    guard(sql`NOT EXISTS (
      SELECT 1 FROM flight_telemetry_leases active
      WHERE active.device_id = ${input.deviceId}
        AND active.flight_id <> ${input.flightId}
        AND active.lease_expires_at > ${ms(sampleAt)}
    )`),
    guard(sql`(
      SELECT current.phase FROM flight_telemetry_current current
      WHERE current.flight_id = ${input.flightId}
        AND current.tenant_id = ${input.tenantId}
    ) IS ${state.previousPhase}`),
    // Release this device's expired pairing with another flight.
    sql`
      DELETE FROM flight_telemetry_leases
      WHERE device_id = ${input.deviceId}
        AND flight_id <> ${input.flightId}
        AND lease_expires_at <= ${ms(sampleAt)}
    `,
    sql`
      INSERT INTO flight_telemetry_leases (
        flight_id, tenant_id, membership_id, device_id, lease_expires_at,
        created_at, updated_at
      )
      VALUES (
        ${input.flightId}, ${input.tenantId}, ${input.membershipId},
        ${input.deviceId}, ${ms(leaseExpiresAt)}, ${ms(sampleAt)},
        ${ms(sampleAt)}
      )
      ON CONFLICT (flight_id) DO UPDATE
      SET tenant_id = excluded.tenant_id,
          membership_id = excluded.membership_id,
          device_id = excluded.device_id,
          lease_expires_at = excluded.lease_expires_at,
          updated_at = excluded.updated_at
    `,
    db
      .update(simulatorDevices)
      .set({
        lastSequence: sample.sequence,
        lastIngestAt: sampleAt,
        lastSeenAt: sampleAt,
        updatedAt: sampleAt,
      })
      .where(eq(simulatorDevices.id, input.deviceId)),
    ...(transition && eventId
      ? [
          sql`
            UPDATE flights
            SET ${sql.raw(OOOI_COLUMN[transition])} = ${ms(sampleAt)},
                version = version + 1,
                updated_at = max(updated_at, ${ms(sampleAt)})
            WHERE id = ${input.flightId}
              AND tenant_id = ${input.tenantId}
          `,
          db.insert(flightOooiEvents).values({
            id: eventId,
            tenantId: input.tenantId,
            flightId: input.flightId,
            eventType: transition,
            occurredAt: sampleAt,
            source: "telemetry",
            deviceId: input.deviceId,
            createdAt: sampleAt,
          }),
          insertAudit({
            tenantId: input.tenantId,
            actorMembershipId: null,
            action: "flight.oooi_automatic",
            entityType: "flight",
            entityId: input.flightId,
            meta: {
              eventType: transition,
              deviceId: input.deviceId,
              source: "telemetry",
              fromVersion: flight.version,
              toVersion: flight.version + 1,
            },
            createdAt: sampleAt,
          }),
        ]
      : []),
    sql`
      INSERT INTO flight_telemetry_current (
        flight_id, tenant_id, membership_id, device_id, phase, latitude,
        longitude, altitude_feet, ground_speed_knots, heading_degrees,
        simulator_time, sample_at, sequence, created_at, updated_at
      )
      VALUES (
        ${input.flightId}, ${input.tenantId}, ${input.membershipId},
        ${input.deviceId}, ${sample.phase}, ${sample.latitude},
        ${sample.longitude}, ${sample.altitudeFeet}, ${sample.groundSpeedKnots},
        ${sample.headingDegrees}, ${ms(sample.simulatorTime)},
        ${ms(sampleAt)}, ${sample.sequence}, ${ms(sampleAt)}, ${ms(sampleAt)}
      )
      ON CONFLICT (flight_id) DO UPDATE
      SET tenant_id = excluded.tenant_id,
          membership_id = excluded.membership_id,
          device_id = excluded.device_id,
          phase = excluded.phase,
          latitude = excluded.latitude,
          longitude = excluded.longitude,
          altitude_feet = excluded.altitude_feet,
          ground_speed_knots = excluded.ground_speed_knots,
          heading_degrees = excluded.heading_degrees,
          simulator_time = excluded.simulator_time,
          sample_at = excluded.sample_at,
          sequence = excluded.sequence,
          updated_at = excluded.updated_at
    `,
    db.insert(flightTelemetryTrack).values({
      tenantId: input.tenantId,
      flightId: input.flightId,
      membershipId: input.membershipId,
      deviceId: input.deviceId,
      phase: sample.phase,
      latitude: sample.latitude,
      longitude: sample.longitude,
      altitudeFeet: sample.altitudeFeet,
      groundSpeedKnots: sample.groundSpeedKnots,
      headingDegrees: sample.headingDegrees,
      simulatorTime: sample.simulatorTime,
      sampleAt,
      sequence: sample.sequence,
      createdAt: sampleAt,
    }),
    sql`
      DELETE FROM flight_telemetry_track
      WHERE tenant_id = ${input.tenantId}
        AND flight_id = ${input.flightId}
        AND (
          sample_at < ${ms(trackCutoff)}
          OR id IN (
            SELECT id
            FROM flight_telemetry_track
            WHERE tenant_id = ${input.tenantId}
              AND flight_id = ${input.flightId}
              AND sample_at >= ${ms(trackCutoff)}
            ORDER BY sample_at DESC, id DESC
            LIMIT -1 OFFSET ${TRACK_MAX_SAMPLES_PER_FLIGHT}
          )
        )
    `,
  ];
  const result = await runAtomic(statements);
  if (!result) return null;

  const [currentRows, eventRows] = await db.batch([
    db
      .select()
      .from(flightTelemetryCurrent)
      .where(eq(flightTelemetryCurrent.flightId, input.flightId))
      .limit(1),
    db
      .select()
      .from(flightOooiEvents)
      .where(eq(flightOooiEvents.id, eventId ?? ""))
      .limit(1),
  ]);
  const current = currentRows[0] ?? null;
  if (!current) {
    throw new Error("Atomic telemetry ingest omitted its accepted sample");
  }
  return { status: "accepted", current, oooiEvent: eventRows[0] ?? null };
}

export async function listFlightTrack(input: {
  tenantId: string;
  flightId: string;
  limit: number;
  now?: Date;
}): Promise<FlightTelemetryTrack[]> {
  const db = getDb();
  const retentionCutoff = new Date(
    (input.now ?? new Date()).getTime() - TRACK_RETENTION_MS,
  );
  return db
    .select()
    .from(flightTelemetryTrack)
    .where(
      and(
        eq(flightTelemetryTrack.tenantId, input.tenantId),
        eq(flightTelemetryTrack.flightId, input.flightId),
        gte(flightTelemetryTrack.sampleAt, retentionCutoff),
      ),
    )
    .orderBy(desc(flightTelemetryTrack.sampleAt), desc(flightTelemetryTrack.id))
    .limit(input.limit);
}

/** Atomically updates OOOI values, provenance rows, and the audit record. */
export async function correctOooiAtomic(input: {
  tenantId: string;
  flightId: string;
  actorMembershipId: string;
  expectedVersion: number;
  reason: string;
  outAt?: Date | null;
  offAt?: Date | null;
  onAt?: Date | null;
  inAt?: Date | null;
  operationAt: Date;
}): Promise<boolean> {
  const db = getDb();
  const [flight] = await db
    .select()
    .from(flights)
    .where(
      and(
        eq(flights.id, input.flightId),
        eq(flights.tenantId, input.tenantId),
        eq(flights.version, input.expectedVersion),
      ),
    )
    .limit(1);
  if (!flight) return false;

  const provided = {
    out: input.outAt !== undefined,
    off: input.offAt !== undefined,
    on: input.onAt !== undefined,
    in: input.inAt !== undefined,
  };
  const next = {
    out: provided.out ? (input.outAt ?? null) : flight.outAt,
    off: provided.off ? (input.offAt ?? null) : flight.offAt,
    on: provided.on ? (input.onAt ?? null) : flight.onAt,
    in: provided.in ? (input.inAt ?? null) : flight.inAt,
  };
  const ordered = [next.out, next.off, next.on, next.in];
  for (let earlier = 0; earlier < ordered.length; earlier += 1) {
    for (let later = earlier + 1; later < ordered.length; later += 1) {
      const a = ordered[earlier];
      const b = ordered[later];
      if (a && b && a.getTime() > b.getTime()) return false;
    }
  }

  const at = and(
    eq(flights.id, input.flightId),
    eq(flights.tenantId, input.tenantId),
    eq(flights.version, input.expectedVersion),
  )!;
  const kinds = (["out", "off", "on", "in"] as const).filter(
    (kind) => provided[kind],
  );
  const result = await runAtomic([
    guard(sql`EXISTS (SELECT 1 FROM ${flights} WHERE ${at})`),
    db
      .update(flights)
      .set({
        outAt: next.out,
        offAt: next.off,
        onAt: next.on,
        inAt: next.in,
        ...(provided.out ? { outManualOverride: true } : {}),
        ...(provided.off ? { offManualOverride: true } : {}),
        ...(provided.on ? { onManualOverride: true } : {}),
        ...(provided.in ? { inManualOverride: true } : {}),
        version: sql`${flights.version} + 1`,
        updatedAt: sql`max(${flights.updatedAt}, ${ms(input.operationAt)})`,
      })
      .where(at),
    ...kinds.map((kind) =>
      db.insert(flightOooiEvents).values({
        tenantId: input.tenantId,
        flightId: input.flightId,
        eventType: kind,
        occurredAt: next[kind],
        source: "manual",
        actorMembershipId: input.actorMembershipId,
        reason: input.reason,
        createdAt: input.operationAt,
      }),
    ),
    insertAudit({
      tenantId: input.tenantId,
      actorMembershipId: input.actorMembershipId,
      action: "flight.oooi_correct",
      entityType: "flight",
      entityId: input.flightId,
      meta: {
        fields: kinds.map((kind) => `${kind}At`),
        reason: input.reason,
        fromVersion: input.expectedVersion,
        toVersion: input.expectedVersion + 1,
      },
      createdAt: input.operationAt,
    }),
  ]);
  return result !== null;
}

export async function listOooiEvents(
  tenantId: string,
  flightId: string,
): Promise<FlightOooiEvent[]> {
  const db = getDb();
  return db
    .select()
    .from(flightOooiEvents)
    .where(
      and(
        eq(flightOooiEvents.tenantId, tenantId),
        eq(flightOooiEvents.flightId, flightId),
      ),
    )
    .orderBy(desc(flightOooiEvents.createdAt), desc(flightOooiEvents.id));
}
