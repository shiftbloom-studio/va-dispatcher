import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";

import { getDb } from "../client.js";
import {
  flightOooiEvents,
  flightTelemetryCurrent,
  flightTelemetryTrack,
  flights,
  memberships,
  simulatorDevices,
  type FlightOooiEvent,
  type FlightTelemetryCurrent,
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

type AtomicSimulatorDeviceRow = {
  id: string;
  tenant_id: string;
  membership_id: string;
  name: string;
  token_mac: string;
  status: "active" | "revoked";
  last_sequence: number | null;
  last_ingest_at: Date | string | null;
  last_seen_at: Date | string | null;
  revoked_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
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
  const result = await db.execute<AtomicSimulatorDeviceRow>(sql`
    WITH created AS (
      INSERT INTO simulator_devices (
        id, tenant_id, membership_id, name, token_mac
      ) VALUES (
        ${input.id}::uuid, ${input.tenantId}::uuid,
        ${input.membershipId}::uuid, ${input.name}, ${input.tokenMac}
      )
      RETURNING *
    ),
    inserted_audit AS (
      INSERT INTO audit_events (
        tenant_id, actor_membership_id, action, entity_type, entity_id, meta
      )
      SELECT created.tenant_id, created.membership_id,
             'telemetry.device_create', 'simulator_device', created.id::text,
             jsonb_build_object('name', created.name)
      FROM created
      RETURNING id
    )
    SELECT created.*
    FROM created
    JOIN inserted_audit ON TRUE
  `);
  const row = result.rows[0];
  if (!row) throw new Error("Atomic simulator-device creation returned no row");
  return simulatorDeviceFromRow(row);
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
  const revokedAt = input.revokedAt.toISOString();
  const result = await db.execute<AtomicSimulatorDeviceRow>(sql`
    WITH revoked AS (
      UPDATE simulator_devices
      SET status = 'revoked', token_mac = 'revoked', revoked_at = ${revokedAt},
          updated_at = ${revokedAt}
      WHERE id = ${input.id}::uuid
        AND tenant_id = ${input.tenantId}::uuid
        AND membership_id = ${input.membershipId}::uuid
        AND status = 'active'
      RETURNING *
    ),
    released_pairings AS (
      DELETE FROM flight_telemetry_leases lease
      USING revoked
      WHERE lease.device_id = revoked.id
        AND lease.tenant_id = revoked.tenant_id
      RETURNING lease.flight_id
    ),
    inserted_audit AS (
      INSERT INTO audit_events (
        tenant_id, actor_membership_id, action, entity_type, entity_id,
        meta, created_at
      )
      SELECT revoked.tenant_id, revoked.membership_id,
             'telemetry.device_revoke', 'simulator_device', revoked.id::text,
             jsonb_build_object(
               'releasedPairings',
               (SELECT COUNT(*) FROM released_pairings)
             ),
             ${revokedAt}
      FROM revoked
      RETURNING id
    )
    SELECT revoked.*
    FROM revoked
    JOIN inserted_audit ON TRUE
  `);
  const row = result.rows[0];
  if (!row) return null;
  return simulatorDeviceFromRow(row);
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

type AtomicTelemetryRow = {
  status: AtomicTelemetryStatus;
  event_id: string | null;
  event_type: "out" | "off" | "on" | "in" | null;
  event_occurred_at: Date | string | null;
  event_created_at: Date | string | null;
  current_flight_id: string | null;
  current_tenant_id: string | null;
  current_membership_id: string | null;
  current_device_id: string | null;
  current_phase: TelemetryPhase | null;
  current_latitude: number | null;
  current_longitude: number | null;
  current_altitude_feet: number | null;
  current_ground_speed_knots: number | null;
  current_heading_degrees: number | null;
  current_simulator_time: Date | string | null;
  current_sample_at: Date | string | null;
  current_sequence: number | null;
  current_created_at: Date | string | null;
  current_updated_at: Date | string | null;
};

/**
 * Atomically claims the device sequence and single-writer flight lease, stores
 * current/track telemetry, applies one deterministic OOOI transition, and
 * records both provenance and audit. A rejected claim performs no telemetry or
 * OOOI writes.
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
  const db = getDb();
  const sampleAt = input.sample.sampleAt.toISOString();
  const simulatorTime = input.sample.simulatorTime.toISOString();
  const rateCutoff = new Date(
    input.sample.sampleAt.getTime() - input.minimumIntervalMs,
  ).toISOString();
  const leaseExpiresAt = new Date(
    input.sample.sampleAt.getTime() + input.leaseMs,
  ).toISOString();
  const trackCutoff = new Date(
    input.sample.sampleAt.getTime() - TRACK_RETENTION_MS,
  ).toISOString();

  const result = await db.execute<AtomicTelemetryRow>(sql`
    WITH assigned_device AS MATERIALIZED (
      SELECT sd.id, sd.tenant_id, sd.membership_id,
             sd.last_sequence, sd.last_ingest_at,
             f.status AS flight_status,
             member.role AS membership_role,
             member.status AS membership_status
      FROM simulator_devices sd
      JOIN flights f
        ON f.id = ${input.flightId}::uuid
       AND f.tenant_id = sd.tenant_id
       AND f.pilot_membership_id = sd.membership_id
      JOIN memberships member
        ON member.id = sd.membership_id
       AND member.tenant_id = sd.tenant_id
      WHERE sd.id = ${input.deviceId}::uuid
        AND sd.tenant_id = ${input.tenantId}::uuid
        AND sd.membership_id = ${input.membershipId}::uuid
        AND sd.status = 'active'
      FOR UPDATE OF sd, f, member
    ),
    eligible_device AS MATERIALIZED (
      SELECT id, tenant_id, membership_id
      FROM assigned_device
      WHERE flight_status IN ('accepted', 'briefed', 'active')
        AND membership_role = 'pilot'
        AND membership_status = 'active'
        AND (last_sequence IS NULL OR last_sequence < ${input.sample.sequence})
        AND (last_ingest_at IS NULL OR last_ingest_at <= ${rateCutoff})
    ),
    released_expired_pairing AS (
      DELETE FROM flight_telemetry_leases lease
      USING eligible_device eligible
      WHERE lease.device_id = eligible.id
        AND lease.flight_id <> ${input.flightId}::uuid
        AND lease.lease_expires_at <= ${sampleAt}
      RETURNING lease.device_id
    ),
    pairable_device AS MATERIALIZED (
      SELECT eligible.*
      FROM eligible_device eligible
      CROSS JOIN (
        SELECT COUNT(*) AS released FROM released_expired_pairing
      ) release_barrier
      WHERE NOT EXISTS (
        SELECT 1
        FROM flight_telemetry_leases active
        WHERE active.device_id = eligible.id
          AND active.flight_id <> ${input.flightId}::uuid
          AND active.lease_expires_at > ${sampleAt}
      )
    ),
    renewed_lease AS (
      UPDATE flight_telemetry_leases lease
      SET tenant_id = pairable.tenant_id,
          membership_id = pairable.membership_id,
          device_id = pairable.id,
          lease_expires_at = ${leaseExpiresAt},
          updated_at = ${sampleAt}
      FROM pairable_device pairable
      WHERE lease.flight_id = ${input.flightId}::uuid
        AND (
          lease.device_id = pairable.id
          OR lease.lease_expires_at <= ${sampleAt}
        )
      RETURNING lease.flight_id, lease.tenant_id, lease.membership_id,
                lease.device_id, lease.lease_expires_at
    ),
    inserted_lease AS (
      INSERT INTO flight_telemetry_leases (
        flight_id, tenant_id, membership_id, device_id, lease_expires_at,
        created_at, updated_at
      )
      SELECT ${input.flightId}::uuid, tenant_id, membership_id, id,
             ${leaseExpiresAt}, ${sampleAt}, ${sampleAt}
      FROM pairable_device
      WHERE NOT EXISTS (SELECT 1 FROM renewed_lease)
      ON CONFLICT DO NOTHING
      RETURNING flight_id, tenant_id, membership_id, device_id, lease_expires_at
    ),
    acquired_lease AS MATERIALIZED (
      SELECT * FROM renewed_lease
      UNION ALL
      SELECT * FROM inserted_lease
    ),
    owned_lease AS MATERIALIZED (
      SELECT * FROM acquired_lease
      WHERE device_id = ${input.deviceId}::uuid
    ),
    claimed_device AS (
      UPDATE simulator_devices sd
      SET last_sequence = ${input.sample.sequence},
          last_ingest_at = ${sampleAt},
          last_seen_at = ${sampleAt},
          updated_at = ${sampleAt}
      FROM eligible_device eligible
      JOIN owned_lease lease ON lease.device_id = eligible.id
      WHERE sd.id = eligible.id
      RETURNING sd.id, sd.tenant_id, sd.membership_id
    ),
    accepted_lease AS MATERIALIZED (
      SELECT lease.*
      FROM owned_lease lease
      JOIN claimed_device claimed ON claimed.id = lease.device_id
    ),
    locked_flight AS MATERIALIZED (
      SELECT f.*
      FROM flights f
      JOIN accepted_lease lease
        ON lease.flight_id = f.id
       AND lease.tenant_id = f.tenant_id
      FOR UPDATE OF f
    ),
    previous AS MATERIALIZED (
      SELECT current.phase
      FROM flight_telemetry_current current
      JOIN accepted_lease lease ON lease.flight_id = current.flight_id
      WHERE current.tenant_id = ${input.tenantId}::uuid
    ),
    detected_transition AS MATERIALIZED (
      SELECT CASE
        WHEN previous.phase = 'preflight'
         AND ${input.sample.phase}::telemetry_phase = 'taxi_out'
         AND f.out_at IS NULL
         AND NOT f.out_manual_override
         AND (f.off_at IS NULL OR ${sampleAt}::timestamptz <= f.off_at)
         AND (f.on_at IS NULL OR ${sampleAt}::timestamptz <= f.on_at)
         AND (f.in_at IS NULL OR ${sampleAt}::timestamptz <= f.in_at)
         THEN 'out'::oooi_event_type
        WHEN previous.phase IN ('preflight', 'taxi_out')
         AND ${input.sample.phase}::telemetry_phase = 'airborne'
         AND f.off_at IS NULL
         AND NOT f.off_manual_override
         AND (f.out_at IS NULL OR f.out_at <= ${sampleAt}::timestamptz)
         AND (f.on_at IS NULL OR ${sampleAt}::timestamptz <= f.on_at)
         AND (f.in_at IS NULL OR ${sampleAt}::timestamptz <= f.in_at)
         THEN 'off'::oooi_event_type
        WHEN previous.phase = 'airborne'
         AND ${input.sample.phase}::telemetry_phase = 'taxi_in'
         AND f.on_at IS NULL
         AND NOT f.on_manual_override
         AND (f.out_at IS NULL OR f.out_at <= ${sampleAt}::timestamptz)
         AND (f.off_at IS NULL OR f.off_at <= ${sampleAt}::timestamptz)
         AND (f.in_at IS NULL OR ${sampleAt}::timestamptz <= f.in_at)
         THEN 'on'::oooi_event_type
        WHEN previous.phase = 'taxi_in'
         AND ${input.sample.phase}::telemetry_phase = 'parked'
         AND f.in_at IS NULL
         AND NOT f.in_manual_override
         AND (f.out_at IS NULL OR f.out_at <= ${sampleAt}::timestamptz)
         AND (f.off_at IS NULL OR f.off_at <= ${sampleAt}::timestamptz)
         AND (f.on_at IS NULL OR f.on_at <= ${sampleAt}::timestamptz)
         THEN 'in'::oooi_event_type
        ELSE NULL
      END AS event_type,
      f.version AS from_version
      FROM accepted_lease lease
      JOIN locked_flight f ON f.id = lease.flight_id
      LEFT JOIN previous ON TRUE
    ),
    updated_flight AS (
      UPDATE flights f
      SET out_at = CASE WHEN transition.event_type = 'out'
                        THEN ${sampleAt} ELSE f.out_at END,
          off_at = CASE WHEN transition.event_type = 'off'
                        THEN ${sampleAt} ELSE f.off_at END,
          on_at = CASE WHEN transition.event_type = 'on'
                       THEN ${sampleAt} ELSE f.on_at END,
          in_at = CASE WHEN transition.event_type = 'in'
                       THEN ${sampleAt} ELSE f.in_at END,
          version = f.version + 1,
          updated_at = GREATEST(f.updated_at, ${sampleAt}::timestamptz)
      FROM detected_transition transition
      WHERE f.id = ${input.flightId}::uuid
        AND f.tenant_id = ${input.tenantId}::uuid
        AND transition.event_type IS NOT NULL
      RETURNING f.id, transition.from_version, f.version AS to_version
    ),
    inserted_event AS (
      INSERT INTO flight_oooi_events (
        tenant_id, flight_id, event_type, occurred_at, source, device_id,
        created_at
      )
      SELECT ${input.tenantId}::uuid, updated.id,
             transition.event_type, ${sampleAt}, 'telemetry',
             ${input.deviceId}::uuid, ${sampleAt}
      FROM detected_transition transition
      JOIN updated_flight updated ON TRUE
      WHERE transition.event_type IS NOT NULL
      RETURNING id, event_type, occurred_at, created_at
    ),
    inserted_audit AS (
      INSERT INTO audit_events (
        tenant_id, actor_membership_id, action, entity_type, entity_id, meta,
        created_at
      )
      SELECT ${input.tenantId}::uuid, NULL, 'flight.oooi_automatic',
             'flight', ${input.flightId},
             jsonb_build_object(
               'eventType', event_type,
               'deviceId', ${input.deviceId}::text,
               'source', 'telemetry',
               'fromVersion', updated.from_version,
               'toVersion', updated.to_version
             ),
             ${sampleAt}
      FROM inserted_event
      JOIN updated_flight updated ON TRUE
      RETURNING id
    ),
    current_upsert AS (
      INSERT INTO flight_telemetry_current (
        flight_id, tenant_id, membership_id, device_id, phase, latitude,
        longitude, altitude_feet, ground_speed_knots, heading_degrees,
        simulator_time, sample_at, sequence, created_at, updated_at
      )
      SELECT flight_id, tenant_id, membership_id, device_id,
             ${input.sample.phase}::telemetry_phase, ${input.sample.latitude},
             ${input.sample.longitude}, ${input.sample.altitudeFeet},
             ${input.sample.groundSpeedKnots}, ${input.sample.headingDegrees},
             ${simulatorTime}, ${sampleAt},
             ${input.sample.sequence}, ${sampleAt},
             ${sampleAt}
      FROM accepted_lease
      ON CONFLICT (flight_id) DO UPDATE
      SET tenant_id = EXCLUDED.tenant_id,
          membership_id = EXCLUDED.membership_id,
          device_id = EXCLUDED.device_id,
          phase = EXCLUDED.phase,
          latitude = EXCLUDED.latitude,
          longitude = EXCLUDED.longitude,
          altitude_feet = EXCLUDED.altitude_feet,
          ground_speed_knots = EXCLUDED.ground_speed_knots,
          heading_degrees = EXCLUDED.heading_degrees,
          simulator_time = EXCLUDED.simulator_time,
          sample_at = EXCLUDED.sample_at,
          sequence = EXCLUDED.sequence,
          updated_at = EXCLUDED.updated_at
      RETURNING *
    ),
    track_insert AS (
      INSERT INTO flight_telemetry_track (
        tenant_id, flight_id, membership_id, device_id, phase, latitude,
        longitude, altitude_feet, ground_speed_knots, heading_degrees,
        simulator_time, sample_at, sequence, created_at
      )
      SELECT tenant_id, flight_id, membership_id, device_id,
             ${input.sample.phase}::telemetry_phase, ${input.sample.latitude},
             ${input.sample.longitude}, ${input.sample.altitudeFeet},
             ${input.sample.groundSpeedKnots}, ${input.sample.headingDegrees},
             ${simulatorTime}, ${sampleAt},
             ${input.sample.sequence}, ${sampleAt}
      FROM accepted_lease
      RETURNING id
    ),
    pruned_track_delete AS (
      DELETE FROM flight_telemetry_track
      WHERE tenant_id = ${input.tenantId}::uuid
        AND flight_id = ${input.flightId}::uuid
        AND EXISTS (SELECT 1 FROM accepted_lease)
        AND (
          sample_at < ${trackCutoff}
          OR id IN (
            SELECT id
            FROM flight_telemetry_track
            WHERE tenant_id = ${input.tenantId}::uuid
              AND flight_id = ${input.flightId}::uuid
              AND sample_at >= ${trackCutoff}
            ORDER BY sample_at DESC, id DESC
            OFFSET ${TRACK_MAX_SAMPLES_PER_FLIGHT - 1}
          )
        )
      RETURNING id
    )
    SELECT
      CASE
        WHEN EXISTS (SELECT 1 FROM current_upsert) THEN 'accepted'
        WHEN EXISTS (SELECT 1 FROM eligible_device) THEN 'lease_conflict'
        WHEN EXISTS (
          SELECT 1 FROM assigned_device
          WHERE flight_status NOT IN ('accepted', 'briefed', 'active')
             OR membership_role <> 'pilot'
             OR membership_status <> 'active'
        ) THEN 'ineligible'
        WHEN EXISTS (SELECT 1 FROM assigned_device) THEN 'replay_or_rate'
        ELSE 'credential_invalid'
      END AS status,
      (SELECT id::text FROM inserted_event LIMIT 1) AS event_id,
      (SELECT event_type::text FROM inserted_event LIMIT 1) AS event_type,
      (SELECT occurred_at FROM inserted_event LIMIT 1) AS event_occurred_at,
      (SELECT created_at FROM inserted_event LIMIT 1) AS event_created_at,
      (SELECT flight_id::text FROM current_upsert LIMIT 1) AS current_flight_id,
      (SELECT tenant_id::text FROM current_upsert LIMIT 1) AS current_tenant_id,
      (SELECT membership_id::text FROM current_upsert LIMIT 1) AS current_membership_id,
      (SELECT device_id::text FROM current_upsert LIMIT 1) AS current_device_id,
      (SELECT phase::text FROM current_upsert LIMIT 1) AS current_phase,
      (SELECT latitude FROM current_upsert LIMIT 1) AS current_latitude,
      (SELECT longitude FROM current_upsert LIMIT 1) AS current_longitude,
      (SELECT altitude_feet FROM current_upsert LIMIT 1) AS current_altitude_feet,
      (SELECT ground_speed_knots FROM current_upsert LIMIT 1) AS current_ground_speed_knots,
      (SELECT heading_degrees FROM current_upsert LIMIT 1) AS current_heading_degrees,
      (SELECT simulator_time FROM current_upsert LIMIT 1) AS current_simulator_time,
      (SELECT sample_at FROM current_upsert LIMIT 1) AS current_sample_at,
      (SELECT sequence FROM current_upsert LIMIT 1) AS current_sequence,
      (SELECT created_at FROM current_upsert LIMIT 1) AS current_created_at,
      (SELECT updated_at FROM current_upsert LIMIT 1) AS current_updated_at
  `);

  const row = result.rows[0];
  if (!row) throw new Error("Atomic telemetry ingest returned no result");
  const current =
    row.current_flight_id &&
    row.current_tenant_id &&
    row.current_membership_id &&
    row.current_device_id &&
    row.current_phase &&
    row.current_latitude !== null &&
    row.current_longitude !== null &&
    row.current_altitude_feet !== null &&
    row.current_ground_speed_knots !== null &&
    row.current_heading_degrees !== null &&
    row.current_simulator_time &&
    row.current_sample_at &&
    row.current_sequence !== null &&
    row.current_created_at &&
    row.current_updated_at
      ? {
          flightId: row.current_flight_id,
          tenantId: row.current_tenant_id,
          membershipId: row.current_membership_id,
          deviceId: row.current_device_id,
          phase: row.current_phase,
          latitude: Number(row.current_latitude),
          longitude: Number(row.current_longitude),
          altitudeFeet: Number(row.current_altitude_feet),
          groundSpeedKnots: Number(row.current_ground_speed_knots),
          headingDegrees: Number(row.current_heading_degrees),
          simulatorTime: asDate(row.current_simulator_time),
          sampleAt: asDate(row.current_sample_at),
          sequence: Number(row.current_sequence),
          createdAt: asDate(row.current_created_at),
          updatedAt: asDate(row.current_updated_at),
        }
      : null;
  const oooiEvent =
    row.event_id &&
    row.event_type &&
    row.event_occurred_at &&
    row.event_created_at
      ? {
          id: row.event_id,
          tenantId: input.tenantId,
          flightId: input.flightId,
          eventType: row.event_type,
          occurredAt: asDate(row.event_occurred_at),
          source: "telemetry" as const,
          actorMembershipId: null,
          deviceId: input.deviceId,
          reason: null,
          createdAt: asDate(row.event_created_at),
        }
      : null;
  if (row.status === "accepted" && !current) {
    throw new Error("Atomic telemetry ingest omitted its accepted sample");
  }
  return { status: row.status, current, oooiEvent };
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

type AtomicCorrectionRow = {
  applied: boolean;
};

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
  const outProvided = input.outAt !== undefined;
  const offProvided = input.offAt !== undefined;
  const onProvided = input.onAt !== undefined;
  const inProvided = input.inAt !== undefined;
  const outAt = input.outAt?.toISOString() ?? null;
  const offAt = input.offAt?.toISOString() ?? null;
  const onAt = input.onAt?.toISOString() ?? null;
  const inAt = input.inAt?.toISOString() ?? null;
  const operationAt = input.operationAt.toISOString();
  const result = await db.execute<AtomicCorrectionRow>(sql`
    WITH proposed AS MATERIALIZED (
      SELECT f.*,
        CASE WHEN ${outProvided} THEN ${outAt}::timestamptz ELSE f.out_at END AS next_out,
        CASE WHEN ${offProvided} THEN ${offAt}::timestamptz ELSE f.off_at END AS next_off,
        CASE WHEN ${onProvided} THEN ${onAt}::timestamptz ELSE f.on_at END AS next_on,
        CASE WHEN ${inProvided} THEN ${inAt}::timestamptz ELSE f.in_at END AS next_in
      FROM flights f
      WHERE f.id = ${input.flightId}::uuid
        AND f.tenant_id = ${input.tenantId}::uuid
        AND f.version = ${input.expectedVersion}
      FOR UPDATE
    ),
    valid AS MATERIALIZED (
      SELECT * FROM proposed
      WHERE (next_out IS NULL OR next_off IS NULL OR next_out <= next_off)
        AND (next_out IS NULL OR next_on IS NULL OR next_out <= next_on)
        AND (next_out IS NULL OR next_in IS NULL OR next_out <= next_in)
        AND (next_off IS NULL OR next_on IS NULL OR next_off <= next_on)
        AND (next_off IS NULL OR next_in IS NULL OR next_off <= next_in)
        AND (next_on IS NULL OR next_in IS NULL OR next_on <= next_in)
    ),
    updated AS (
      UPDATE flights f
      SET out_at = valid.next_out,
          off_at = valid.next_off,
          on_at = valid.next_on,
          in_at = valid.next_in,
          out_manual_override = CASE WHEN ${outProvided}
                                     THEN true ELSE f.out_manual_override END,
          off_manual_override = CASE WHEN ${offProvided}
                                     THEN true ELSE f.off_manual_override END,
          on_manual_override = CASE WHEN ${onProvided}
                                    THEN true ELSE f.on_manual_override END,
          in_manual_override = CASE WHEN ${inProvided}
                                    THEN true ELSE f.in_manual_override END,
          version = f.version + 1,
          updated_at = GREATEST(f.updated_at, ${operationAt}::timestamptz)
      FROM valid
      WHERE f.id = valid.id
        AND f.tenant_id = valid.tenant_id
        AND f.version = ${input.expectedVersion}
      RETURNING f.id, valid.version AS from_version, f.version AS to_version
    ),
    event_values(event_type, provided, occurred_at) AS (
      VALUES
        ('out'::oooi_event_type, ${outProvided}, ${outAt}::timestamptz),
        ('off'::oooi_event_type, ${offProvided}, ${offAt}::timestamptz),
        ('on'::oooi_event_type, ${onProvided}, ${onAt}::timestamptz),
        ('in'::oooi_event_type, ${inProvided}, ${inAt}::timestamptz)
    ),
    inserted_events AS (
      INSERT INTO flight_oooi_events (
        tenant_id, flight_id, event_type, occurred_at, source,
        actor_membership_id, reason, created_at
      )
      SELECT ${input.tenantId}::uuid, updated.id, values.event_type,
             values.occurred_at, 'manual', ${input.actorMembershipId}::uuid,
             ${input.reason}, ${operationAt}
      FROM updated
      CROSS JOIN event_values values
      WHERE values.provided
      RETURNING id
    ),
    inserted_audit AS (
      INSERT INTO audit_events (
        tenant_id, actor_membership_id, action, entity_type, entity_id, meta,
        created_at
      )
      SELECT ${input.tenantId}::uuid, ${input.actorMembershipId}::uuid,
             'flight.oooi_correct', 'flight', updated.id::text,
             jsonb_build_object(
               'fields', ARRAY_REMOVE(ARRAY[
                 CASE WHEN ${outProvided} THEN 'outAt' END,
                 CASE WHEN ${offProvided} THEN 'offAt' END,
                 CASE WHEN ${onProvided} THEN 'onAt' END,
                 CASE WHEN ${inProvided} THEN 'inAt' END
               ], NULL),
               'reason', ${input.reason}::text,
               'fromVersion', updated.from_version,
               'toVersion', updated.to_version
             ),
             ${operationAt}
      FROM updated
      RETURNING id
    )
    SELECT EXISTS (SELECT 1 FROM updated) AS applied
  `);
  return result.rows[0]?.applied === true;
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

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function nullableDate(value: Date | string | null): Date | null {
  return value === null ? null : asDate(value);
}

function simulatorDeviceFromRow(
  row: AtomicSimulatorDeviceRow,
): SimulatorDevice {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    membershipId: row.membership_id,
    name: row.name,
    tokenMac: row.token_mac,
    status: row.status,
    lastSequence: row.last_sequence,
    lastIngestAt: nullableDate(row.last_ingest_at),
    lastSeenAt: nullableDate(row.last_seen_at),
    revokedAt: nullableDate(row.revoked_at),
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
  };
}
