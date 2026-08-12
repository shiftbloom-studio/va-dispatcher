import { randomUUID } from "node:crypto";

import { and, desc, eq, gte, inArray, lt, lte, ne, or, sql } from "drizzle-orm";
import { getDb } from "../client.js";
import {
  auditEvents,
  flights,
  memberships,
  scheduleRequests,
  type Flight,
  type FlightStatus,
} from "../schema.js";
import {
  decodeCursor,
  encodeCursor,
  type PageResult,
} from "../../lib/pagination.js";

export type CreateFlightInput = {
  tenantId: string;
  actorMembershipId: string;
  scheduleRequestId?: string | null;
  replacesFlightId?: string | null;
  pilotMembershipId?: string | null;
  flightNumber: string;
  depIcao: string;
  arrIcao: string;
  etd: Date;
  eta: Date;
  aircraftType?: string | null;
  status?: FlightStatus;
  dispatcherNotes?: string | null;
};

export async function createFlight(input: CreateFlightInput): Promise<Flight> {
  const db = getDb();
  const id = randomUUID();
  const result = await db.execute<{ id: string }>(sql`
    WITH inserted AS (
      INSERT INTO ${flights} (
        id,
        tenant_id,
        schedule_request_id,
        replaces_flight_id,
        pilot_membership_id,
        flight_number,
        dep_icao,
        arr_icao,
        etd,
        eta,
        aircraft_type,
        status,
        dispatcher_notes
      )
      VALUES (
        ${id},
        ${input.tenantId},
        ${input.scheduleRequestId ?? null},
        ${input.replacesFlightId ?? null},
        ${input.pilotMembershipId ?? null},
        ${input.flightNumber},
        ${input.depIcao.toUpperCase()},
        ${input.arrIcao.toUpperCase()},
        ${input.etd},
        ${input.eta},
        ${input.aircraftType ?? null},
        ${input.status ?? "draft"}::flight_status,
        ${input.dispatcherNotes ?? null}
      )
      RETURNING ${flights.id}, ${flights.status}
    ), audited AS (
      INSERT INTO ${auditEvents} (
        tenant_id,
        actor_membership_id,
        action,
        entity_type,
        entity_id,
        meta
      )
      SELECT
        ${input.tenantId},
        ${input.actorMembershipId},
        'flight.create',
        'flight',
        inserted.id,
        jsonb_build_object('status', inserted.status)
      FROM inserted
      RETURNING id
    )
    SELECT inserted.id FROM inserted INNER JOIN audited ON TRUE
  `);
  if (!result.rows[0]) {
    throw new Error("Flight creation did not return an audited row");
  }
  const created = await findFlight(input.tenantId, id);
  if (!created) throw new Error("Created flight could not be reloaded");
  return created;
}

/**
 * Appends one validated offer batch and advances the request with one locked,
 * auditable SQL statement. The request version and row lock serialize
 * competing batches; no flight can commit unless the whole requested batch,
 * request progress update, and both audit records also commit.
 *
 * Issue #19 extends this primitive with durable idempotent replay metadata.
 */
export async function fulfillScheduleRequest(input: {
  tenantId: string;
  scheduleRequestId: string;
  expectedRequestVersion: number;
  expectedRequestStatus: "in_review" | "partially_fulfilled";
  actorMembershipId: string;
  flights: Array<{
    flightNumber: string;
    depIcao: string;
    arrIcao: string;
    etd: Date;
    eta: Date;
    aircraftType?: string | null;
  }>;
}): Promise<Flight[] | null> {
  if (input.flights.length === 0) return [];
  const db = getDb();
  const proposed = input.flights.map((flight) => ({
    id: randomUUID(),
    flightNumber: flight.flightNumber,
    depIcao: flight.depIcao.toUpperCase(),
    arrIcao: flight.arrIcao.toUpperCase(),
    etd: flight.etd,
    eta: flight.eta,
    aircraftType: flight.aircraftType ?? null,
  }));
  const proposedValues = sql.join(
    proposed.map(
      (flight) => sql`(
        ${flight.id}::uuid,
        ${flight.flightNumber},
        ${flight.depIcao},
        ${flight.arrIcao},
        ${flight.etd},
        ${flight.eta},
        ${flight.aircraftType}
      )`,
    ),
    sql`, `,
  );

  const result = await db.execute<{ id: string }>(sql`
    WITH request_locked AS (
      SELECT
        ${scheduleRequests.id} AS id,
        ${scheduleRequests.pilotMembershipId} AS pilot_membership_id,
        ${scheduleRequests.desiredFlightCount} AS desired_flight_count
      FROM ${scheduleRequests}
      WHERE
        ${scheduleRequests.tenantId} = ${input.tenantId}
        AND ${scheduleRequests.id} = ${input.scheduleRequestId}
        AND ${scheduleRequests.version} = ${input.expectedRequestVersion}
        AND ${scheduleRequests.status} = ${input.expectedRequestStatus}
        AND EXISTS (
          SELECT 1
          FROM ${memberships}
          WHERE
            ${memberships.tenantId} = ${input.tenantId}
            AND ${memberships.id} = ${scheduleRequests.pilotMembershipId}
            AND ${memberships.role} = 'pilot'
            AND ${memberships.status} = 'active'
        )
      FOR UPDATE OF ${scheduleRequests}
    ), capacity AS (
      SELECT
        request_locked.id,
        request_locked.pilot_membership_id,
        request_locked.desired_flight_count,
        count(${flights.id}) FILTER (
          WHERE ${flights.status} <> 'cancelled'
        )::integer AS existing_flight_count
      FROM request_locked
      LEFT JOIN ${flights}
        ON ${flights.tenantId} = ${input.tenantId}
        AND ${flights.scheduleRequestId} = request_locked.id
      GROUP BY
        request_locked.id,
        request_locked.pilot_membership_id,
        request_locked.desired_flight_count
      HAVING
        count(${flights.id}) FILTER (
          WHERE ${flights.status} <> 'cancelled'
        ) + ${proposed.length} <= request_locked.desired_flight_count
    ), proposed (
      id,
      flight_number,
      dep_icao,
      arr_icao,
      etd,
      eta,
      aircraft_type
    ) AS (
      VALUES ${proposedValues}
    ), inserted AS (
      INSERT INTO ${flights} (
        id,
        tenant_id,
        schedule_request_id,
        pilot_membership_id,
        flight_number,
        dep_icao,
        arr_icao,
        etd,
        eta,
        aircraft_type,
        status,
        version
      )
      SELECT
        proposed.id,
        ${input.tenantId},
        capacity.id,
        capacity.pilot_membership_id,
        proposed.flight_number,
        proposed.dep_icao,
        proposed.arr_icao,
        proposed.etd,
        proposed.eta,
        proposed.aircraft_type,
        'offered',
        1
      FROM proposed
      CROSS JOIN capacity
      RETURNING ${flights.id}
    ), batch_checked AS (
      SELECT
        capacity.id,
        capacity.desired_flight_count,
        capacity.existing_flight_count,
        (
          capacity.existing_flight_count + count(inserted.id)::integer
        ) AS cumulative_flight_count
      FROM capacity
      LEFT JOIN inserted ON TRUE
      GROUP BY
        capacity.id,
        capacity.desired_flight_count,
        capacity.existing_flight_count
      HAVING count(inserted.id) = ${proposed.length}
    ), request_updated AS (
      UPDATE ${scheduleRequests}
      SET
        ${scheduleRequests.status} = CASE
          WHEN batch_checked.cumulative_flight_count >= batch_checked.desired_flight_count
            THEN 'fulfilled'::schedule_request_status
          ELSE 'partially_fulfilled'::schedule_request_status
        END,
        ${scheduleRequests.version} = ${scheduleRequests.version} + 1,
        ${scheduleRequests.updatedAt} = NOW()
      FROM batch_checked
      WHERE
        ${scheduleRequests.tenantId} = ${input.tenantId}
        AND ${scheduleRequests.id} = batch_checked.id
        AND ${scheduleRequests.version} = ${input.expectedRequestVersion}
        AND ${scheduleRequests.status} = ${input.expectedRequestStatus}
      RETURNING
        ${scheduleRequests.id},
        ${scheduleRequests.status},
        batch_checked.existing_flight_count,
        batch_checked.cumulative_flight_count,
        batch_checked.desired_flight_count
    ), audited AS (
      INSERT INTO ${auditEvents} (
        tenant_id,
        actor_membership_id,
        action,
        entity_type,
        entity_id,
        meta
      )
      SELECT
        ${input.tenantId},
        ${input.actorMembershipId},
        'schedule_request.fulfillment_progress',
        'schedule_request',
        request_updated.id,
        jsonb_build_object(
          'from', ${input.expectedRequestStatus},
          'to', request_updated.status,
          'batchCount', ${proposed.length},
          'existingFlightCount', request_updated.existing_flight_count,
          'cumulativeFlightCount', request_updated.cumulative_flight_count,
          'remainingFlightCount', greatest(
            0,
            request_updated.desired_flight_count - request_updated.cumulative_flight_count
          )
        )
      FROM request_updated
      UNION ALL
      SELECT
        ${input.tenantId},
        ${input.actorMembershipId},
        'flight.bulk_create',
        'schedule_request',
        request_updated.id,
        jsonb_build_object(
          'count', ${proposed.length},
          'flightIds', to_jsonb(ARRAY(SELECT inserted.id FROM inserted))
        )
      FROM request_updated
      RETURNING id
    ), audit_totals AS (
      SELECT count(*)::integer AS count FROM audited
    )
    SELECT inserted.id
    FROM inserted
    CROSS JOIN request_updated
    CROSS JOIN audit_totals
    WHERE audit_totals.count = 2
  `);

  if (result.rows.length !== proposed.length) return null;
  const ids = result.rows.map((row) => row.id);
  const rows = await db
    .select()
    .from(flights)
    .where(and(eq(flights.tenantId, input.tenantId), inArray(flights.id, ids)));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const ordered = ids
    .map((id) => byId.get(id))
    .filter((row): row is Flight => !!row);
  return ordered.length === ids.length ? ordered : null;
}

export async function findFlight(
  tenantId: string,
  id: string,
): Promise<Flight | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(flights)
    .where(and(eq(flights.tenantId, tenantId), eq(flights.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

export async function findReplacementFlight(
  tenantId: string,
  sourceFlightId: string,
): Promise<Flight | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(flights)
    .where(
      and(
        eq(flights.tenantId, tenantId),
        eq(flights.replacesFlightId, sourceFlightId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function countNonCancelledScheduleRequestFlights(
  tenantId: string,
  scheduleRequestId: string,
): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(flights)
    .where(
      and(
        eq(flights.tenantId, tenantId),
        eq(flights.scheduleRequestId, scheduleRequestId),
        ne(flights.status, "cancelled"),
      ),
    );
  return row?.count ?? 0;
}

export async function listFlights(input: {
  tenantId: string;
  pilotMembershipId?: string;
  status?: FlightStatus | FlightStatus[];
  fromEtd?: Date;
  toEtd?: Date;
  scheduleRequestId?: string;
  cursor?: string;
  limit: number;
}): Promise<PageResult<Flight>> {
  const db = getDb();
  const conditions = [eq(flights.tenantId, input.tenantId)];

  if (input.pilotMembershipId) {
    conditions.push(eq(flights.pilotMembershipId, input.pilotMembershipId));
  }
  if (input.scheduleRequestId) {
    conditions.push(eq(flights.scheduleRequestId, input.scheduleRequestId));
  }
  if (input.status) {
    if (Array.isArray(input.status)) {
      conditions.push(inArray(flights.status, input.status));
    } else {
      conditions.push(eq(flights.status, input.status));
    }
  }
  if (input.fromEtd) {
    conditions.push(gte(flights.etd, input.fromEtd));
  }
  if (input.toEtd) {
    conditions.push(lte(flights.etd, input.toEtd));
  }
  if (input.cursor) {
    const cursor = decodeCursor(input.cursor);
    const cursorTimestamp = new Date(cursor.sortAt);
    conditions.push(
      cursor.legacy
        ? or(
            lt(flights.createdAt, cursorTimestamp),
            and(
              eq(flights.createdAt, cursorTimestamp),
              lt(flights.id, cursor.id),
            ),
          )!
        : or(
            lt(flights.etd, cursorTimestamp),
            and(eq(flights.etd, cursorTimestamp), lt(flights.id, cursor.id)),
          )!,
    );
  }

  const rows = await db
    .select()
    .from(flights)
    .where(and(...conditions))
    .orderBy(desc(flights.etd), desc(flights.id))
    .limit(input.limit + 1);

  const hasMore = rows.length > input.limit;
  const items = hasMore ? rows.slice(0, input.limit) : rows;
  const lastItem = items.at(-1);
  const nextCursor =
    hasMore && lastItem
      ? encodeCursor({
          sortAt: lastItem.etd.toISOString(),
          id: lastItem.id,
        })
      : null;

  return { items, nextCursor };
}

export async function updateFlight(input: {
  tenantId: string;
  id: string;
  expectedVersion: number;
  actorMembershipId: string | null;
  action: string;
  auditMeta: Record<string, unknown>;
  patch: Partial<{
    pilotMembershipId: string | null;
    flightNumber: string;
    depIcao: string;
    arrIcao: string;
    etd: Date;
    eta: Date;
    aircraftType: string | null;
    status: FlightStatus;
    cancelReason: string | null;
    declinedReason: string | null;
    dispatcherNotes: string | null;
    assignmentRevision: number;
    assignmentConfirmedRevision: number | null;
    assignmentConfirmedAt: Date | null;
    outAt: Date | null;
    offAt: Date | null;
    onAt: Date | null;
    inAt: Date | null;
  }>;
}): Promise<Flight | null> {
  const db = getDb();
  const normalized = { ...input.patch };
  if (normalized.depIcao) normalized.depIcao = normalized.depIcao.toUpperCase();
  if (normalized.arrIcao) normalized.arrIcao = normalized.arrIcao.toUpperCase();
  const setClauses = Object.entries(normalized).map(([field, value]) => {
    const column =
      updatableFlightColumns[field as keyof typeof updatableFlightColumns];
    if (!column) throw new Error(`Unsupported flight update field: ${field}`);
    return sql`${column} = ${value}`;
  });
  const auditMeta = JSON.stringify(input.auditMeta);
  const result = await db.execute<{ id: string }>(sql`
    WITH updated AS (
      UPDATE ${flights}
      SET
        ${sql.join(setClauses, sql`, `)}${setClauses.length ? sql`, ` : sql``}
        ${flights.version} = ${flights.version} + 1,
        ${flights.updatedAt} = NOW()
      WHERE
        ${flights.tenantId} = ${input.tenantId}
        AND ${flights.id} = ${input.id}
        AND ${flights.version} = ${input.expectedVersion}
      RETURNING *
    ), audited AS (
      INSERT INTO ${auditEvents} (
        tenant_id,
        actor_membership_id,
        action,
        entity_type,
        entity_id,
        meta
      )
      SELECT
        ${input.tenantId},
        ${input.actorMembershipId},
        ${input.action},
        'flight',
        ${input.id},
        ${auditMeta}::jsonb
      FROM updated
      RETURNING id
    )
    SELECT updated.id FROM updated INNER JOIN audited ON TRUE
  `);
  if (!result.rows[0]) return null;
  return findFlight(input.tenantId, input.id);
}

const updatableFlightColumns = {
  pilotMembershipId: flights.pilotMembershipId,
  flightNumber: flights.flightNumber,
  depIcao: flights.depIcao,
  arrIcao: flights.arrIcao,
  etd: flights.etd,
  eta: flights.eta,
  aircraftType: flights.aircraftType,
  status: flights.status,
  cancelReason: flights.cancelReason,
  declinedReason: flights.declinedReason,
  dispatcherNotes: flights.dispatcherNotes,
  assignmentRevision: flights.assignmentRevision,
  assignmentConfirmedRevision: flights.assignmentConfirmedRevision,
  assignmentConfirmedAt: flights.assignmentConfirmedAt,
  outAt: flights.outAt,
  offAt: flights.offAt,
  onAt: flights.onAt,
  inAt: flights.inAt,
} as const;

export type UpdateFlightPatch = Parameters<typeof updateFlight>[0]["patch"];

/**
 * Creates one history-linked replacement without mutating the declined source
 * and records the audit event in the same SQL command. The source predicate is
 * a compare-and-set gate, while the unique replacement lineage makes
 * concurrent retries deterministic. A zero-row result means the source was
 * stale, non-declined, unavailable, or already replaced.
 */
export async function createReplacementFlight(input: {
  tenantId: string;
  sourceFlightId: string;
  expectedVersion: number;
  actorMembershipId: string;
  scheduleRequestId: string | null;
  oldPilotMembershipId: string | null;
  pilotMembershipId: string;
  flightNumber: string;
  depIcao: string;
  arrIcao: string;
  etd: Date;
  eta: Date;
  aircraftType: string | null;
  dispatcherNotes: string | null;
  reason: string;
}): Promise<Flight | null> {
  const db = getDb();
  const replacementId = randomUUID();
  const auditMeta = JSON.stringify({
    oldAssignment: input.oldPilotMembershipId,
    newAssignment: input.pilotMembershipId,
    scheduleRequestId: input.scheduleRequestId,
    schedule: {
      flightNumber: input.flightNumber,
      depIcao: input.depIcao,
      arrIcao: input.arrIcao,
      etd: input.etd.toISOString(),
      eta: input.eta.toISOString(),
      aircraftType: input.aircraftType,
    },
    oldStatus: "declined",
    newStatus: "offered",
    replacementFlightId: replacementId,
    reason: input.reason,
  });

  const rows = await db.execute<{ id: string }>(sql`
    WITH inserted AS (
      INSERT INTO ${flights} (
        id,
        tenant_id,
        schedule_request_id,
        replaces_flight_id,
        pilot_membership_id,
        flight_number,
        dep_icao,
        arr_icao,
        etd,
        eta,
        aircraft_type,
        status,
        dispatcher_notes,
        version
      )
      SELECT
        ${replacementId},
        ${flights.tenantId},
        ${flights.scheduleRequestId},
        ${flights.id},
        ${input.pilotMembershipId},
        ${flights.flightNumber},
        ${flights.depIcao},
        ${flights.arrIcao},
        ${flights.etd},
        ${flights.eta},
        ${flights.aircraftType},
        'offered',
        ${flights.dispatcherNotes},
        1
      FROM ${flights}
      WHERE
        ${flights.tenantId} = ${input.tenantId}
        AND ${flights.id} = ${input.sourceFlightId}
        AND ${flights.status} = 'declined'
        AND ${flights.version} = ${input.expectedVersion}
      ON CONFLICT (tenant_id, replaces_flight_id) DO NOTHING
      RETURNING id
    ), audited AS (
      INSERT INTO ${auditEvents} (
        tenant_id,
        actor_membership_id,
        action,
        entity_type,
        entity_id,
        meta
      )
      SELECT
        ${input.tenantId},
        ${input.actorMembershipId},
        'flight.reoffer',
        'flight',
        ${input.sourceFlightId},
        ${auditMeta}::jsonb
      FROM inserted
      RETURNING id
    )
    SELECT inserted.id FROM inserted INNER JOIN audited ON TRUE
  `);

  if (rows.rows.length === 0) return null;
  return findFlight(input.tenantId, replacementId);
}

export async function listBoardFlights(
  tenantId: string,
  now = new Date(),
): Promise<Flight[]> {
  const db = getDb();
  const horizon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  const nextMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  );
  return db
    .select()
    .from(flights)
    .where(
      and(
        eq(flights.tenantId, tenantId),
        or(
          eq(flights.status, "active"),
          and(
            inArray(flights.status, ["accepted", "briefed"]),
            lte(flights.etd, horizon),
          ),
          and(
            eq(flights.status, "completed"),
            gte(flights.etd, monthStart),
            lt(flights.etd, nextMonth),
          ),
        )!,
      ),
    )
    .orderBy(flights.etd);
}

export async function listMonthMetricFlights(
  tenantId: string,
  monthStart: Date,
  nextMonth: Date,
): Promise<Array<Pick<Flight, "id" | "status" | "etd" | "outAt">>> {
  const db = getDb();
  return db
    .select({
      id: flights.id,
      status: flights.status,
      etd: flights.etd,
      outAt: flights.outAt,
    })
    .from(flights)
    .where(
      and(
        eq(flights.tenantId, tenantId),
        gte(flights.etd, monthStart),
        lt(flights.etd, nextMonth),
        inArray(flights.status, ["briefed", "active", "completed"]),
      ),
    );
}

export async function listTrackableFlightsForPilot(input: {
  tenantId: string;
  pilotMembershipId: string;
  from: Date;
  to: Date;
}): Promise<Flight[]> {
  const db = getDb();
  return db
    .select()
    .from(flights)
    .where(
      and(
        eq(flights.tenantId, input.tenantId),
        eq(flights.pilotMembershipId, input.pilotMembershipId),
        inArray(flights.status, ["accepted", "briefed", "active"]),
        gte(flights.etd, input.from),
        lte(flights.etd, input.to),
      ),
    )
    .orderBy(flights.etd);
}
