import { randomUUID } from "node:crypto";

import { and, desc, eq, gte, inArray, lt, lte, or, sql } from "drizzle-orm";
import { getDb } from "../client.js";
import {
  auditEvents,
  flights,
  type Flight,
  type FlightStatus,
} from "../schema.js";
import {
  decodeCursor,
  encodeCursor,
  type PageResult,
} from "../../lib/pagination.js";

export type CreateFlightInput = {
  tenantId: string;
  scheduleRequestId?: string | null;
  replacesFlightId?: string | null;
  pilotMembershipId?: string | null;
  flightNumber: string;
  depIcao: string;
  arrIcao: string;
  etd: Date;
  eta: Date;
  aircraftType?: string | null;
  status?: FlightStatus;
  dispatcherNotes?: string | null;
};

export async function createFlight(input: CreateFlightInput): Promise<Flight> {
  const db = getDb();
  const [row] = await db
    .insert(flights)
    .values({
      tenantId: input.tenantId,
      scheduleRequestId: input.scheduleRequestId ?? null,
      replacesFlightId: input.replacesFlightId ?? null,
      pilotMembershipId: input.pilotMembershipId ?? null,
      flightNumber: input.flightNumber,
      depIcao: input.depIcao.toUpperCase(),
      arrIcao: input.arrIcao.toUpperCase(),
      etd: input.etd,
      eta: input.eta,
      aircraftType: input.aircraftType ?? null,
      status: input.status ?? "draft",
      dispatcherNotes: input.dispatcherNotes ?? null,
    })
    .returning();
  return row!;
}

export async function createFlights(
  items: CreateFlightInput[],
): Promise<Flight[]> {
  if (items.length === 0) return [];
  const db = getDb();
  const rows = await db
    .insert(flights)
    .values(
      items.map((input) => ({
        tenantId: input.tenantId,
        scheduleRequestId: input.scheduleRequestId ?? null,
        replacesFlightId: input.replacesFlightId ?? null,
        pilotMembershipId: input.pilotMembershipId ?? null,
        flightNumber: input.flightNumber,
        depIcao: input.depIcao.toUpperCase(),
        arrIcao: input.arrIcao.toUpperCase(),
        etd: input.etd,
        eta: input.eta,
        aircraftType: input.aircraftType ?? null,
        status: input.status ?? "draft",
        dispatcherNotes: input.dispatcherNotes ?? null,
      })),
    )
    .returning();
  return rows;
}

export async function findFlight(
  tenantId: string,
  id: string,
): Promise<Flight | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(flights)
    .where(and(eq(flights.tenantId, tenantId), eq(flights.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

export async function findReplacementFlight(
  tenantId: string,
  sourceFlightId: string,
): Promise<Flight | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(flights)
    .where(
      and(
        eq(flights.tenantId, tenantId),
        eq(flights.replacesFlightId, sourceFlightId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function listFlights(input: {
  tenantId: string;
  pilotMembershipId?: string;
  status?: FlightStatus | FlightStatus[];
  fromEtd?: Date;
  toEtd?: Date;
  scheduleRequestId?: string;
  cursor?: string;
  limit: number;
}): Promise<PageResult<Flight>> {
  const db = getDb();
  const conditions = [eq(flights.tenantId, input.tenantId)];

  if (input.pilotMembershipId) {
    conditions.push(eq(flights.pilotMembershipId, input.pilotMembershipId));
  }
  if (input.scheduleRequestId) {
    conditions.push(eq(flights.scheduleRequestId, input.scheduleRequestId));
  }
  if (input.status) {
    if (Array.isArray(input.status)) {
      conditions.push(inArray(flights.status, input.status));
    } else {
      conditions.push(eq(flights.status, input.status));
    }
  }
  if (input.fromEtd) {
    conditions.push(gte(flights.etd, input.fromEtd));
  }
  if (input.toEtd) {
    conditions.push(lte(flights.etd, input.toEtd));
  }
  if (input.cursor) {
    const cursor = decodeCursor(input.cursor);
    const cursorTimestamp = new Date(cursor.sortAt);
    conditions.push(
      cursor.legacy
        ? or(
            lt(flights.createdAt, cursorTimestamp),
            and(
              eq(flights.createdAt, cursorTimestamp),
              lt(flights.id, cursor.id),
            ),
          )!
        : or(
            lt(flights.etd, cursorTimestamp),
            and(eq(flights.etd, cursorTimestamp), lt(flights.id, cursor.id)),
          )!,
    );
  }

  const rows = await db
    .select()
    .from(flights)
    .where(and(...conditions))
    .orderBy(desc(flights.etd), desc(flights.id))
    .limit(input.limit + 1);

  const hasMore = rows.length > input.limit;
  const items = hasMore ? rows.slice(0, input.limit) : rows;
  const lastItem = items.at(-1);
  const nextCursor =
    hasMore && lastItem
      ? encodeCursor({
          sortAt: lastItem.etd.toISOString(),
          id: lastItem.id,
        })
      : null;

  return { items, nextCursor };
}

export async function updateFlight(input: {
  tenantId: string;
  id: string;
  expectedVersion: number;
  actorMembershipId: string | null;
  action: string;
  auditMeta: Record<string, unknown>;
  patch: Partial<{
    pilotMembershipId: string | null;
    flightNumber: string;
    depIcao: string;
    arrIcao: string;
    etd: Date;
    eta: Date;
    aircraftType: string | null;
    status: FlightStatus;
    cancelReason: string | null;
    declinedReason: string | null;
    dispatcherNotes: string | null;
    assignmentRevision: number;
    assignmentConfirmedRevision: number | null;
    assignmentConfirmedAt: Date | null;
    outAt: Date | null;
    offAt: Date | null;
    onAt: Date | null;
    inAt: Date | null;
  }>;
}): Promise<Flight | null> {
  const db = getDb();
  const normalized = { ...input.patch };
  if (normalized.depIcao) normalized.depIcao = normalized.depIcao.toUpperCase();
  if (normalized.arrIcao) normalized.arrIcao = normalized.arrIcao.toUpperCase();
  const setClauses = Object.entries(normalized).map(([field, value]) => {
    const column =
      updatableFlightColumns[field as keyof typeof updatableFlightColumns];
    if (!column) throw new Error(`Unsupported flight update field: ${field}`);
    return sql`${column} = ${value}`;
  });
  const auditMeta = JSON.stringify(input.auditMeta);
  const result = await db.execute<{ id: string }>(sql`
    WITH updated AS (
      UPDATE ${flights}
      SET
        ${sql.join(setClauses, sql`, `)}${setClauses.length ? sql`, ` : sql``}
        ${flights.version} = ${flights.version} + 1,
        ${flights.updatedAt} = NOW()
      WHERE
        ${flights.tenantId} = ${input.tenantId}
        AND ${flights.id} = ${input.id}
        AND ${flights.version} = ${input.expectedVersion}
      RETURNING *
    ), audited AS (
      INSERT INTO ${auditEvents} (
        tenant_id,
        actor_membership_id,
        action,
        entity_type,
        entity_id,
        meta
      )
      SELECT
        ${input.tenantId},
        ${input.actorMembershipId},
        ${input.action},
        'flight',
        ${input.id},
        ${auditMeta}::jsonb
      FROM updated
      RETURNING id
    )
    SELECT updated.id FROM updated INNER JOIN audited ON TRUE
  `);
  if (!result.rows[0]) return null;
  return findFlight(input.tenantId, input.id);
}

const updatableFlightColumns = {
  pilotMembershipId: flights.pilotMembershipId,
  flightNumber: flights.flightNumber,
  depIcao: flights.depIcao,
  arrIcao: flights.arrIcao,
  etd: flights.etd,
  eta: flights.eta,
  aircraftType: flights.aircraftType,
  status: flights.status,
  cancelReason: flights.cancelReason,
  declinedReason: flights.declinedReason,
  dispatcherNotes: flights.dispatcherNotes,
  assignmentRevision: flights.assignmentRevision,
  assignmentConfirmedRevision: flights.assignmentConfirmedRevision,
  assignmentConfirmedAt: flights.assignmentConfirmedAt,
  outAt: flights.outAt,
  offAt: flights.offAt,
  onAt: flights.onAt,
  inAt: flights.inAt,
} as const;

export type UpdateFlightPatch = Parameters<typeof updateFlight>[0]["patch"];

/**
 * Creates one history-linked replacement without mutating the declined source
 * and records the audit event in the same SQL command. The source predicate is
 * a compare-and-set gate, while the unique replacement lineage makes
 * concurrent retries deterministic. A zero-row result means the source was
 * stale, non-declined, unavailable, or already replaced.
 */
export async function createReplacementFlight(input: {
  tenantId: string;
  sourceFlightId: string;
  expectedVersion: number;
  actorMembershipId: string;
  scheduleRequestId: string | null;
  oldPilotMembershipId: string | null;
  pilotMembershipId: string;
  flightNumber: string;
  depIcao: string;
  arrIcao: string;
  etd: Date;
  eta: Date;
  aircraftType: string | null;
  dispatcherNotes: string | null;
  reason: string;
}): Promise<Flight | null> {
  const db = getDb();
  const replacementId = randomUUID();
  const auditMeta = JSON.stringify({
    oldAssignment: input.oldPilotMembershipId,
    newAssignment: input.pilotMembershipId,
    scheduleRequestId: input.scheduleRequestId,
    schedule: {
      flightNumber: input.flightNumber,
      depIcao: input.depIcao,
      arrIcao: input.arrIcao,
      etd: input.etd.toISOString(),
      eta: input.eta.toISOString(),
      aircraftType: input.aircraftType,
    },
    oldStatus: "declined",
    newStatus: "offered",
    replacementFlightId: replacementId,
    reason: input.reason,
  });

  const rows = await db.execute<{ id: string }>(sql`
    WITH inserted AS (
      INSERT INTO ${flights} (
        id,
        tenant_id,
        schedule_request_id,
        replaces_flight_id,
        pilot_membership_id,
        flight_number,
        dep_icao,
        arr_icao,
        etd,
        eta,
        aircraft_type,
        status,
        dispatcher_notes,
        version
      )
      SELECT
        ${replacementId},
        ${flights.tenantId},
        ${flights.scheduleRequestId},
        ${flights.id},
        ${input.pilotMembershipId},
        ${flights.flightNumber},
        ${flights.depIcao},
        ${flights.arrIcao},
        ${flights.etd},
        ${flights.eta},
        ${flights.aircraftType},
        'offered',
        ${flights.dispatcherNotes},
        1
      FROM ${flights}
      WHERE
        ${flights.tenantId} = ${input.tenantId}
        AND ${flights.id} = ${input.sourceFlightId}
        AND ${flights.status} = 'declined'
        AND ${flights.version} = ${input.expectedVersion}
      ON CONFLICT (tenant_id, replaces_flight_id) DO NOTHING
      RETURNING id
    ), audited AS (
      INSERT INTO ${auditEvents} (
        tenant_id,
        actor_membership_id,
        action,
        entity_type,
        entity_id,
        meta
      )
      SELECT
        ${input.tenantId},
        ${input.actorMembershipId},
        'flight.reoffer',
        'flight',
        ${input.sourceFlightId},
        ${auditMeta}::jsonb
      FROM inserted
      RETURNING id
    )
    SELECT inserted.id FROM inserted INNER JOIN audited ON TRUE
  `);

  if (rows.rows.length === 0) return null;
  return findFlight(input.tenantId, replacementId);
}

export async function listBoardFlights(
  tenantId: string,
  now = new Date(),
): Promise<Flight[]> {
  const db = getDb();
  const horizon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  const nextMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  );
  return db
    .select()
    .from(flights)
    .where(
      and(
        eq(flights.tenantId, tenantId),
        or(
          eq(flights.status, "active"),
          and(
            inArray(flights.status, ["accepted", "briefed"]),
            lte(flights.etd, horizon),
          ),
          and(
            eq(flights.status, "completed"),
            gte(flights.etd, monthStart),
            lt(flights.etd, nextMonth),
          ),
        )!,
      ),
    )
    .orderBy(flights.etd);
}

export async function listMonthMetricFlights(
  tenantId: string,
  monthStart: Date,
  nextMonth: Date,
): Promise<Array<Pick<Flight, "id" | "status" | "etd" | "outAt">>> {
  const db = getDb();
  return db
    .select({
      id: flights.id,
      status: flights.status,
      etd: flights.etd,
      outAt: flights.outAt,
    })
    .from(flights)
    .where(
      and(
        eq(flights.tenantId, tenantId),
        gte(flights.etd, monthStart),
        lt(flights.etd, nextMonth),
        inArray(flights.status, ["briefed", "active", "completed"]),
      ),
    );
}

export async function listTrackableFlightsForPilot(input: {
  tenantId: string;
  pilotMembershipId: string;
  from: Date;
  to: Date;
}): Promise<Flight[]> {
  const db = getDb();
  return db
    .select()
    .from(flights)
    .where(
      and(
        eq(flights.tenantId, input.tenantId),
        eq(flights.pilotMembershipId, input.pilotMembershipId),
        inArray(flights.status, ["accepted", "briefed", "active"]),
        gte(flights.etd, input.from),
        lte(flights.etd, input.to),
      ),
    )
    .orderBy(flights.etd);
}
