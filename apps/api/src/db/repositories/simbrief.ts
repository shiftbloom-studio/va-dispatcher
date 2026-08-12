import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "../client.js";
import { simbriefDispatches, type SimbriefDispatch } from "../schema.js";

export type SimbriefFlightSnapshot = {
  pilotMembershipId: string;
  flightNumber: string;
  depIcao: string;
  arrIcao: string;
  etd: string;
  eta: string;
  aircraftType: string | null;
};

type AtomicDispatchEnvelope = {
  result_status?: "started" | "superseded" | "stale" | "unavailable";
  latest_id?: string | null;
  dispatch_row: Record<string, unknown> | string | null;
};

/** Locks the flight and atomically persists a preparation with its audit. */
export async function createSimbriefDispatchAtomic(input: {
  id: string;
  tenantId: string;
  flightId: string;
  createdByMembershipId: string;
  staticId: string;
  request: Record<string, string>;
  flightSnapshot: SimbriefFlightSnapshot;
  preparedAt: Date;
}): Promise<SimbriefDispatch | null> {
  const db = getDb();
  const preparedAt = input.preparedAt.toISOString();
  const snapshot = input.flightSnapshot;
  const result = await db.execute<AtomicDispatchEnvelope>(sql`
    WITH locked_flight AS MATERIALIZED (
      SELECT f.*
      FROM flights f
      WHERE f.id = ${input.flightId}::uuid
        AND f.tenant_id = ${input.tenantId}::uuid
      FOR UPDATE
    ),
    locked_dispatcher AS MATERIALIZED (
      SELECT membership.id, membership.display_name, membership.pilot_callsign
      FROM memberships membership
      WHERE membership.id = ${input.createdByMembershipId}::uuid
        AND membership.tenant_id = ${input.tenantId}::uuid
        AND membership.role IN ('dispatcher', 'admin')
        AND membership.status = 'active'
      FOR UPDATE
    ),
    current_flight AS MATERIALIZED (
      SELECT f.*,
             dispatcher.id AS dispatcher_id,
             COALESCE(
               NULLIF(BTRIM(dispatcher.display_name), ''),
               NULLIF(BTRIM(dispatcher.pilot_callsign), ''),
               'VA Dispatcher'
             ) AS dispatcher_name
      FROM locked_flight f
      CROSS JOIN locked_dispatcher dispatcher
      WHERE f.pilot_membership_id = ${snapshot.pilotMembershipId}::uuid
        AND f.flight_number = ${snapshot.flightNumber}
        AND f.dep_icao = ${snapshot.depIcao}
        AND f.arr_icao = ${snapshot.arrIcao}
        AND f.etd = ${snapshot.etd}::timestamptz
        AND f.eta = ${snapshot.eta}::timestamptz
        AND f.aircraft_type IS NOT DISTINCT FROM ${snapshot.aircraftType}::text
        AND f.status NOT IN ('declined', 'active', 'completed', 'cancelled')
    ),
    advanced_head AS (
      INSERT INTO simbrief_flight_heads (
        flight_id, tenant_id, revision, created_at, updated_at
      )
      SELECT current_flight.id, ${input.tenantId}::uuid, 1,
             ${preparedAt}, ${preparedAt}
      FROM current_flight
      ON CONFLICT (flight_id) DO UPDATE
      SET revision = simbrief_flight_heads.revision + 1,
          updated_at = EXCLUDED.updated_at
      WHERE simbrief_flight_heads.tenant_id = EXCLUDED.tenant_id
      RETURNING flight_id, tenant_id, revision
    ),
    created AS (
      INSERT INTO simbrief_dispatches (
        id, tenant_id, flight_id, created_by_membership_id, static_id,
        status, revision, request, flight_snapshot, created_at, updated_at
      )
      SELECT ${input.id}::uuid, ${input.tenantId}::uuid,
             current_flight.id, current_flight.dispatcher_id,
             ${input.staticId}, 'prepared', advanced_head.revision,
             jsonb_set(
               ${JSON.stringify(input.request)}::jsonb,
               '{dxname}',
               to_jsonb(current_flight.dispatcher_name),
               true
             ),
             ${JSON.stringify(snapshot)}::jsonb,
             ${preparedAt}, ${preparedAt}
      FROM current_flight
      JOIN advanced_head ON advanced_head.flight_id = current_flight.id
      RETURNING *
    ),
    inserted_audit AS (
      INSERT INTO audit_events (
        tenant_id, actor_membership_id, action, entity_type, entity_id,
        meta, created_at
      )
      SELECT created.tenant_id, ${input.createdByMembershipId}::uuid,
             'simbrief.dispatch_prepare', 'simbrief_dispatch',
             created.id::text,
             jsonb_build_object(
               'flightId', created.flight_id,
               'staticId', created.static_id,
               'hasRemarks', created.request ? 'manualrmk'
             ),
             ${preparedAt}
      FROM created
      RETURNING id
    )
    SELECT to_jsonb(created) AS dispatch_row
    FROM created
    JOIN inserted_audit ON TRUE
  `);
  return dispatchFromEnvelope(result.rows[0]);
}

export async function listSimbriefDispatches(
  tenantId: string,
  flightId: string,
): Promise<SimbriefDispatch[]> {
  const db = getDb();
  return db
    .select()
    .from(simbriefDispatches)
    .where(
      and(
        eq(simbriefDispatches.tenantId, tenantId),
        eq(simbriefDispatches.flightId, flightId),
      ),
    )
    .orderBy(desc(simbriefDispatches.revision), desc(simbriefDispatches.id));
}

export async function startSimbriefDispatchAtomic(input: {
  id: string;
  tenantId: string;
  flightId: string;
  generatedByMembershipId: string;
  simbriefUserId: string;
  callbackTokenMac: string;
  callbackExpiresAt: Date;
  startedAt: Date;
}): Promise<{
  status: "started" | "superseded" | "stale" | "unavailable";
  dispatch: SimbriefDispatch | null;
  latestId: string | null;
}> {
  const db = getDb();
  const startedAt = input.startedAt.toISOString();
  const callbackExpiresAt = input.callbackExpiresAt.toISOString();
  const result = await db.execute<AtomicDispatchEnvelope>(sql`
    WITH locked_flight AS MATERIALIZED (
      SELECT f.*
      FROM flights f
      WHERE f.id = ${input.flightId}::uuid
        AND f.tenant_id = ${input.tenantId}::uuid
      FOR UPDATE
    ),
    locked_pilot AS MATERIALIZED (
      SELECT membership.id, membership.simbrief_user_id
      FROM memberships membership
      JOIN locked_flight flight
        ON flight.pilot_membership_id = membership.id
       AND flight.tenant_id = membership.tenant_id
      WHERE membership.id = ${input.generatedByMembershipId}::uuid
        AND membership.role = 'pilot'
        AND membership.status = 'active'
        AND membership.simbrief_user_id = ${input.simbriefUserId}
      FOR UPDATE OF membership
    ),
    target AS MATERIALIZED (
      SELECT dispatch.*
      FROM simbrief_dispatches dispatch
      JOIN locked_flight flight
        ON flight.id = dispatch.flight_id
       AND flight.tenant_id = dispatch.tenant_id
      WHERE dispatch.id = ${input.id}::uuid
        AND dispatch.tenant_id = ${input.tenantId}::uuid
        AND dispatch.flight_id = ${input.flightId}::uuid
      FOR UPDATE OF dispatch
    ),
    material_target AS MATERIALIZED (
      SELECT target.*
      FROM target
      JOIN locked_flight flight ON flight.id = target.flight_id
      JOIN locked_pilot pilot
        ON pilot.id = flight.pilot_membership_id
       AND pilot.simbrief_user_id = ${input.simbriefUserId}
      WHERE target.status = 'prepared'
        AND flight.status NOT IN ('declined', 'active', 'completed', 'cancelled')
        AND (target.flight_snapshot ->> 'pilotMembershipId')::uuid =
            flight.pilot_membership_id
        AND target.flight_snapshot ->> 'flightNumber' = flight.flight_number
        AND target.flight_snapshot ->> 'depIcao' = flight.dep_icao
        AND target.flight_snapshot ->> 'arrIcao' = flight.arr_icao
        AND (target.flight_snapshot ->> 'etd')::timestamptz = flight.etd
        AND (target.flight_snapshot ->> 'eta')::timestamptz = flight.eta
        AND target.flight_snapshot ->> 'aircraftType'
            IS NOT DISTINCT FROM flight.aircraft_type
    ),
    claimed_head AS (
      UPDATE simbrief_flight_heads head
      SET revision = head.revision
      FROM material_target
      WHERE head.flight_id = material_target.flight_id
        AND head.tenant_id = material_target.tenant_id
        AND head.revision = material_target.revision
      RETURNING head.flight_id, head.revision
    ),
    updated AS (
      UPDATE simbrief_dispatches dispatch
      SET generated_by_membership_id = ${input.generatedByMembershipId}::uuid,
          simbrief_user_id = ${input.simbriefUserId},
          callback_token_mac = ${input.callbackTokenMac},
          callback_expires_at = ${callbackExpiresAt},
          request = material_target.request || jsonb_build_object(
            'userid', ${input.simbriefUserId}::text,
            'pid', ${input.simbriefUserId}::text
          ),
          status = 'pending',
          last_error = NULL,
          updated_at = ${startedAt}
      FROM material_target
      JOIN claimed_head ON claimed_head.flight_id = material_target.flight_id
      WHERE dispatch.id = material_target.id
      RETURNING dispatch.*
    ),
    inserted_audit AS (
      INSERT INTO audit_events (
        tenant_id, actor_membership_id, action, entity_type, entity_id,
        meta, created_at
      )
      SELECT updated.tenant_id, ${input.generatedByMembershipId}::uuid,
             'simbrief.dispatch_generate', 'simbrief_dispatch',
             updated.id::text,
             jsonb_build_object(
               'flightId', updated.flight_id,
               'staticId', updated.static_id,
               'preparedByMembershipId', updated.created_by_membership_id,
               'callbackExpiresAt', updated.callback_expires_at
             ),
             ${startedAt}
      FROM updated
      RETURNING id
    )
    SELECT
      CASE
        WHEN EXISTS (SELECT 1 FROM updated) THEN 'started'
        WHEN EXISTS (
          SELECT 1 FROM target WHERE status <> 'prepared'
        ) THEN 'unavailable'
        WHEN NOT EXISTS (SELECT 1 FROM material_target) THEN 'stale'
        WHEN NOT EXISTS (SELECT 1 FROM claimed_head) THEN 'superseded'
        ELSE 'unavailable'
      END AS result_status,
      (SELECT id::text FROM target LIMIT 1) AS latest_id,
      (SELECT to_jsonb(updated) FROM updated LIMIT 1) AS dispatch_row
    FROM (SELECT 1) singleton
  `);
  const row = result.rows[0];
  if (!row?.result_status) {
    throw new Error("Atomic SimBrief generation returned no result");
  }
  const latest =
    row.result_status === "superseded"
      ? await findLatestSimbriefDispatch(input.tenantId, input.flightId)
      : null;
  return {
    status: row.result_status,
    dispatch: dispatchFromEnvelope(row),
    latestId: latest?.id ?? row.latest_id ?? null,
  };
}

export async function findSimbriefDispatch(
  tenantId: string,
  flightId: string,
  id: string,
): Promise<SimbriefDispatch | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(simbriefDispatches)
    .where(
      and(
        eq(simbriefDispatches.tenantId, tenantId),
        eq(simbriefDispatches.flightId, flightId),
        eq(simbriefDispatches.id, id),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function findSimbriefDispatchForCallback(
  id: string,
): Promise<SimbriefDispatch | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(simbriefDispatches)
    .where(eq(simbriefDispatches.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function findLatestSimbriefDispatch(
  tenantId: string,
  flightId: string,
): Promise<SimbriefDispatch | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(simbriefDispatches)
    .where(
      and(
        eq(simbriefDispatches.tenantId, tenantId),
        eq(simbriefDispatches.flightId, flightId),
      ),
    )
    .orderBy(desc(simbriefDispatches.revision), desc(simbriefDispatches.id))
    .limit(1);
  return rows[0] ?? null;
}

/** Atomically stores the OFP, verifies the pilot link, and records ready audit. */
export async function completeSimbriefDispatchAtomic(input: {
  id: string;
  tenantId: string;
  flightId: string;
  simbriefUserId: string;
  ofp: Record<string, unknown>;
  simbriefRequestId: string | null;
  generatedAt: Date | null;
  syncedAt: Date;
}): Promise<SimbriefDispatch | null> {
  const db = getDb();
  const syncedAt = input.syncedAt.toISOString();
  const generatedAt = input.generatedAt?.toISOString() ?? null;
  const result = await db.execute<AtomicDispatchEnvelope>(sql`
    WITH updated AS (
      UPDATE simbrief_dispatches dispatch
      SET status = 'ready',
          ofp = ${JSON.stringify(input.ofp)}::jsonb,
          simbrief_request_id = ${input.simbriefRequestId},
          generated_at = ${generatedAt}::timestamptz,
          synced_at = ${syncedAt},
          callback_token_mac = NULL,
          last_error = NULL,
          updated_at = ${syncedAt}
      WHERE dispatch.id = ${input.id}::uuid
        AND dispatch.tenant_id = ${input.tenantId}::uuid
        AND dispatch.flight_id = ${input.flightId}::uuid
        AND dispatch.status = 'pending'
        AND dispatch.simbrief_user_id = ${input.simbriefUserId}
      RETURNING dispatch.*
    ),
    verified_pilot AS (
      UPDATE memberships membership
      SET simbrief_verified_at = ${syncedAt},
          updated_at = ${syncedAt}
      FROM updated
      WHERE membership.id = updated.generated_by_membership_id
        AND membership.tenant_id = updated.tenant_id
        AND membership.simbrief_user_id = updated.simbrief_user_id
      RETURNING membership.id
    ),
    inserted_audit AS (
      INSERT INTO audit_events (
        tenant_id, actor_membership_id, action, entity_type, entity_id,
        meta, created_at
      )
      SELECT updated.tenant_id, updated.generated_by_membership_id,
             'simbrief.dispatch_ready', 'simbrief_dispatch',
             updated.id::text,
             jsonb_build_object(
               'flightId', updated.flight_id,
               'simbriefRequestId', updated.simbrief_request_id,
               'pilotVerified', EXISTS (SELECT 1 FROM verified_pilot)
             ),
             ${syncedAt}
      FROM updated
      RETURNING id
    )
    SELECT to_jsonb(updated) AS dispatch_row
    FROM updated
    JOIN inserted_audit ON TRUE
  `);
  return dispatchFromEnvelope(result.rows[0]);
}

function dispatchFromEnvelope(
  envelope: AtomicDispatchEnvelope | undefined,
): SimbriefDispatch | null {
  if (!envelope?.dispatch_row) return null;
  const row =
    typeof envelope.dispatch_row === "string"
      ? (JSON.parse(envelope.dispatch_row) as Record<string, unknown>)
      : envelope.dispatch_row;
  return {
    id: requiredString(row.id, "id"),
    tenantId: requiredString(row.tenant_id, "tenant_id"),
    flightId: requiredString(row.flight_id, "flight_id"),
    createdByMembershipId: nullableString(row.created_by_membership_id),
    generatedByMembershipId: nullableString(row.generated_by_membership_id),
    simbriefUserId: nullableString(row.simbrief_user_id),
    staticId: requiredString(row.static_id, "static_id"),
    callbackTokenMac: nullableString(row.callback_token_mac),
    callbackExpiresAt: nullableDate(row.callback_expires_at),
    status: requiredString(row.status, "status") as SimbriefDispatch["status"],
    revision: requiredInteger(row.revision, "revision"),
    flightSnapshot: flightSnapshotValue(row.flight_snapshot),
    request: stringRecord(row.request),
    ofp: row.ofp === null ? null : objectValue(row.ofp),
    simbriefRequestId: nullableString(row.simbrief_request_id),
    generatedAt: nullableDate(row.generated_at),
    syncedAt: nullableDate(row.synced_at),
    lastError: nullableString(row.last_error),
    createdAt: requiredDate(row.created_at, "created_at"),
    updatedAt: requiredDate(row.updated_at, "updated_at"),
  };
}

function objectValue(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function stringRecord(value: unknown): Record<string, string> {
  const record = objectValue(value);
  return Object.fromEntries(
    Object.entries(record).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function flightSnapshotValue(value: unknown): Record<string, string | null> {
  const record = objectValue(value);
  return Object.fromEntries(
    Object.entries(record).filter(
      (entry): entry is [string, string | null] =>
        typeof entry[1] === "string" || entry[1] === null,
    ),
  );
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`Atomic SimBrief result omitted ${field}`);
  }
  return value;
}

function nullableDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function requiredDate(value: unknown, field: string): Date {
  const date = nullableDate(value);
  if (!date) throw new Error(`Atomic SimBrief result omitted ${field}`);
  return date;
}

function requiredInteger(value: unknown, field: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`Atomic SimBrief result omitted ${field}`);
  }
  return parsed;
}

export async function recordSimbriefSyncError(
  id: string,
  message: string,
): Promise<void> {
  const db = getDb();
  await db
    .update(simbriefDispatches)
    .set({
      lastError: message,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(simbriefDispatches.id, id),
        eq(simbriefDispatches.status, "pending"),
      ),
    );
}
