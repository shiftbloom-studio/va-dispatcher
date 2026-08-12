import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { getDb } from "../client.js";
import {
  auditEvents,
  flights,
  scheduleRequests,
  type ScheduleRequest,
  type ScheduleRequestStatus,
} from "../schema.js";
import {
  decodeCursor,
  encodeCursor,
  type PageResult,
} from "../../lib/pagination.js";

export async function createScheduleRequest(input: {
  tenantId: string;
  pilotMembershipId: string;
  actorMembershipId: string;
  title?: string | null;
  notes?: string | null;
  windowStart: Date;
  windowEnd: Date;
  desiredFlightCount: number;
  preferences?: Record<string, unknown>;
}): Promise<ScheduleRequest> {
  const db = getDb();
  const result = await db.execute<{ id: string }>(sql`
    WITH inserted AS (
      INSERT INTO ${scheduleRequests} (
        tenant_id,
        pilot_membership_id,
        title,
        notes,
        window_start,
        window_end,
        desired_flight_count,
        preferences,
        status
      )
      VALUES (
        ${input.tenantId},
        ${input.pilotMembershipId},
        ${input.title ?? null},
        ${input.notes ?? null},
        ${sql.param(input.windowStart, scheduleRequests.windowStart)},
        ${sql.param(input.windowEnd, scheduleRequests.windowEnd)},
        ${input.desiredFlightCount},
        ${JSON.stringify(input.preferences ?? {})}::jsonb,
        'pending'
      )
      RETURNING ${scheduleRequests.id}
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
        'schedule_request.create',
        'schedule_request',
        inserted.id,
        '{}'::jsonb
      FROM inserted
      RETURNING id
    )
    SELECT inserted.id FROM inserted INNER JOIN audited ON TRUE
  `);
  const id = result.rows[0]?.id;
  if (!id) {
    throw new Error("Schedule request creation did not return an audited row");
  }
  const created = await findScheduleRequest(input.tenantId, id);
  if (!created) {
    throw new Error("Created schedule request could not be reloaded");
  }
  return created;
}

export async function findScheduleRequest(
  tenantId: string,
  id: string,
): Promise<ScheduleRequest | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(scheduleRequests)
    .where(
      and(eq(scheduleRequests.tenantId, tenantId), eq(scheduleRequests.id, id)),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function updateScheduleRequest(input: {
  tenantId: string;
  id: string;
  expectedVersion: number;
  expectedStatus: ScheduleRequestStatus;
  actorMembershipId: string;
  action: string;
  auditMeta: Record<string, unknown>;
  patch: {
    title: string | null;
    notes: string | null;
    windowStart: Date;
    windowEnd: Date;
    desiredFlightCount: number;
    preferences: Record<string, unknown>;
  };
}): Promise<ScheduleRequest | null> {
  const db = getDb();
  const auditMeta = JSON.stringify(input.auditMeta);
  const result = await db.execute<{ id: string }>(sql`
    WITH updated AS (
      UPDATE ${scheduleRequests}
      SET
        ${sql.identifier(scheduleRequests.title.name)} = ${input.patch.title},
        ${sql.identifier(scheduleRequests.notes.name)} = ${input.patch.notes},
        ${sql.identifier(scheduleRequests.windowStart.name)} = ${sql.param(input.patch.windowStart, scheduleRequests.windowStart)},
        ${sql.identifier(scheduleRequests.windowEnd.name)} = ${sql.param(input.patch.windowEnd, scheduleRequests.windowEnd)},
        ${sql.identifier(scheduleRequests.desiredFlightCount.name)} = ${input.patch.desiredFlightCount},
        ${sql.identifier(scheduleRequests.preferences.name)} = ${JSON.stringify(input.patch.preferences)}::jsonb,
        ${sql.identifier(scheduleRequests.version.name)} = ${scheduleRequests.version} + 1,
        ${sql.identifier(scheduleRequests.updatedAt.name)} = NOW()
      WHERE
        ${scheduleRequests.tenantId} = ${input.tenantId}
        AND ${scheduleRequests.id} = ${input.id}
        AND ${scheduleRequests.version} = ${input.expectedVersion}
        AND ${scheduleRequests.status} = ${input.expectedStatus}
        AND NOT EXISTS (
          SELECT 1
          FROM ${flights}
          WHERE
            ${flights.tenantId} = ${input.tenantId}
            AND ${flights.scheduleRequestId} = ${input.id}
            AND ${flights.status} <> 'cancelled'
        )
      RETURNING ${scheduleRequests.id}
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
        'schedule_request',
        ${input.id},
        ${auditMeta}::jsonb
      FROM updated
      RETURNING id
    )
    SELECT updated.id FROM updated INNER JOIN audited ON TRUE
  `);
  if (!result.rows[0]) return null;
  return findScheduleRequest(input.tenantId, input.id);
}

export async function transitionScheduleRequest(input: {
  tenantId: string;
  id: string;
  expectedVersion: number;
  expectedStatus: ScheduleRequestStatus;
  status: ScheduleRequestStatus;
  actorMembershipId: string;
  action: string;
  reason?: string;
  auditMeta: Record<string, unknown>;
}): Promise<ScheduleRequest | null> {
  const db = getDb();
  const auditMeta = JSON.stringify(input.auditMeta);
  const result = await db.execute<{ id: string }>(sql`
    WITH updated AS (
      UPDATE ${scheduleRequests}
      SET
        ${sql.identifier(scheduleRequests.status.name)} = ${input.status},
        ${sql.identifier(scheduleRequests.rejectReason.name)} = ${input.status === "rejected" ? (input.reason ?? null) : scheduleRequests.rejectReason},
        ${sql.identifier(scheduleRequests.version.name)} = ${scheduleRequests.version} + 1,
        ${sql.identifier(scheduleRequests.updatedAt.name)} = NOW()
      WHERE
        ${scheduleRequests.tenantId} = ${input.tenantId}
        AND ${scheduleRequests.id} = ${input.id}
        AND ${scheduleRequests.version} = ${input.expectedVersion}
        AND ${scheduleRequests.status} = ${input.expectedStatus}
      RETURNING ${scheduleRequests.id}
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
        'schedule_request',
        ${input.id},
        ${auditMeta}::jsonb
      FROM updated
      RETURNING id
    )
    SELECT updated.id FROM updated INNER JOIN audited ON TRUE
  `);
  if (!result.rows[0]) return null;
  return findScheduleRequest(input.tenantId, input.id);
}

export type LinkedFlightCancellationAction = "keep" | "cancel_predeparture";

export async function cancelScheduleRequest(input: {
  tenantId: string;
  id: string;
  expectedVersion: number;
  expectedStatus: ScheduleRequestStatus;
  actorMembershipId: string;
  linkedFlightAction: LinkedFlightCancellationAction;
  reason?: string;
}): Promise<ScheduleRequest | null> {
  const db = getDb();
  const cancelReason = input.reason?.trim() || "Schedule request cancelled";
  const requestAuditMeta = JSON.stringify({
    from: input.expectedStatus,
    to: "cancelled",
    fromVersion: input.expectedVersion,
    toVersion: input.expectedVersion + 1,
    reason: input.reason?.trim() || undefined,
    linkedFlightAction: input.linkedFlightAction,
    linkedFlightPolicy:
      input.linkedFlightAction === "cancel_predeparture"
        ? "cancel draft, offered, accepted, and briefed; preserve active and terminal flights"
        : "preserve every linked flight",
  });
  const shouldCancelFlights =
    input.linkedFlightAction === "cancel_predeparture";
  const result = await db.execute<{ id: string }>(sql`
    WITH request_updated AS (
      UPDATE ${scheduleRequests}
      SET
        ${sql.identifier(scheduleRequests.status.name)} = 'cancelled',
        ${sql.identifier(scheduleRequests.cancelReason.name)} = ${input.reason?.trim() || null},
        ${sql.identifier(scheduleRequests.version.name)} = ${scheduleRequests.version} + 1,
        ${sql.identifier(scheduleRequests.updatedAt.name)} = NOW()
      WHERE
        ${scheduleRequests.tenantId} = ${input.tenantId}
        AND ${scheduleRequests.id} = ${input.id}
        AND ${scheduleRequests.version} = ${input.expectedVersion}
        AND ${scheduleRequests.status} = ${input.expectedStatus}
      RETURNING ${scheduleRequests.id}
    ), eligible_flights AS (
      SELECT
        ${flights.id} AS id,
        ${flights.status} AS from_status,
        ${flights.version} AS from_version
      FROM ${flights}
      INNER JOIN request_updated ON TRUE
      WHERE
        ${shouldCancelFlights}
        AND ${flights.tenantId} = ${input.tenantId}
        AND ${flights.scheduleRequestId} = ${input.id}
        AND ${flights.status} IN ('draft', 'offered', 'accepted', 'briefed')
      FOR UPDATE OF ${flights}
    ), cancelled_flights AS (
      UPDATE ${flights}
      SET
        ${sql.identifier(flights.status.name)} = 'cancelled',
        ${sql.identifier(flights.cancelReason.name)} = ${cancelReason},
        ${sql.identifier(flights.version.name)} = ${flights.version} + 1,
        ${sql.identifier(flights.updatedAt.name)} = NOW()
      FROM eligible_flights
      WHERE
        ${flights.tenantId} = ${input.tenantId}
        AND ${flights.id} = eligible_flights.id
      RETURNING
        ${flights.id},
        eligible_flights.from_status,
        eligible_flights.from_version,
        ${flights.version} AS to_version
    ), request_audited AS (
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
        'schedule_request.cancelled',
        'schedule_request',
        ${input.id},
        ${requestAuditMeta}::jsonb
      FROM request_updated
      RETURNING id
    ), flights_audited AS (
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
        'flight.cancelled',
        'flight',
        cancelled_flights.id,
        jsonb_build_object(
          'from', cancelled_flights.from_status,
          'to', 'cancelled',
          'fromVersion', cancelled_flights.from_version,
          'toVersion', cancelled_flights.to_version,
          'reason', ${input.reason?.trim() || null}::text,
          'source', 'schedule_request_cancellation',
          'scheduleRequestId', ${input.id}::uuid
        )
      FROM cancelled_flights
      RETURNING id
    ), cancelled_totals AS (
      SELECT count(*)::integer AS count FROM cancelled_flights
    ), audit_totals AS (
      SELECT count(*)::integer AS count FROM flights_audited
    )
    SELECT request_updated.id
    FROM request_updated
    INNER JOIN request_audited ON TRUE
    INNER JOIN cancelled_totals ON TRUE
    INNER JOIN audit_totals
      ON audit_totals.count = cancelled_totals.count
  `);
  if (!result.rows[0]) return null;
  return findScheduleRequest(input.tenantId, input.id);
}

export async function listScheduleRequests(input: {
  tenantId: string;
  pilotMembershipId?: string;
  status?: ScheduleRequestStatus;
  cursor?: string;
  limit: number;
}): Promise<PageResult<ScheduleRequest>> {
  const db = getDb();
  const conditions = [eq(scheduleRequests.tenantId, input.tenantId)];
  if (input.pilotMembershipId) {
    conditions.push(
      eq(scheduleRequests.pilotMembershipId, input.pilotMembershipId),
    );
  }
  if (input.status) {
    conditions.push(eq(scheduleRequests.status, input.status));
  }
  if (input.cursor) {
    const cursor = decodeCursor(input.cursor);
    conditions.push(
      or(
        lt(scheduleRequests.createdAt, new Date(cursor.sortAt)),
        and(
          eq(scheduleRequests.createdAt, new Date(cursor.sortAt)),
          lt(scheduleRequests.id, cursor.id),
        ),
      )!,
    );
  }

  const rows = await db
    .select()
    .from(scheduleRequests)
    .where(and(...conditions))
    .orderBy(desc(scheduleRequests.createdAt), desc(scheduleRequests.id))
    .limit(input.limit + 1);

  const hasMore = rows.length > input.limit;
  const items = hasMore ? rows.slice(0, input.limit) : rows;
  const lastItem = items.at(-1);
  const nextCursor =
    hasMore && lastItem
      ? encodeCursor({
          sortAt: lastItem.createdAt.toISOString(),
          id: lastItem.id,
        })
      : null;

  return { items, nextCursor };
}

export async function countScheduleRequestsByStatus(
  tenantId: string,
): Promise<Record<string, number>> {
  const db = getDb();
  const rows = await db
    .select({
      status: scheduleRequests.status,
      count: sql<number>`count(*)::int`,
    })
    .from(scheduleRequests)
    .where(eq(scheduleRequests.tenantId, tenantId))
    .groupBy(scheduleRequests.status);

  const countsByStatus: Record<string, number> = {};
  for (const row of rows) {
    countsByStatus[row.status] = row.count;
  }
  return countsByStatus;
}
