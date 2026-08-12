import { and, desc, eq, gte, lt, lte, or } from "drizzle-orm";
import { getDb } from "../client.js";
import { auditEvents, memberships } from "../schema.js";
import {
  decodeCursor,
  encodeCursor,
  type PageResult,
} from "../../lib/pagination.js";

export async function writeAudit(input: {
  tenantId: string;
  actorMembershipId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  meta?: Record<string, unknown>;
}): Promise<void> {
  const db = getDb();
  await db.insert(auditEvents).values({
    tenantId: input.tenantId,
    actorMembershipId: input.actorMembershipId ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    meta: input.meta ?? {},
  });
}

export type AuditEventListItem = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  meta: Record<string, unknown>;
  createdAt: Date;
  actor: {
    membershipId: string;
    displayName: string | null;
    pilotCallsign: string | null;
  } | null;
};

export type AuditEventFilters = {
  action?: string;
  entityType?: string;
  actorMembershipId?: string;
  from?: Date;
  to?: Date;
};

export async function listAuditEvents(input: {
  tenantId: string;
  filters: AuditEventFilters;
  cursor?: string;
  limit: number;
}): Promise<PageResult<AuditEventListItem>> {
  const db = getDb();
  const conditions = [eq(auditEvents.tenantId, input.tenantId)];
  if (input.filters.action) {
    conditions.push(eq(auditEvents.action, input.filters.action));
  }
  if (input.filters.entityType) {
    conditions.push(eq(auditEvents.entityType, input.filters.entityType));
  }
  if (input.filters.actorMembershipId) {
    conditions.push(
      eq(auditEvents.actorMembershipId, input.filters.actorMembershipId),
    );
  }
  if (input.filters.from) {
    conditions.push(gte(auditEvents.createdAt, input.filters.from));
  }
  if (input.filters.to) {
    conditions.push(lte(auditEvents.createdAt, input.filters.to));
  }
  if (input.cursor) {
    const cursor = decodeCursor(input.cursor);
    conditions.push(
      or(
        lt(auditEvents.createdAt, new Date(cursor.createdAt)),
        and(
          eq(auditEvents.createdAt, new Date(cursor.createdAt)),
          lt(auditEvents.id, cursor.id),
        ),
      )!,
    );
  }

  const rows = await db
    .select({
      id: auditEvents.id,
      action: auditEvents.action,
      entityType: auditEvents.entityType,
      entityId: auditEvents.entityId,
      meta: auditEvents.meta,
      createdAt: auditEvents.createdAt,
      actorMembershipId: auditEvents.actorMembershipId,
      actorDisplayName: memberships.displayName,
      actorPilotCallsign: memberships.pilotCallsign,
    })
    .from(auditEvents)
    .leftJoin(
      memberships,
      and(
        eq(memberships.id, auditEvents.actorMembershipId),
        eq(memberships.tenantId, input.tenantId),
      ),
    )
    .where(and(...conditions))
    .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
    .limit(input.limit + 1);

  const hasMore = rows.length > input.limit;
  const pageRows = hasMore ? rows.slice(0, input.limit) : rows;
  const items = pageRows.map((row) => ({
    id: row.id,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    meta: row.meta,
    createdAt: row.createdAt,
    actor: row.actorMembershipId
      ? {
          membershipId: row.actorMembershipId,
          displayName: row.actorDisplayName,
          pilotCallsign: row.actorPilotCallsign,
        }
      : null,
  }));
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
