import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../client.js";
import { guard, json, ms, runAtomic } from "../atomic.js";
import {
  dispatchReleases,
  flights,
  type DispatchRelease,
  type DispatchUnit,
  type Flight,
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

/**
 * Publishes an immutable release, advances the flight revision/status, and
 * records the audit in one statement. The versioned flight update serializes
 * competing publishers and makes every new release invalidate stale plans.
 */
export async function publishDispatchReleaseAtomic(
  input: Omit<DispatchReleaseInput, "revision"> & {
    expectedFlightVersion: number;
    publishedAt: Date;
  },
): Promise<{ flight: Flight; release: DispatchRelease } | null> {
  const db = getDb();
  const releaseId = randomUUID();
  const publishedAt = ms(input.publishedAt);
  const flightAt = and(
    eq(flights.tenantId, input.tenantId),
    eq(flights.id, input.flightId),
    eq(flights.version, input.expectedFlightVersion),
    inArray(flights.status, ["accepted", "briefed"]),
  )!;

  const result = await runAtomic([
    guard(sql`EXISTS (SELECT 1 FROM ${flights} WHERE ${flightAt})`),
    guard(sql`EXISTS (
      SELECT 1
      FROM memberships actor
      WHERE actor.id = ${input.releasedByMembershipId}
        AND actor.tenant_id = ${input.tenantId}
        AND actor.role IN ('dispatcher', 'admin')
        AND actor.status = 'active'
    )`),
    sql`
      INSERT INTO dispatch_releases (
        id, tenant_id, flight_id, revision, operational_route, sid, star,
        cruise_level, alternate_icao, fuel_unit, payload_unit, taxi_fuel,
        trip_fuel, contingency_fuel, alternate_fuel, final_reserve_fuel,
        additional_fuel, block_fuel, planned_payload, weather_snapshot,
        release_notes, dispatcher_remarks, released_by_membership_id,
        released_at
      )
      SELECT ${releaseId}, ${input.tenantId}, ${input.flightId},
        coalesce((
          SELECT max(existing.revision)
          FROM dispatch_releases existing
          WHERE existing.tenant_id = ${input.tenantId}
            AND existing.flight_id = ${input.flightId}
        ), 0) + 1,
        ${input.operationalRoute}, ${input.sid ?? null}, ${input.star ?? null},
        ${input.cruiseLevel}, ${input.alternateIcao}, ${input.fuelUnit},
        ${input.payloadUnit}, ${input.taxiFuel}, ${input.tripFuel},
        ${input.contingencyFuel}, ${input.alternateFuel},
        ${input.finalReserveFuel}, ${input.additionalFuel},
        ${input.blockFuel}, ${input.plannedPayload},
        json(${json(input.weatherSnapshot)}),
        ${input.releaseNotes ?? null}, ${input.dispatcherRemarks ?? null},
        ${input.releasedByMembershipId}, ${publishedAt}
    `,
    db
      .update(flights)
      .set({
        status: "briefed",
        version: sql`${flights.version} + 1`,
        updatedAt: input.publishedAt,
      })
      .where(flightAt),
    sql`
      INSERT INTO audit_events (
        tenant_id, actor_membership_id, action, entity_type, entity_id,
        meta, created_at
      )
      SELECT release.tenant_id, ${input.releasedByMembershipId},
        'flight.release_publish', 'flight', release.flight_id,
        json_object(
          'releaseId', release.id,
          'revision', release.revision,
          'beforeVersion', flight.version - 1,
          'afterVersion', flight.version,
          'status', flight.status,
          'weatherUnavailable',
            json(${json(input.weatherSnapshot)}) -> '$.unavailable'
        ),
        ${publishedAt}
      FROM dispatch_releases release
      JOIN flights flight
        ON flight.tenant_id = release.tenant_id
       AND flight.id = release.flight_id
      WHERE release.id = ${releaseId}
    `,
  ]);
  const published = result
    ? { flight_id: input.flightId, release_id: releaseId }
    : null;
  if (!published) return null;

  const [flightRows, releaseRows] = await Promise.all([
    db
      .select()
      .from(flights)
      .where(
        and(
          eq(flights.tenantId, input.tenantId),
          eq(flights.id, published.flight_id),
        ),
      )
      .limit(1),
    db
      .select()
      .from(dispatchReleases)
      .where(
        and(
          eq(dispatchReleases.tenantId, input.tenantId),
          eq(dispatchReleases.id, published.release_id),
        ),
      )
      .limit(1),
  ]);
  const flight = flightRows[0];
  const release = releaseRows[0];
  if (!flight || !release) {
    throw new Error("Published dispatch release could not be reloaded");
  }
  return { flight, release };
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
