import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "../client.js";
import {
  guard,
  isoTimestampSql,
  json,
  jsonBooleanSql,
  ms,
  runAtomic,
} from "../atomic.js";
import { simbriefDispatches, type SimbriefDispatch } from "../schema.js";

export type SimbriefFlightSnapshot = {
  flightVersion: number;
  assignmentRevision: number;
  dispatchReleaseId: string;
  dispatchReleaseRevision: number;
  pilotMembershipId: string;
  flightNumber: string;
  depIcao: string;
  arrIcao: string;
  etd: string;
  eta: string;
  aircraftType: string | null;
};

/**
 * Uses the flight version as a compare-and-set linearization point, then
 * atomically persists a release-bound preparation and its audit event.
 */
export async function createSimbriefDispatchAtomic(input: {
  id: string;
  tenantId: string;
  flightId: string;
  createdByMembershipId: string;
  staticId: string;
  request: Record<string, string>;
  expectedFlightVersion: number;
  expectedAssignmentRevision: number;
  releaseId: string;
  releaseRevision: number;
  preparedAt: Date;
}): Promise<SimbriefDispatch | null> {
  const preparedAt = ms(input.preparedAt);
  const dispatcherName = sql`(
    SELECT coalesce(
      nullif(trim(membership.display_name), ''),
      nullif(trim(membership.pilot_callsign), ''),
      'VA Dispatcher'
    )
    FROM memberships membership
    WHERE membership.id = ${input.createdByMembershipId}
      AND membership.tenant_id = ${input.tenantId}
  )`;
  const result = await runAtomic([
    guard(sql`EXISTS (
      SELECT 1
      FROM flights f
      WHERE f.id = ${input.flightId}
        AND f.tenant_id = ${input.tenantId}
        AND f.version = ${input.expectedFlightVersion}
        AND f.assignment_revision = ${input.expectedAssignmentRevision}
        AND f.status IN ('accepted', 'briefed')
        AND f.pilot_membership_id IS NOT NULL
    )`),
    guard(sql`EXISTS (
      SELECT 1
      FROM dispatch_releases release
      WHERE release.id = ${input.releaseId}
        AND release.tenant_id = ${input.tenantId}
        AND release.flight_id = ${input.flightId}
        AND release.revision = ${input.releaseRevision}
        AND NOT EXISTS (
          SELECT 1
          FROM dispatch_releases newer
          WHERE newer.tenant_id = release.tenant_id
            AND newer.flight_id = release.flight_id
            AND newer.revision > release.revision
        )
    )`),
    guard(sql`EXISTS (
      SELECT 1
      FROM memberships membership
      WHERE membership.id = ${input.createdByMembershipId}
        AND membership.tenant_id = ${input.tenantId}
        AND membership.role IN ('dispatcher', 'admin')
        AND membership.status = 'active'
    )`),
    // A head row owned by another tenant is never advanced.
    guard(sql`NOT EXISTS (
      SELECT 1
      FROM simbrief_flight_heads head
      WHERE head.flight_id = ${input.flightId}
        AND head.tenant_id <> ${input.tenantId}
    )`),
    sql`
      INSERT INTO simbrief_flight_heads (
        flight_id, tenant_id, revision, created_at, updated_at
      )
      VALUES (${input.flightId}, ${input.tenantId}, 1, ${preparedAt}, ${preparedAt})
      ON CONFLICT (flight_id) DO UPDATE
      SET revision = simbrief_flight_heads.revision + 1,
          updated_at = excluded.updated_at
    `,
    sql`
      INSERT INTO simbrief_dispatches (
        id, tenant_id, flight_id, created_by_membership_id, static_id,
        status, revision, request, flight_snapshot, created_at, updated_at
      )
      SELECT ${input.id}, ${input.tenantId}, f.id,
        ${input.createdByMembershipId}, ${input.staticId}, 'prepared',
        head.revision,
        json_set(json(${json(input.request)}), '$.dxname', ${dispatcherName}),
        json_object(
          'flightVersion', f.version,
          'assignmentRevision', f.assignment_revision,
          'dispatchReleaseId', ${input.releaseId},
          'dispatchReleaseRevision', ${input.releaseRevision},
          'pilotMembershipId', f.pilot_membership_id,
          'flightNumber', f.flight_number,
          'depIcao', f.dep_icao,
          'arrIcao', f.arr_icao,
          'etd', ${isoTimestampSql(sql`f.etd`)},
          'eta', ${isoTimestampSql(sql`f.eta`)},
          'aircraftType', f.aircraft_type
        ),
        ${preparedAt}, ${preparedAt}
      FROM flights f
      JOIN simbrief_flight_heads head ON head.flight_id = f.id
      WHERE f.id = ${input.flightId}
        AND f.tenant_id = ${input.tenantId}
    `,
    sql`
      INSERT INTO audit_events (
        tenant_id, actor_membership_id, action, entity_type, entity_id,
        meta, created_at
      )
      SELECT created.tenant_id, ${input.createdByMembershipId},
        'simbrief.dispatch_prepare', 'simbrief_dispatch', created.id,
        json_object(
          'flightId', created.flight_id,
          'staticId', created.static_id,
          'flightVersion', created.flight_snapshot -> '$.flightVersion',
          'assignmentRevision', created.flight_snapshot -> '$.assignmentRevision',
          'dispatchReleaseId', created.flight_snapshot -> '$.dispatchReleaseId',
          'dispatchReleaseRevision', created.flight_snapshot -> '$.dispatchReleaseRevision',
          'hasRemarks', ${jsonBooleanSql(sql`json_type(created.request, '$.manualrmk') IS NOT NULL`)}
        ),
        ${preparedAt}
      FROM simbrief_dispatches created
      WHERE created.id = ${input.id}
    `,
  ]);
  if (!result) return null;
  return findSimbriefDispatch(input.tenantId, input.flightId, input.id);
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
  const startedAt = ms(input.startedAt);
  const snapshot = (key: string) =>
    sql.raw(`json_extract(target.flight_snapshot, '$.${key}')`);
  // The coarse flight version is intentionally not compared: notes-only edits
  // advance it, while the material snapshot checks protect planning.
  const flightMatches = sql`EXISTS (
    SELECT 1
    FROM flights flight
    WHERE flight.id = target.flight_id
      AND flight.tenant_id = target.tenant_id
      AND flight.assignment_revision = ${snapshot("assignmentRevision")}
      AND flight.status IN ('accepted', 'briefed')
  )`;
  const releaseCurrent = sql`EXISTS (
    SELECT 1
    FROM dispatch_releases release
    WHERE release.tenant_id = target.tenant_id
      AND release.flight_id = target.flight_id
      AND release.id = ${snapshot("dispatchReleaseId")}
      AND release.revision = ${snapshot("dispatchReleaseRevision")}
      AND NOT EXISTS (
        SELECT 1
        FROM dispatch_releases newer
        WHERE newer.tenant_id = release.tenant_id
          AND newer.flight_id = release.flight_id
          AND newer.revision > release.revision
      )
  )`;
  const materialMatches = sql`(
    target.status = 'prepared'
    AND EXISTS (
      SELECT 1
      FROM flights flight
      JOIN memberships pilot
        ON pilot.id = flight.pilot_membership_id
       AND pilot.tenant_id = flight.tenant_id
      WHERE flight.id = target.flight_id
        AND flight.tenant_id = target.tenant_id
        AND pilot.id = ${input.generatedByMembershipId}
        AND pilot.role = 'pilot'
        AND pilot.status = 'active'
        AND pilot.simbrief_user_id = ${input.simbriefUserId}
        AND flight.assignment_revision = ${snapshot("assignmentRevision")}
        AND flight.pilot_membership_id = ${snapshot("pilotMembershipId")}
        AND flight.flight_number = ${snapshot("flightNumber")}
        AND flight.dep_icao = ${snapshot("depIcao")}
        AND flight.arr_icao = ${snapshot("arrIcao")}
        AND ${isoTimestampSql(sql`flight.etd`)} = ${snapshot("etd")}
        AND ${isoTimestampSql(sql`flight.eta`)} = ${snapshot("eta")}
        AND flight.aircraft_type IS ${snapshot("aircraftType")}
    )
  )`;
  const headClaimed = sql`EXISTS (
    SELECT 1
    FROM simbrief_flight_heads head
    WHERE head.flight_id = target.flight_id
      AND head.tenant_id = target.tenant_id
      AND head.revision = target.revision
  )`;
  const targetRow = sql`
    FROM simbrief_dispatches target
    WHERE target.id = ${input.id}
      AND target.tenant_id = ${input.tenantId}
      AND target.flight_id = ${input.flightId}
  `;
  const startable = sql`${flightMatches} AND ${releaseCurrent} AND ${materialMatches} AND ${headClaimed}`;

  const result = await runAtomic<{
    result_status: "started" | "superseded" | "stale" | "unavailable";
    latest_id: string | null;
  }>([
    // Classify against the pre-state; the writes below use the same predicate
    // inside the same serialized transaction.
    sql`
      SELECT
        CASE
          WHEN EXISTS (SELECT 1 ${targetRow} AND ${startable}) THEN 'started'
          WHEN EXISTS (
            SELECT 1 ${targetRow}
              AND ${flightMatches} AND ${releaseCurrent}
              AND target.status <> 'prepared'
          ) THEN 'unavailable'
          WHEN NOT EXISTS (
            SELECT 1 ${targetRow}
              AND ${flightMatches} AND ${releaseCurrent} AND ${materialMatches}
          ) THEN 'stale'
          WHEN NOT EXISTS (SELECT 1 ${targetRow} AND ${headClaimed})
            THEN 'superseded'
          ELSE 'unavailable'
        END AS result_status,
        (
          SELECT target.id ${targetRow}
            AND ${flightMatches} AND ${releaseCurrent}
        ) AS latest_id
    `,
    sql`
      INSERT INTO audit_events (
        tenant_id, actor_membership_id, action, entity_type, entity_id,
        meta, created_at
      )
      SELECT target.tenant_id, ${input.generatedByMembershipId},
        'simbrief.dispatch_generate', 'simbrief_dispatch', target.id,
        json_object(
          'flightId', target.flight_id,
          'staticId', target.static_id,
          'flightVersion', target.flight_snapshot -> '$.flightVersion',
          'assignmentRevision', target.flight_snapshot -> '$.assignmentRevision',
          'dispatchReleaseId', target.flight_snapshot -> '$.dispatchReleaseId',
          'dispatchReleaseRevision', target.flight_snapshot -> '$.dispatchReleaseRevision',
          'preparedByMembershipId', target.created_by_membership_id,
          'callbackExpiresAt', ${input.callbackExpiresAt.toISOString()}
        ),
        ${startedAt}
      ${targetRow}
        AND ${startable}
    `,
    sql`
      UPDATE simbrief_dispatches AS target
      SET generated_by_membership_id = ${input.generatedByMembershipId},
          simbrief_user_id = ${input.simbriefUserId},
          callback_token_mac = ${input.callbackTokenMac},
          callback_expires_at = ${ms(input.callbackExpiresAt)},
          request = json_set(
            target.request,
            '$.userid', ${input.simbriefUserId},
            '$.pid', ${input.simbriefUserId}
          ),
          status = 'pending',
          last_error = NULL,
          updated_at = ${startedAt}
      WHERE target.id = ${input.id}
        AND target.tenant_id = ${input.tenantId}
        AND target.flight_id = ${input.flightId}
        AND ${startable}
    `,
  ]);
  const row = result?.[0]?.[0];
  if (!row?.result_status) {
    throw new Error("Atomic SimBrief generation returned no result");
  }
  const dispatch =
    row.result_status === "started"
      ? await findSimbriefDispatch(input.tenantId, input.flightId, input.id)
      : null;
  const latest =
    row.result_status === "superseded"
      ? await findLatestSimbriefDispatch(input.tenantId, input.flightId)
      : null;
  return {
    status: row.result_status,
    dispatch,
    latestId: latest?.id ?? row.latest_id ?? null,
  };
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
  const syncedAt = ms(input.syncedAt);
  const pending = sql`
    dispatch.id = ${input.id}
    AND dispatch.tenant_id = ${input.tenantId}
    AND dispatch.flight_id = ${input.flightId}
    AND dispatch.status = 'pending'
    AND dispatch.simbrief_user_id = ${input.simbriefUserId}
  `;
  const linkedPilot = sql`
    membership.id = dispatch.generated_by_membership_id
    AND membership.tenant_id = dispatch.tenant_id
    AND membership.simbrief_user_id = dispatch.simbrief_user_id
  `;
  const result = await runAtomic([
    guard(
      sql`EXISTS (SELECT 1 FROM simbrief_dispatches dispatch WHERE ${pending})`,
    ),
    sql`
      INSERT INTO audit_events (
        tenant_id, actor_membership_id, action, entity_type, entity_id,
        meta, created_at
      )
      SELECT dispatch.tenant_id, dispatch.generated_by_membership_id,
        'simbrief.dispatch_ready', 'simbrief_dispatch', dispatch.id,
        json_object(
          'flightId', dispatch.flight_id,
          'simbriefRequestId', ${input.simbriefRequestId},
          'pilotVerified', ${jsonBooleanSql(sql`EXISTS (SELECT 1 FROM memberships membership WHERE ${linkedPilot})`)}
        ),
        ${syncedAt}
      FROM simbrief_dispatches dispatch
      WHERE ${pending}
    `,
    sql`
      UPDATE memberships AS membership
      SET simbrief_verified_at = ${syncedAt},
          updated_at = ${syncedAt}
      WHERE EXISTS (
        SELECT 1
        FROM simbrief_dispatches dispatch
        WHERE ${pending} AND ${linkedPilot}
      )
    `,
    sql`
      UPDATE simbrief_dispatches AS dispatch
      SET status = 'ready',
          ofp = json(${json(input.ofp)}),
          simbrief_request_id = ${input.simbriefRequestId},
          generated_at = ${input.generatedAt ? ms(input.generatedAt) : null},
          synced_at = ${syncedAt},
          callback_token_mac = NULL,
          last_error = NULL,
          updated_at = ${syncedAt}
      WHERE ${pending}
    `,
  ]);
  if (!result) return null;
  return findSimbriefDispatch(input.tenantId, input.flightId, input.id);
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
