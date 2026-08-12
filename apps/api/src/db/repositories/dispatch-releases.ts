import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../client.js";
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
  const publishedAt = input.publishedAt.toISOString();
  const result = await db.execute<{
    flight_id: string;
    release_id: string;
  }>(sql`
    WITH updated_flight AS (
      UPDATE flights flight
      SET status = 'briefed',
          version = flight.version + 1,
          updated_at = ${publishedAt}::timestamptz
      WHERE flight.id = ${input.flightId}::uuid
        AND flight.tenant_id = ${input.tenantId}::uuid
        AND flight.version = ${input.expectedFlightVersion}
        AND flight.status IN ('accepted', 'briefed')
        AND EXISTS (
          SELECT 1
          FROM memberships actor
          WHERE actor.id = ${input.releasedByMembershipId}::uuid
            AND actor.tenant_id = flight.tenant_id
            AND actor.role IN ('dispatcher', 'admin')
            AND actor.status = 'active'
        )
      RETURNING flight.id, flight.tenant_id, flight.version, flight.status
    ),
    next_revision AS (
      SELECT updated.id AS flight_id,
             updated.tenant_id,
             updated.version,
             updated.status,
             COALESCE(MAX(existing.revision), 0)::integer + 1 AS revision
      FROM updated_flight updated
      LEFT JOIN dispatch_releases existing
        ON existing.tenant_id = updated.tenant_id
       AND existing.flight_id = updated.id
      GROUP BY updated.id, updated.tenant_id, updated.version,
               updated.status
    ),
    inserted_release AS (
      INSERT INTO dispatch_releases (
        id, tenant_id, flight_id, revision, operational_route, sid, star,
        cruise_level, alternate_icao, fuel_unit, payload_unit, taxi_fuel,
        trip_fuel, contingency_fuel, alternate_fuel, final_reserve_fuel,
        additional_fuel, block_fuel, planned_payload, weather_snapshot,
        release_notes, dispatcher_remarks, released_by_membership_id,
        released_at
      )
      SELECT ${releaseId}::uuid, next.tenant_id, next.flight_id,
             next.revision, ${input.operationalRoute}, ${input.sid ?? null},
             ${input.star ?? null}, ${input.cruiseLevel},
             ${input.alternateIcao}, ${input.fuelUnit}::dispatch_unit,
             ${input.payloadUnit}::dispatch_unit, ${input.taxiFuel},
             ${input.tripFuel}, ${input.contingencyFuel},
             ${input.alternateFuel}, ${input.finalReserveFuel},
             ${input.additionalFuel}, ${input.blockFuel},
             ${input.plannedPayload},
             ${JSON.stringify(input.weatherSnapshot)}::jsonb,
             ${input.releaseNotes ?? null},
             ${input.dispatcherRemarks ?? null},
             ${input.releasedByMembershipId}::uuid,
             ${publishedAt}::timestamptz
      FROM next_revision next
      RETURNING id, tenant_id, flight_id, revision
    ),
    inserted_audit AS (
      INSERT INTO audit_events (
        tenant_id, actor_membership_id, action, entity_type, entity_id,
        meta, created_at
      )
      SELECT release.tenant_id, ${input.releasedByMembershipId}::uuid,
             'flight.release_publish', 'flight', release.flight_id::text,
             jsonb_build_object(
               'releaseId', release.id,
               'revision', release.revision,
               'beforeVersion', next.version - 1,
               'afterVersion', next.version,
               'status', next.status,
               'weatherUnavailable',
                 ${JSON.stringify(input.weatherSnapshot)}::jsonb -> 'unavailable'
             ),
             ${publishedAt}::timestamptz
      FROM inserted_release release
      JOIN next_revision next ON next.flight_id = release.flight_id
      RETURNING id
    )
    SELECT release.flight_id, release.id AS release_id
    FROM inserted_release release
    JOIN inserted_audit audit ON TRUE
  `);
  const published = result.rows[0];
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
