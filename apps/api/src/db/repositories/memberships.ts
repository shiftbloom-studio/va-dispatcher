import { and, eq } from "drizzle-orm";
import { getDb } from "../client.js";
import { memberships, type MemberRole, type Membership } from "../schema.js";

export async function findMembership(
  tenantId: string,
  clerkUserId: string,
): Promise<Membership | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.tenantId, tenantId),
        eq(memberships.clerkUserId, clerkUserId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function findMembershipById(
  tenantId: string,
  id: string,
): Promise<Membership | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

export async function findMembershipByCallsign(
  tenantId: string,
  pilotCallsign: string,
): Promise<Membership | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.tenantId, tenantId),
        eq(memberships.pilotCallsign, pilotCallsign),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function listMemberships(tenantId: string): Promise<Membership[]> {
  const db = getDb();
  return db
    .select()
    .from(memberships)
    .where(eq(memberships.tenantId, tenantId));
}

export async function upsertMembership(input: {
  tenantId: string;
  clerkUserId: string;
  role: MemberRole;
  displayName?: string | null;
  pilotCallsign?: string | null;
  status?: Membership["status"];
}): Promise<Membership> {
  const db = getDb();
  const existing = await findMembership(input.tenantId, input.clerkUserId);
  if (existing) {
    const [updated] = await db
      .update(memberships)
      .set({
        role: input.role,
        displayName: input.displayName ?? existing.displayName,
        pilotCallsign: input.pilotCallsign ?? existing.pilotCallsign,
        status: input.status ?? existing.status,
        updatedAt: new Date(),
      })
      .where(eq(memberships.id, existing.id))
      .returning();
    return updated!;
  }
  const [created] = await db
    .insert(memberships)
    .values({
      tenantId: input.tenantId,
      clerkUserId: input.clerkUserId,
      role: input.role,
      displayName: input.displayName ?? null,
      pilotCallsign: input.pilotCallsign ?? null,
      status: input.status ?? "active",
    })
    .returning();
  return created!;
}

export async function updateMembership(
  tenantId: string,
  id: string,
  patch: {
    role?: MemberRole;
    displayName?: string | null;
    pilotCallsign?: string | null;
    status?: Membership["status"];
  },
): Promise<Membership | null> {
  const db = getDb();
  const [updated] = await db
    .update(memberships)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.id, id)))
    .returning();
  return updated ?? null;
}
