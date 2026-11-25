import { randomUUID } from "node:crypto";

import { and, desc, eq, gte, inArray, lt, lte, ne, or, sql } from "drizzle-orm";
import { getDb } from "../client.js";
import { guard, insertAudit, json, ms, runAtomic } from "../atomic.js";
import {
  flights,
  flightOperationalEvents,
  memberships,
  scheduleFulfillmentAttempts,
  scheduleRequests,
  type Flight,
  type FlightStatus,
  type ScheduleFulfillmentAttempt,
} from "../schema.js";
import {
  encodeFlightCursor,
  type FlightCursorPayload,
  type PageResult,
} from "../../lib/pagination.js";

export type CreateFlightInput = {
  tenantId: string;
  actorMembershipId: string;
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

export type ScheduleFulfillmentOutcome = {
  scheduleRequestId: string;
  requestStatus: "partially_fulfilled" | "fulfilled";
  requestVersion: number;
  linkedFlightCount: number;
  remainingFlightCount: number;
  flightIds: string[];
};

export type ScheduleFulfillmentResult = {
  flights: Flight[];
  fulfillment: ScheduleFulfillmentOutcome;
};

export const DISPATCH_BOARD_OVERDUE_LOOKBACK_HOURS = 24;
export const DISPATCH_BOARD_UPCOMING_HORIZON_DAYS = 7;
const DISPATCH_BOARD_OVERDUE_LOOKBACK_MS =
  DISPATCH_BOARD_OVERDUE_LOOKBACK_HOURS * 60 * 60 * 1_000;
const DISPATCH_BOARD_UPCOMING_HORIZON_MS =
  DISPATCH_BOARD_UPCOMING_HORIZON_DAYS * 24 * 60 * 60 * 1_000;

export type DispatchBoardWindow = {
  generatedAt: Date;
  overdueFrom: Date;
  upcomingTo: Date;
  overdueLookbackHours: number;
  upcomingHorizonDays: number;
};

export function dispatchBoardWindow(now = new Date()): DispatchBoardWindow {
  return {
    generatedAt: now,
    overdueFrom: new Date(now.getTime() - DISPATCH_BOARD_OVERDUE_LOOKBACK_MS),
    upcomingTo: new Date(now.getTime() + DISPATCH_BOARD_UPCOMING_HORIZON_MS),
    overdueLookbackHours: DISPATCH_BOARD_OVERDUE_LOOKBACK_HOURS,
    upcomingHorizonDays: DISPATCH_BOARD_UPCOMING_HORIZON_DAYS,
  };
}

export async function createFlight(input: CreateFlightInput): Promise<Flight> {
  const db = getDb();
  const id = randomUUID();
  const now = new Date();
  const status = input.status ?? "draft";
  await runAtomic([
    db.insert(flights).values({
      id,
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
      status,
      dispatcherNotes: input.dispatcherNotes ?? null,
      createdAt: now,
      updatedAt: now,
    }),
    insertAudit({
      tenantId: input.tenantId,
      actorMembershipId: input.actorMembershipId,
      action: "flight.create",
      entityType: "flight",
      entityId: id,
      meta: { status },
      createdAt: now,
    }),
  ]);
  const created = await findFlight(input.tenantId, id);
  if (!created) throw new Error("Created flight could not be reloaded");
  return created;
}

/**
 * Appends one validated offer batch and advances the request with one locked,
 * auditable SQL statement. The request version and row lock serialize
 * competing batches; no flight can commit unless the whole requested batch,
 * request progress update, and both audit records also commit.
 *
 * The durable attempt row is claimed only after locked capacity succeeds and
 * commits in the same statement as flights, request progress, and audits.
 */
export async function fulfillScheduleRequest(input: {
  tenantId: string;
  scheduleRequestId: string;
  idempotencyKey: string;
  payloadHash: string;
  expectedRequestVersion: number;
  expectedRequestStatus: "in_review" | "partially_fulfilled";
  actorMembershipId: string;
  flights: Array<{
    flightNumber: string;
    depIcao: string;
    arrIcao: string;
    etd: Date;
    eta: Date;
    aircraftType?: string | null;
  }>;
}): Promise<ScheduleFulfillmentResult | null> {
  if (input.flights.length === 0) return null;
  const db = getDb();
  const attemptId = randomUUID();
  const now = new Date();
  const batchCount = input.flights.length;
  const proposed = input.flights.map((flight) => ({
    id: randomUUID(),
    flightNumber: flight.flightNumber,
    depIcao: flight.depIcao.toUpperCase(),
    arrIcao: flight.arrIcao.toUpperCase(),
    etd: flight.etd,
    eta: flight.eta,
    aircraftType: flight.aircraftType ?? null,
  }));
  const flightIds = proposed.map((flight) => flight.id);
  const requestAt = and(
    eq(scheduleRequests.tenantId, input.tenantId),
    eq(scheduleRequests.id, input.scheduleRequestId),
    eq(scheduleRequests.version, input.expectedRequestVersion),
    eq(scheduleRequests.status, input.expectedRequestStatus),
  )!;
  const existingFlightCount = sql`(
    SELECT count(*)
    FROM ${flights}
    WHERE
      ${flights.tenantId} = ${input.tenantId}
      AND ${flights.scheduleRequestId} = ${input.scheduleRequestId}
      AND ${flights.status} <> 'cancelled'
  )`;
  const desiredFlightCount = sql`(
    SELECT ${scheduleRequests.desiredFlightCount}
    FROM ${scheduleRequests}
    WHERE
      ${scheduleRequests.tenantId} = ${input.tenantId}
      AND ${scheduleRequests.id} = ${input.scheduleRequestId}
  )`;
  const attempt = sql`(
    SELECT request_status, request_version, linked_flight_count,
      remaining_flight_count
    FROM ${scheduleFulfillmentAttempts}
    WHERE id = ${attemptId}
  )`;

  const result = await runAtomic<{
    requestStatus: "partially_fulfilled" | "fulfilled";
    requestVersion: number;
    linkedFlightCount: number;
    remainingFlightCount: number;
  }>([
    // The request must still be at the reviewed version/status and belong to
    // an active pilot.
    guard(sql`EXISTS (
      SELECT 1
      FROM ${scheduleRequests}
      WHERE ${requestAt}
        AND EXISTS (
          SELECT 1
          FROM ${memberships}
          WHERE
            ${memberships.tenantId} = ${input.tenantId}
            AND ${memberships.id} = ${scheduleRequests.pilotMembershipId}
            AND ${memberships.role} = 'pilot'
            AND ${memberships.status} = 'active'
        )
    )`),
    // Cumulative capacity is checked inside the same serialized transaction.
    guard(
      sql`${existingFlightCount} + ${batchCount} <= ${desiredFlightCount}`,
    ),
    // A concurrent submission with the same idempotency key already won.
    guard(sql`NOT EXISTS (
      SELECT 1
      FROM ${scheduleFulfillmentAttempts}
      WHERE
        ${scheduleFulfillmentAttempts.tenantId} = ${input.tenantId}
        AND ${scheduleFulfillmentAttempts.scheduleRequestId} = ${input.scheduleRequestId}
        AND ${scheduleFulfillmentAttempts.idempotencyKey} = ${input.idempotencyKey}
    )`),
    sql`
      INSERT INTO schedule_fulfillment_attempts (
        id, tenant_id, schedule_request_id, idempotency_key, payload_hash,
        flight_ids, request_status, request_version, linked_flight_count,
        remaining_flight_count, created_at
      )
      SELECT
        ${attemptId},
        ${input.tenantId},
        ${input.scheduleRequestId},
        ${input.idempotencyKey},
        ${input.payloadHash},
        json(${json(flightIds)}),
        CASE
          WHEN existing + ${batchCount} >= desired THEN 'fulfilled'
          ELSE 'partially_fulfilled'
        END,
        ${input.expectedRequestVersion + 1},
        existing + ${batchCount},
        max(0, desired - existing - ${batchCount}),
        ${ms(now)}
      FROM (
        SELECT ${existingFlightCount} AS existing,
          ${desiredFlightCount} AS desired
      )
    `,
    ...proposed.map((flight) =>
      sql`
        INSERT INTO flights (
          id, tenant_id, schedule_request_id, pilot_membership_id,
          flight_number, dep_icao, arr_icao, etd, eta, aircraft_type, status,
          version, created_at, updated_at
        )
        SELECT
          ${flight.id},
          ${input.tenantId},
          ${scheduleRequests.id},
          ${scheduleRequests.pilotMembershipId},
          ${flight.flightNumber},
          ${flight.depIcao},
          ${flight.arrIcao},
          ${ms(flight.etd)},
          ${ms(flight.eta)},
          ${flight.aircraftType},
          'offered',
          1,
          ${ms(now)},
          ${ms(now)}
        FROM ${scheduleRequests}
        WHERE ${requestAt}
      `,
    ),
    sql`
      UPDATE schedule_requests
      SET
        status = (SELECT request_status FROM ${attempt}),
        version = version + 1,
        updated_at = ${ms(now)}
      WHERE ${requestAt}
    `,
    sql`
      INSERT INTO audit_events (
        tenant_id, actor_membership_id, action, entity_type, entity_id, meta,
        created_at
      )
      SELECT
        ${input.tenantId},
        ${input.actorMembershipId},
        'schedule_request.fulfillment_progress',
        'schedule_request',
        ${input.scheduleRequestId},
        json_object(
          'from', ${input.expectedRequestStatus},
          'to', attempt.request_status,
          'fromVersion', ${input.expectedRequestVersion},
          'toVersion', ${input.expectedRequestVersion + 1},
          'batchCount', ${batchCount},
          'existingFlightCount', attempt.linked_flight_count - ${batchCount},
          'cumulativeFlightCount', attempt.linked_flight_count,
          'remainingFlightCount', attempt.remaining_flight_count
        ),
        ${ms(now)}
      FROM ${attempt} AS attempt
      UNION ALL
      SELECT
        ${input.tenantId},
        ${input.actorMembershipId},
        'flight.bulk_create',
        'schedule_request',
        ${input.scheduleRequestId},
        json_object(
          'count', ${batchCount},
          'requestFromVersion', ${input.expectedRequestVersion},
          'requestToVersion', ${input.expectedRequestVersion + 1},
          'createdFlightVersion', 1,
          'flightIds', json(${json(flightIds)})
        ),
        ${ms(now)}
    `,
    sql`
      SELECT
        request_status AS "requestStatus",
        request_version AS "requestVersion",
        linked_flight_count AS "linkedFlightCount",
        remaining_flight_count AS "remainingFlightCount"
      FROM ${attempt}
    `,
  ]);

  const outcomeRow = result?.at(-1)?.[0];
  if (!outcomeRow) return null;
  return materializeScheduleFulfillment({
    tenantId: input.tenantId,
    scheduleRequestId: input.scheduleRequestId,
    flightIds,
    requestStatus: outcomeRow.requestStatus,
    requestVersion: outcomeRow.requestVersion,
    linkedFlightCount: outcomeRow.linkedFlightCount,
    remainingFlightCount: outcomeRow.remainingFlightCount,
  });
}

export async function findScheduleFulfillmentAttempt(
  tenantId: string,
  scheduleRequestId: string,
  idempotencyKey: string,
): Promise<ScheduleFulfillmentAttempt | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(scheduleFulfillmentAttempts)
    .where(
      and(
        eq(scheduleFulfillmentAttempts.tenantId, tenantId),
        eq(scheduleFulfillmentAttempts.scheduleRequestId, scheduleRequestId),
        eq(scheduleFulfillmentAttempts.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function replayScheduleFulfillment(
  attempt: ScheduleFulfillmentAttempt,
): Promise<ScheduleFulfillmentResult> {
  return materializeScheduleFulfillment({
    tenantId: attempt.tenantId,
    scheduleRequestId: attempt.scheduleRequestId,
    flightIds: attempt.flightIds,
    requestStatus: assertFulfillmentStatus(attempt.requestStatus),
    requestVersion: attempt.requestVersion,
    linkedFlightCount: attempt.linkedFlightCount,
    remainingFlightCount: attempt.remainingFlightCount,
  });
}

async function materializeScheduleFulfillment(
  outcome: ScheduleFulfillmentOutcome & { tenantId: string },
): Promise<ScheduleFulfillmentResult> {
  const db = getDb();
  const rows = await db
    .select()
    .from(flights)
    .where(
      and(
        eq(flights.tenantId, outcome.tenantId),
        inArray(flights.id, outcome.flightIds),
      ),
    );
  const byId = new Map(rows.map((row) => [row.id, row]));
  const ordered = outcome.flightIds
    .map((id) => byId.get(id))
    .filter((row): row is Flight => !!row);
  if (ordered.length !== outcome.flightIds.length) {
    throw new Error("Stored fulfillment result references a missing flight");
  }
  const { tenantId: _tenantId, ...fulfillment } = outcome;
  return { flights: ordered, fulfillment };
}

function assertFulfillmentStatus(
  status: ScheduleFulfillmentAttempt["requestStatus"],
): "partially_fulfilled" | "fulfilled" {
  if (status !== "partially_fulfilled" && status !== "fulfilled") {
    throw new Error("Stored fulfillment result has an invalid request status");
  }
  return status;
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

export async function countNonCancelledScheduleRequestFlights(
  tenantId: string,
  scheduleRequestId: string,
): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(flights)
    .where(
      and(
        eq(flights.tenantId, tenantId),
        eq(flights.scheduleRequestId, scheduleRequestId),
        ne(flights.status, "cancelled"),
      ),
    );
  return row?.count ?? 0;
}

export async function listFlights(input: {
  tenantId: string;
  pilotMembershipId?: string;
  status?: FlightStatus | FlightStatus[];
  fromEtd?: Date;
  toEtd?: Date;
  scheduleRequestId?: string;
  cursor?: FlightCursorPayload;
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
    const cursorEtd = new Date(input.cursor.etd);
    conditions.push(
      or(
        lt(flights.etd, cursorEtd),
        and(eq(flights.etd, cursorEtd), lt(flights.id, input.cursor.id)),
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
      ? encodeFlightCursor({
          etd: lastItem.etd.toISOString(),
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
  const now = new Date();
  const result = await runAtomic([
    ...versionedFlightUpdate(input, now),
    insertAudit({
      tenantId: input.tenantId,
      actorMembershipId: input.actorMembershipId,
      action: input.action,
      entityType: "flight",
      entityId: input.id,
      meta: input.auditMeta,
      createdAt: now,
    }),
  ]);
  if (!result) return null;
  return findFlight(input.tenantId, input.id);
}

/**
 * Guard + compare-and-set update for one flight version. The guard aborts
 * the surrounding batch when the version is stale.
 */
function versionedFlightUpdate(
  input: {
    tenantId: string;
    id: string;
    expectedVersion: number;
    patch: UpdateFlightPatch;
  },
  now: Date,
) {
  const db = getDb();
  const normalized = { ...input.patch };
  if (normalized.depIcao) normalized.depIcao = normalized.depIcao.toUpperCase();
  if (normalized.arrIcao) normalized.arrIcao = normalized.arrIcao.toUpperCase();
  for (const field of Object.keys(normalized)) {
    if (!(field in updatableFlightColumns)) {
      throw new Error(`Unsupported flight update field: ${field}`);
    }
  }
  const at = and(
    eq(flights.tenantId, input.tenantId),
    eq(flights.id, input.id),
    eq(flights.version, input.expectedVersion),
  )!;
  return [
    guard(sql`EXISTS (SELECT 1 FROM ${flights} WHERE ${at})`),
    db
      .update(flights)
      .set({
        ...normalized,
        version: sql`${flights.version} + 1`,
        updatedAt: now,
      })
      .where(at),
  ];
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
 * Advances manual flight progress and records both audit representations in
 * the same PostgreSQL statement. A stale version returns null; any audit or
 * operational-event failure aborts the complete state transition.
 */
export async function updateFlightWithOperationalEvent(input: {
  tenantId: string;
  id: string;
  expectedVersion: number;
  actorMembershipId: string;
  action: string;
  auditMeta: Record<string, unknown>;
  patch: UpdateFlightPatch;
  event: {
    kind: "manual_start" | "manual_finish";
    source: "pilot_web" | "dispatcher";
    occurredAt: Date;
    meta?: Record<string, unknown>;
  };
}): Promise<Flight | null> {
  const db = getDb();
  const now = new Date();
  const result = await runAtomic([
    ...versionedFlightUpdate(input, now),
    insertAudit({
      tenantId: input.tenantId,
      actorMembershipId: input.actorMembershipId,
      action: input.action,
      entityType: "flight",
      entityId: input.id,
      meta: input.auditMeta,
      createdAt: now,
    }),
    db.insert(flightOperationalEvents).values({
      tenantId: input.tenantId,
      flightId: input.id,
      kind: input.event.kind,
      source: input.event.source,
      occurredAt: input.event.occurredAt,
      actorMembershipId: input.actorMembershipId,
      meta: input.event.meta ?? {},
      createdAt: now,
    }),
  ]);
  if (!result) return null;
  return findFlight(input.tenantId, input.id);
}

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
  const replacementId = randomUUID();
  const now = new Date();
  const auditMeta = {
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
  };
  const source = and(
    eq(flights.tenantId, input.tenantId),
    eq(flights.id, input.sourceFlightId),
    eq(flights.status, "declined"),
    eq(flights.version, input.expectedVersion),
  )!;

  const result = await runAtomic([
    guard(sql`EXISTS (SELECT 1 FROM ${flights} WHERE ${source})`),
    // The unique replacement lineage makes concurrent retries deterministic.
    guard(sql`NOT EXISTS (
      SELECT 1
      FROM ${flights}
      WHERE
        ${flights.tenantId} = ${input.tenantId}
        AND ${flights.replacesFlightId} = ${input.sourceFlightId}
    )`),
    sql`
      INSERT INTO flights (
        id, tenant_id, schedule_request_id, replaces_flight_id,
        pilot_membership_id, flight_number, dep_icao, arr_icao, etd, eta,
        aircraft_type, status, dispatcher_notes, version, created_at,
        updated_at
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
        1,
        ${ms(now)},
        ${ms(now)}
      FROM ${flights}
      WHERE ${source}
    `,
    insertAudit({
      tenantId: input.tenantId,
      actorMembershipId: input.actorMembershipId,
      action: "flight.reoffer",
      entityType: "flight",
      entityId: input.sourceFlightId,
      meta: auditMeta,
      createdAt: now,
    }),
  ]);

  if (!result) return null;
  return findFlight(input.tenantId, replacementId);
}

export async function listBoardFlights(
  tenantId: string,
  now = new Date(),
): Promise<Flight[]> {
  const db = getDb();
  const window = dispatchBoardWindow(now);
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
            gte(flights.etd, window.overdueFrom),
            lte(flights.etd, window.upcomingTo),
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
