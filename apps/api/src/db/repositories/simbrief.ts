import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../client.js";
import { simbriefDispatches, type SimbriefDispatch } from "../schema.js";

export async function createSimbriefDispatch(input: {
  id: string;
  tenantId: string;
  flightId: string;
  createdByMembershipId: string;
  simbriefUserId?: string | null;
  staticId: string;
  callbackTokenMac?: string | null;
  request: Record<string, string>;
  status?: "prepared" | "pending";
}): Promise<SimbriefDispatch> {
  const db = getDb();
  const [created] = await db
    .insert(simbriefDispatches)
    .values({
      id: input.id,
      tenantId: input.tenantId,
      flightId: input.flightId,
      createdByMembershipId: input.createdByMembershipId,
      simbriefUserId: input.simbriefUserId ?? null,
      staticId: input.staticId,
      callbackTokenMac: input.callbackTokenMac ?? null,
      request: input.request,
      status: input.status ?? "pending",
    })
    .returning();
  return created!;
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
    .orderBy(desc(simbriefDispatches.createdAt), desc(simbriefDispatches.id));
}

export async function startSimbriefDispatch(input: {
  id: string;
  tenantId: string;
  flightId: string;
  generatedByMembershipId: string;
  simbriefUserId: string;
  callbackTokenMac: string;
  request: Record<string, string>;
}): Promise<SimbriefDispatch | null> {
  const db = getDb();
  const [updated] = await db
    .update(simbriefDispatches)
    .set({
      generatedByMembershipId: input.generatedByMembershipId,
      simbriefUserId: input.simbriefUserId,
      callbackTokenMac: input.callbackTokenMac,
      request: input.request,
      status: "pending",
      lastError: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(simbriefDispatches.tenantId, input.tenantId),
        eq(simbriefDispatches.flightId, input.flightId),
        eq(simbriefDispatches.id, input.id),
        eq(simbriefDispatches.status, "prepared"),
      ),
    )
    .returning();
  return updated ?? null;
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
    .orderBy(desc(simbriefDispatches.createdAt), desc(simbriefDispatches.id))
    .limit(1);
  return rows[0] ?? null;
}

export async function completeSimbriefDispatch(input: {
  id: string;
  ofp: Record<string, unknown>;
  simbriefRequestId: string | null;
  generatedAt: Date | null;
  syncedAt: Date;
}): Promise<SimbriefDispatch | null> {
  const db = getDb();
  const [updated] = await db
    .update(simbriefDispatches)
    .set({
      status: "ready",
      ofp: input.ofp,
      simbriefRequestId: input.simbriefRequestId,
      generatedAt: input.generatedAt,
      syncedAt: input.syncedAt,
      callbackTokenMac: null,
      lastError: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(simbriefDispatches.id, input.id),
        eq(simbriefDispatches.status, "pending"),
      ),
    )
    .returning();
  return updated ?? null;
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
