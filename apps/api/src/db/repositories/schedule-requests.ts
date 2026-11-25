import { randomUUID } from "node:crypto";

import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { guard, insertAudit, ms, runAtomic } from "../atomic.js";
import { getDb } from "../client.js";
import {
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
  const id = randomUUID();
  const now = new Date();
  await runAtomic([
    db.insert(scheduleRequests).values({
      id,
      tenantId: input.tenantId,
      pilotMembershipId: input.pilotMembershipId,
      title: input.title ?? null,
      notes: input.notes ?? null,
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
      desiredFlightCount: input.desiredFlightCount,
      preferences: input.preferences ?? {},
      status: "pending",
      createdAt: now,
      updatedAt: now,
    }),
    insertAudit({
      tenantId: input.tenantId,
      actorMembershipId: input.actorMembershipId,
      action: "schedule_request.create",
      entityType: "schedule_request",
      entityId: id,
      meta: {},
      createdAt: now,
    }),
  ]);
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

function requestAt(input: {
  tenantId: string;
  id: string;
  expectedVersion: number;
  expectedStatus: ScheduleRequestStatus;
}) {
  return and(
    eq(scheduleRequests.tenantId, input.tenantId),
    eq(scheduleRequests.id, input.id),
    eq(scheduleRequests.version, input.expectedVersion),
    eq(scheduleRequests.status, input.expectedStatus),
  )!;
}

function requestAtGuard(input: Parameters<typeof requestAt>[0]) {
  return guard(
    sql`EXISTS (SELECT 1 FROM ${scheduleRequests} WHERE ${requestAt(input)})`,
  );
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
  const now = new Date();
  const result = await runAtomic([
    requestAtGuard(input),
    // Editing is only allowed while no live flight references the request.
    guard(sql`NOT EXISTS (
      SELECT 1
      FROM ${flights}
      WHERE
        ${flights.tenantId} = ${input.tenantId}
        AND ${flights.scheduleRequestId} = ${input.id}
        AND ${flights.status} <> 'cancelled'
    )`),
    db
      .update(scheduleRequests)
      .set({
        title: input.patch.title,
        notes: input.patch.notes,
        windowStart: input.patch.windowStart,
        windowEnd: input.patch.windowEnd,
        desiredFlightCount: input.patch.desiredFlightCount,
        preferences: input.patch.preferences,
        version: sql`${scheduleRequests.version} + 1`,
        updatedAt: now,
      })
      .where(requestAt(input)),
    insertAudit({
      tenantId: input.tenantId,
      actorMembershipId: input.actorMembershipId,
      action: input.action,
      entityType: "schedule_request",
      entityId: input.id,
      meta: input.auditMeta,
      createdAt: now,
    }),
  ]);
  if (!result) return null;
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
  const now = new Date();
  const result = await runAtomic([
    requestAtGuard(input),
    db
      .update(scheduleRequests)
      .set({
        status: input.status,
        ...(input.status === "rejected"
          ? { rejectReason: input.reason ?? null }
          : {}),
        version: sql`${scheduleRequests.version} + 1`,
        updatedAt: now,
      })
      .where(requestAt(input)),
    insertAudit({
      tenantId: input.tenantId,
      actorMembershipId: input.actorMembershipId,
      action: input.action,
      entityType: "schedule_request",
      entityId: input.id,
      meta: input.auditMeta,
      createdAt: now,
    }),
  ]);
  if (!result) return null;
  return findScheduleRequest(input.tenantId, input.id);
}

export type LinkedFlightCancellationAction = "keep" | "cancel_predeparture";

const PREDEPARTURE_FLIGHT_STATUSES = [
  "draft",
  "offered",
  "accepted",
  "briefed",
] as const;

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
  const now = new Date();
  const reason = input.reason?.trim() || null;
  const cancelReason = reason ?? "Schedule request cancelled";
  const requestAuditMeta = {
    from: input.expectedStatus,
    to: "cancelled",
    fromVersion: input.expectedVersion,
    toVersion: input.expectedVersion + 1,
    reason: reason ?? undefined,
    linkedFlightAction: input.linkedFlightAction,
    linkedFlightPolicy:
      input.linkedFlightAction === "cancel_predeparture"
        ? "cancel draft, offered, accepted, and briefed; preserve active and terminal flights"
        : "preserve every linked flight",
  };
  const linkedPredeparture = and(
    eq(flights.tenantId, input.tenantId),
    eq(flights.scheduleRequestId, input.id),
    inArray(flights.status, [...PREDEPARTURE_FLIGHT_STATUSES]),
  )!;
  const flightStatements =
    input.linkedFlightAction === "cancel_predeparture"
      ? [
          // Audit first so the pre-cancellation status and version are read
          // from the same transaction that cancels the flights.
          sql`
            INSERT INTO audit_events (
              tenant_id, actor_membership_id, action, entity_type, entity_id,
              meta, created_at
            )
            SELECT
              ${input.tenantId},
              ${input.actorMembershipId},
              'flight.cancelled',
              'flight',
              ${flights.id},
              json_object(
                'from', ${flights.status},
                'to', 'cancelled',
                'fromVersion', ${flights.version},
                'toVersion', ${flights.version} + 1,
                'reason', ${reason},
                'source', 'schedule_request_cancellation',
                'scheduleRequestId', ${input.id}
              ),
              ${ms(now)}
            FROM ${flights}
            WHERE ${linkedPredeparture}
          `,
          db
            .update(flights)
            .set({
              status: "cancelled",
              cancelReason,
              version: sql`${flights.version} + 1`,
              updatedAt: now,
            })
            .where(linkedPredeparture),
        ]
      : [];
  const result = await runAtomic([
    requestAtGuard(input),
    db
      .update(scheduleRequests)
      .set({
        status: "cancelled",
        cancelReason: reason,
        version: sql`${scheduleRequests.version} + 1`,
        updatedAt: now,
      })
      .where(requestAt(input)),
    insertAudit({
      tenantId: input.tenantId,
      actorMembershipId: input.actorMembershipId,
      action: "schedule_request.cancelled",
      entityType: "schedule_request",
      entityId: input.id,
      meta: requestAuditMeta,
      createdAt: now,
    }),
    ...flightStatements,
  ]);
  if (!result) return null;
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
      count: sql<number>`count(*)`,
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
