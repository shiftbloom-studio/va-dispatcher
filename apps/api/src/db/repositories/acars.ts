import { and, desc, eq, isNull, lt, or } from "drizzle-orm";
import { getDb } from "../client.js";
import {
  acarsMessages,
  mockAcarsQueue,
  type AcarsMessage,
} from "../schema.js";
import {
  decodeCursor,
  encodeCursor,
  type PageResult,
} from "../../lib/pagination.js";

export async function insertAcarsMessage(input: {
  tenantId: string;
  direction: "inbound" | "outbound";
  msgType: AcarsMessage["msgType"];
  fromStation: string;
  toStation: string;
  body: string;
  hoppieRaw?: unknown;
  provider: "mock" | "hoppie";
  providerMessageId?: string | null;
  flightId?: string | null;
  createdByMembershipId?: string | null;
  receivedAt?: Date | null;
  sentAt?: Date | null;
}): Promise<AcarsMessage> {
  const db = getDb();
  const [row] = await db
    .insert(acarsMessages)
    .values({
      tenantId: input.tenantId,
      direction: input.direction,
      msgType: input.msgType,
      fromStation: input.fromStation,
      toStation: input.toStation,
      body: input.body,
      hoppieRaw: input.hoppieRaw ?? null,
      provider: input.provider,
      providerMessageId: input.providerMessageId ?? null,
      flightId: input.flightId ?? null,
      createdByMembershipId: input.createdByMembershipId ?? null,
      receivedAt: input.receivedAt ?? null,
      sentAt: input.sentAt ?? null,
    })
    .returning();
  return row!;
}

export async function findAcarsMessage(
  tenantId: string,
  id: string,
): Promise<AcarsMessage | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(acarsMessages)
    .where(
      and(eq(acarsMessages.tenantId, tenantId), eq(acarsMessages.id, id)),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function listAcarsMessages(input: {
  tenantId: string;
  direction?: "inbound" | "outbound";
  flightId?: string;
  station?: string;
  cursor?: string;
  limit: number;
}): Promise<PageResult<AcarsMessage>> {
  const db = getDb();
  const conditions = [eq(acarsMessages.tenantId, input.tenantId)];
  if (input.direction) {
    conditions.push(eq(acarsMessages.direction, input.direction));
  }
  if (input.flightId) {
    conditions.push(eq(acarsMessages.flightId, input.flightId));
  }
  if (input.station) {
    conditions.push(
      or(
        eq(acarsMessages.fromStation, input.station),
        eq(acarsMessages.toStation, input.station),
      )!,
    );
  }
  if (input.cursor) {
    const c = decodeCursor(input.cursor);
    conditions.push(
      or(
        lt(acarsMessages.createdAt, new Date(c.createdAt)),
        and(
          eq(acarsMessages.createdAt, new Date(c.createdAt)),
          lt(acarsMessages.id, c.id),
        ),
      )!,
    );
  }

  const rows = await db
    .select()
    .from(acarsMessages)
    .where(and(...conditions))
    .orderBy(desc(acarsMessages.createdAt), desc(acarsMessages.id))
    .limit(input.limit + 1);

  const hasMore = rows.length > input.limit;
  const items = hasMore ? rows.slice(0, input.limit) : rows;
  const last = items[items.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeCursor({
          createdAt: last.createdAt.toISOString(),
          id: last.id,
        })
      : null;

  return { items, nextCursor };
}

export async function enqueueMockAcars(input: {
  tenantId: string;
  toStation: string;
  fromStation: string;
  msgType?: AcarsMessage["msgType"];
  body: string;
}): Promise<void> {
  const db = getDb();
  await db.insert(mockAcarsQueue).values({
    tenantId: input.tenantId,
    toStation: input.toStation,
    fromStation: input.fromStation,
    msgType: input.msgType ?? "telex",
    body: input.body,
  });
}

export async function drainMockAcarsQueue(
  tenantId: string,
  toStation: string,
): Promise<
  Array<{
    id: string;
    fromStation: string;
    toStation: string;
    msgType: AcarsMessage["msgType"];
    body: string;
  }>
> {
  const db = getDb();
  const pending = await db
    .select()
    .from(mockAcarsQueue)
    .where(
      and(
        eq(mockAcarsQueue.tenantId, tenantId),
        eq(mockAcarsQueue.toStation, toStation),
        isNull(mockAcarsQueue.delivered),
      ),
    )
    .orderBy(mockAcarsQueue.createdAt)
    .limit(50);

  if (pending.length === 0) return [];

  const now = new Date();
  for (const row of pending) {
    await db
      .update(mockAcarsQueue)
      .set({ delivered: now })
      .where(eq(mockAcarsQueue.id, row.id));
  }

  return pending.map((p) => ({
    id: p.id,
    fromStation: p.fromStation,
    toStation: p.toStation,
    msgType: p.msgType,
    body: p.body,
  }));
}
