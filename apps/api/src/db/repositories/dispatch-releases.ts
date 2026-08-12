import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../client.js";
import {
  dispatchReleases,
  type DispatchRelease,
  type DispatchUnit,
} from "../schema.js";

export type DispatchReleaseInput = {
  tenantId: string;
  flightId: string;
  revision: number;
  operationalRoute: string;
  sid?: string | null;
  star?: string | null;
  cruiseLevel: number;
  alternateIcao: string;
  fuelUnit: DispatchUnit;
  payloadUnit: DispatchUnit;
  taxiFuel: number;
  tripFuel: number;
  contingencyFuel: number;
  alternateFuel: number;
  finalReserveFuel: number;
  additionalFuel: number;
  blockFuel: number;
  plannedPayload: number;
  weatherSnapshot: Record<string, unknown>;
  releaseNotes?: string | null;
  dispatcherRemarks?: string | null;
  releasedByMembershipId: string;
};

export async function createDispatchRelease(
  input: DispatchReleaseInput,
): Promise<DispatchRelease> {
  const db = getDb();
  const [created] = await db
    .insert(dispatchReleases)
    .values({
      ...input,
      alternateIcao: input.alternateIcao.toUpperCase(),
      sid: input.sid?.toUpperCase() ?? null,
      star: input.star?.toUpperCase() ?? null,
      releaseNotes: input.releaseNotes ?? null,
      dispatcherRemarks: input.dispatcherRemarks ?? null,
    })
    .returning();
  return created!;
}

export async function findLatestDispatchRelease(
  tenantId: string,
  flightId: string,
): Promise<DispatchRelease | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(dispatchReleases)
    .where(
      and(
        eq(dispatchReleases.tenantId, tenantId),
        eq(dispatchReleases.flightId, flightId),
      ),
    )
    .orderBy(desc(dispatchReleases.revision))
    .limit(1);
  return rows[0] ?? null;
}

export async function listDispatchReleaseRevisions(
  tenantId: string,
  flightId: string,
): Promise<DispatchRelease[]> {
  const db = getDb();
  return db
    .select()
    .from(dispatchReleases)
    .where(
      and(
        eq(dispatchReleases.tenantId, tenantId),
        eq(dispatchReleases.flightId, flightId),
      ),
    )
    .orderBy(desc(dispatchReleases.revision));
}

export async function findLatestDispatchReleases(
  tenantId: string,
  flightIds: string[],
): Promise<Map<string, DispatchRelease>> {
  if (flightIds.length === 0) return new Map();
  const db = getDb();
  const rows = await db
    .select()
    .from(dispatchReleases)
    .where(
      and(
        eq(dispatchReleases.tenantId, tenantId),
        inArray(dispatchReleases.flightId, flightIds),
      ),
    )
    .orderBy(desc(dispatchReleases.revision));

  const latest = new Map<string, DispatchRelease>();
  for (const row of rows) {
    if (!latest.has(row.flightId)) latest.set(row.flightId, row);
  }
  return latest;
}
