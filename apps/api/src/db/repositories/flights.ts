import { and, desc, eq, gte, inArray, lt, lte, or, sql } from "drizzle-orm";
import { getDb } from "../client.js";
import { flights, type Flight, type FlightStatus } from "../schema.js";
import {
  decodeCursor,
  encodeCursor,
  type PageResult,
} from "../../lib/pagination.js";

export type CreateFlightInput = {
  tenantId: string;
  scheduleRequestId?: string | null;
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

export async function updateFlight(
  tenantId: string,
  id: string,
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
  }>,
  options?: { expectedUpdatedAt?: Date },
): Promise<Flight | null> {
  const db = getDb();
  const normalized = { ...patch };
  if (normalized.depIcao) normalized.depIcao = normalized.depIcao.toUpperCase();
  if (normalized.arrIcao) normalized.arrIcao = normalized.arrIcao.toUpperCase();

  const [row] = await db
    .update(flights)
    .set({ ...normalized, updatedAt: new Date() })
    .where(
      and(
        eq(flights.tenantId, tenantId),
        eq(flights.id, id),
        ...(options?.expectedUpdatedAt
          ? [
              sql`date_trunc('milliseconds', ${flights.updatedAt}) = ${options.expectedUpdatedAt}`,
            ]
          : []),
      ),
    )
    .returning();
  return row ?? null;
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
