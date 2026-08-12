import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { getDb } from "../client.js";
import {
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
  title?: string | null;
  notes?: string | null;
  windowStart: Date;
  windowEnd: Date;
  desiredFlightCount: number;
  preferences?: Record<string, unknown>;
}): Promise<ScheduleRequest> {
  const db = getDb();
  const [row] = await db
    .insert(scheduleRequests)
    .values({
      tenantId: input.tenantId,
      pilotMembershipId: input.pilotMembershipId,
      title: input.title ?? null,
      notes: input.notes ?? null,
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
      desiredFlightCount: input.desiredFlightCount,
      preferences: input.preferences ?? {},
      status: "pending",
    })
    .returning();
  return row!;
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
        lt(scheduleRequests.createdAt, new Date(cursor.createdAt)),
        and(
          eq(scheduleRequests.createdAt, new Date(cursor.createdAt)),
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
          createdAt: lastItem.createdAt.toISOString(),
          id: lastItem.id,
        })
      : null;

  return { items, nextCursor };
}

export async function updateScheduleRequestStatus(
  tenantId: string,
  id: string,
  status: ScheduleRequestStatus,
  extra?: { rejectReason?: string | null },
): Promise<ScheduleRequest | null> {
  const db = getDb();
  const [row] = await db
    .update(scheduleRequests)
    .set({
      status,
      rejectReason: extra?.rejectReason,
      updatedAt: new Date(),
    })
    .where(
      and(eq(scheduleRequests.tenantId, tenantId), eq(scheduleRequests.id, id)),
    )
    .returning();
  return row ?? null;
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
