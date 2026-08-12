import { eq } from "drizzle-orm";
import { getDb } from "../client.js";
import { tenants, type Tenant } from "../schema.js";

export async function findTenantByClerkOrgId(
  clerkOrgId: string,
): Promise<Tenant | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(tenants)
    .where(eq(tenants.clerkOrgId, clerkOrgId))
    .limit(1);
  return rows[0] ?? null;
}

export async function findTenantById(id: string): Promise<Tenant | null> {
  const db = getDb();
  const rows = await db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function findTenantBySlug(slug: string): Promise<Tenant | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(tenants)
    .where(eq(tenants.slug, slug))
    .limit(1);
  return rows[0] ?? null;
}

export async function listTenants(): Promise<Tenant[]> {
  const db = getDb();
  return db.select().from(tenants);
}

export async function upsertTenantBySlug(input: {
  slug: string;
  name: string;
  clerkOrgId: string;
  hoppieStation?: string | null;
}): Promise<Tenant> {
  const db = getDb();
  const existing = await findTenantBySlug(input.slug);
  if (existing) {
    const [updated] = await db
      .update(tenants)
      .set({
        name: input.name,
        clerkOrgId: input.clerkOrgId,
        hoppieStation: input.hoppieStation ?? existing.hoppieStation,
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, existing.id))
      .returning();
    return updated!;
  }
  const [created] = await db
    .insert(tenants)
    .values({
      slug: input.slug,
      name: input.name,
      clerkOrgId: input.clerkOrgId,
      hoppieStation: input.hoppieStation ?? "VSAS",
    })
    .returning();
  return created!;
}

export async function updateTenant(
  tenantId: string,
  patch: {
    name?: string;
    settings?: Record<string, unknown>;
    hoppieStation?: string | null;
    hoppieLogonEnc?: string | null;
  },
): Promise<Tenant | null> {
  const db = getDb();
  const [updated] = await db
    .update(tenants)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(tenants.id, tenantId))
    .returning();
  return updated ?? null;
}
