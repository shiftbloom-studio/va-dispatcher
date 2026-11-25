import { getTableConfig } from "drizzle-orm/sqlite-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../test/d1.js";
import { flights, memberships, scheduleRequests, tenants } from "../schema.js";
import {
  createFlight,
  createReplacementFlight,
  findFlight,
  fulfillScheduleRequest,
  listBoardFlights,
  updateFlightWithOperationalEvent,
} from "./flights.js";

const tenantId = "20000000-0000-4000-8000-000000000001";
const otherTenantId = "20000000-0000-4000-8000-000000000099";
const pilotMembershipId = "40000000-0000-4000-8000-000000000001";
const dispatcherMembershipId = "40000000-0000-4000-8000-000000000002";
const scheduleRequestId = "50000000-0000-4000-8000-000000000001";
const now = new Date("2026-08-12T12:00:00.000Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const ids = {
  stale: "30000000-0000-4000-8000-000000000001",
  overdueBoundary: "30000000-0000-4000-8000-000000000002",
  overdue: "30000000-0000-4000-8000-000000000003",
  upcoming: "30000000-0000-4000-8000-000000000004",
  horizonBoundary: "30000000-0000-4000-8000-000000000005",
  beyondHorizon: "30000000-0000-4000-8000-000000000006",
  activeOld: "30000000-0000-4000-8000-000000000007",
  terminal: "30000000-0000-4000-8000-000000000008",
  declined: "30000000-0000-4000-8000-000000000009",
  foreign: "30000000-0000-4000-8000-000000000099",
};

function at(offsetMs: number): Date {
  return new Date(now.getTime() + offsetMs);
}

describe("flight repository D1 contracts", () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.dispose();
  });

  beforeEach(async () => {
    await database.reset();
    const { db } = database;
    await db.insert(tenants).values([
      { id: tenantId, slug: "vsas", name: "Virtual SAS", clerkOrgId: "org_vsas" },
      { id: otherTenantId, slug: "other", name: "Other VA", clerkOrgId: "org_other" },
    ]);
    await db.insert(memberships).values([
      { id: pilotMembershipId, tenantId, clerkUserId: "user_pilot", role: "pilot", status: "active" },
      { id: dispatcherMembershipId, tenantId, clerkUserId: "user_dispatcher", role: "dispatcher", status: "active" },
    ]);
    await db.insert(scheduleRequests).values({
      id: scheduleRequestId,
      tenantId,
      pilotMembershipId,
      windowStart: at(DAY),
      windowEnd: at(2 * DAY),
      desiredFlightCount: 2,
      version: 1,
      status: "in_review",
    });
    const flight = (
      id: string,
      flightNumber: string,
      etd: Date,
      eta: Date,
      status: (typeof flights.$inferInsert)["status"],
      owner = tenantId,
    ) => ({
      id,
      tenantId: owner,
      flightNumber,
      depIcao: "EKCH",
      arrIcao: "ENGM",
      etd,
      eta,
      status,
    });
    for (const row of [
      flight(ids.stale, "SK001", at(-DAY - 1), at(-22 * HOUR), "accepted"),
      flight(ids.overdueBoundary, "SK002", at(-DAY), at(-22 * HOUR), "accepted"),
      flight(ids.overdue, "SK003", at(-HOUR), at(20 * MINUTE), "briefed"),
      flight(ids.upcoming, "SK004", at(DAY), at(26 * HOUR), "accepted"),
      flight(ids.horizonBoundary, "SK005", at(7 * DAY), at(7 * DAY + HOUR), "accepted"),
      flight(ids.beyondHorizon, "SK006", at(7 * DAY + 1), at(7 * DAY + HOUR), "briefed"),
      flight(ids.activeOld, "SK007", at(-30 * DAY), at(-30 * DAY + HOUR), "active"),
      flight(ids.terminal, "SK008", at(-30 * MINUTE), at(30 * MINUTE), "completed"),
      flight(ids.foreign, "OT001", at(HOUR), at(2 * HOUR), "accepted", otherTenantId),
    ]) {
      await db.insert(flights).values(row);
    }
    await db.insert(flights).values({
      ...flight(ids.declined, "SK009", at(2 * DAY), at(2 * DAY + HOUR), "declined"),
      pilotMembershipId,
      version: 3,
    });
  });

  async function count(statement: string, ...params: unknown[]) {
    const [row] = await database.query<{ count: number }>(statement, ...params);
    return row?.count ?? 0;
  }

  async function rejectInsertsInto(table: string, message: string) {
    await database.query(`
      create trigger reject_${table}_insert before insert on ${table}
      begin select raise(abort, '${message}'); end
    `);
    return () => database.query(`drop trigger if exists reject_${table}_insert`);
  }

  it("includes exact window boundaries, active flights, and current-month completions while excluding stale, future, and foreign rows", async () => {
    const rows = await listBoardFlights(tenantId, now);

    expect(rows.map((row) => row.id)).toEqual([
      ids.activeOld,
      ids.overdueBoundary,
      ids.overdue,
      ids.terminal,
      ids.upcoming,
      ids.horizonBoundary,
    ]);
  });

  it("keeps an old record directly accessible after it leaves the live board", async () => {
    const board = await listBoardFlights(tenantId, now);
    expect(board.some((row) => row.id === ids.stale)).toBe(false);

    await expect(findFlight(tenantId, ids.stale)).resolves.toMatchObject({
      id: ids.stale,
      tenantId,
      status: "accepted",
    });
    await expect(findFlight(otherTenantId, ids.stale)).resolves.toBeNull();
  });

  it("creates an ad-hoc flight and its actor audit atomically", async () => {
    const created = await createFlight({
      tenantId,
      actorMembershipId: dispatcherMembershipId,
      pilotMembershipId,
      flightNumber: "SK101",
      depIcao: "ekch",
      arrIcao: "engm",
      etd: new Date("2026-09-10T08:00:00.000Z"),
      eta: new Date("2026-09-10T09:30:00.000Z"),
      status: "offered",
    });
    expect(created).toMatchObject({ depIcao: "EKCH", status: "offered" });
    await expect(
      count(
        "select count(*) as count from audit_events where entity_id=? and action='flight.create'",
        created.id,
      ),
    ).resolves.toBe(1);

    const restore = await rejectInsertsInto("audit_events", "synthetic audit insert failure");
    try {
      await expect(
        createFlight({
          tenantId,
          actorMembershipId: dispatcherMembershipId,
          flightNumber: "SK102",
          depIcao: "EKCH",
          arrIcao: "ENGM",
          etd: new Date("2026-09-10T08:00:00.000Z"),
          eta: new Date("2026-09-10T09:30:00.000Z"),
        }),
      ).rejects.toThrow();
    } finally {
      await restore();
    }
    await expect(
      count("select count(*) as count from flights where flight_number='SK102'"),
    ).resolves.toBe(0);
  });

  it("uses a composite tenant-safe self-reference for replacements", () => {
    const foreignKey = getTableConfig(flights).foreignKeys.find(
      (candidate) => candidate.getName() === "flights_tenant_replaces_fkey",
    );
    expect(
      foreignKey?.reference().columns.map((column) => column.name),
    ).toEqual(["tenant_id", "replaces_flight_id"]);
    expect(
      foreignKey?.reference().foreignColumns.map((column) => column.name),
    ).toEqual(["tenant_id", "id"]);
  });

  it("creates at most one replacement without rewriting the terminal source", async () => {
    const replace = () =>
      createReplacementFlight({
        tenantId,
        sourceFlightId: ids.declined,
        expectedVersion: 3,
        actorMembershipId: dispatcherMembershipId,
        scheduleRequestId: null,
        oldPilotMembershipId: pilotMembershipId,
        pilotMembershipId,
        flightNumber: "SK009",
        depIcao: "EKCH",
        arrIcao: "ENGM",
        etd: at(2 * DAY),
        eta: at(2 * DAY + HOUR),
        aircraftType: null,
        dispatcherNotes: null,
        reason: "Availability restored",
      });

    const [first, second] = await Promise.all([replace(), replace()]);
    const created = [first, second].filter(Boolean);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      replacesFlightId: ids.declined,
      status: "offered",
      version: 1,
    });
    await expect(findFlight(tenantId, ids.declined)).resolves.toMatchObject({
      status: "declined",
      version: 3,
    });
    await expect(
      count(
        "select count(*) as count from audit_events where entity_id=? and action='flight.reoffer'",
        ids.declined,
      ),
    ).resolves.toBe(1);
  });

  it("partially fulfills a request with exact timestamps atomically", async () => {
    const etd = new Date("2026-09-10T08:30:00.000Z");
    const eta = new Date("2026-09-10T10:00:00.000Z");

    const result = await fulfillScheduleRequest({
      tenantId,
      scheduleRequestId,
      idempotencyKey: "partial-batch-001",
      payloadHash: "a".repeat(64),
      expectedRequestVersion: 1,
      expectedRequestStatus: "in_review",
      actorMembershipId: dispatcherMembershipId,
      flights: [
        {
          flightNumber: "SK901",
          depIcao: "EKCH",
          arrIcao: "ENGM",
          etd,
          eta,
          aircraftType: "A320",
        },
      ],
    });

    expect(result).toMatchObject({
      flights: [
        {
          scheduleRequestId,
          pilotMembershipId,
          flightNumber: "SK901",
          status: "offered",
        },
      ],
      fulfillment: {
        scheduleRequestId,
        requestStatus: "partially_fulfilled",
        requestVersion: 2,
        linkedFlightCount: 1,
        remainingFlightCount: 1,
      },
    });
    expect(result?.flights[0]?.etd.toISOString()).toBe(etd.toISOString());
    expect(result?.flights[0]?.eta.toISOString()).toBe(eta.toISOString());

    const [stored] = await database.query(
      `select
         request.status,
         request.version,
         (select count(*) from schedule_fulfillment_attempts
           where schedule_request_id = ?1) as attempt_count,
         (select count(*) from audit_events where entity_id = ?1) as audit_count
       from schedule_requests request
       where request.id = ?1`,
      scheduleRequestId,
    );
    expect(stored).toEqual({
      status: "partially_fulfilled",
      version: 2,
      attempt_count: 1,
      audit_count: 2,
    });
  });

  it("cannot leave inserted fulfillment flights behind when auditing fails", async () => {
    const restore = await rejectInsertsInto(
      "audit_events",
      "synthetic fulfillment audit failure",
    );
    try {
      await expect(
        fulfillScheduleRequest({
          tenantId,
          scheduleRequestId,
          idempotencyKey: "batch-002",
          payloadHash: "b".repeat(64),
          expectedRequestVersion: 1,
          expectedRequestStatus: "in_review",
          actorMembershipId: dispatcherMembershipId,
          flights: [
            {
              flightNumber: "SK902",
              depIcao: "ESSA",
              arrIcao: "EKCH",
              etd: new Date("2026-09-10T08:00:00.000Z"),
              eta: new Date("2026-09-10T09:00:00.000Z"),
            },
          ],
        }),
      ).rejects.toThrow();
    } finally {
      await restore();
    }
    await expect(
      count(
        "select count(*) as count from flights where schedule_request_id=?",
        scheduleRequestId,
      ),
    ).resolves.toBe(0);
    await expect(
      count("select count(*) as count from schedule_fulfillment_attempts"),
    ).resolves.toBe(0);
  });

  it("allows exactly one concurrent manual start for one expected version", async () => {
    const occurredAt = new Date("2026-08-12T12:05:00.000Z");
    const command = () =>
      updateFlightWithOperationalEvent({
        tenantId,
        id: ids.overdue,
        expectedVersion: 1,
        actorMembershipId: dispatcherMembershipId,
        action: "flight.progress",
        auditMeta: { kind: "manual_start", fromVersion: 1, toVersion: 2 },
        patch: { status: "active", outAt: occurredAt },
        event: { kind: "manual_start", source: "dispatcher", occurredAt },
      });

    const results = await Promise.all([command(), command()]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.filter((result) => result === null)).toHaveLength(1);

    await expect(findFlight(tenantId, ids.overdue)).resolves.toMatchObject({
      status: "active",
      version: 2,
      outAt: occurredAt,
    });
    const [counts] = await database.query(
      `select
         (select count(*) from audit_events where entity_id = ?1) as audit_count,
         (select count(*) from flight_operational_events where flight_id = ?1) as event_count`,
      ids.overdue,
    );
    expect(counts).toEqual({ audit_count: 1, event_count: 1 });
  });

  it("rolls back manual finish state and audit when event insertion fails", async () => {
    const restore = await rejectInsertsInto(
      "flight_operational_events",
      "synthetic manual event failure",
    );
    try {
      await expect(
        updateFlightWithOperationalEvent({
          tenantId,
          id: ids.activeOld,
          expectedVersion: 1,
          actorMembershipId: dispatcherMembershipId,
          action: "flight.progress",
          auditMeta: { kind: "manual_finish", fromVersion: 1, toVersion: 2 },
          patch: {
            status: "completed",
            inAt: new Date("2026-08-12T12:10:00.000Z"),
          },
          event: {
            kind: "manual_finish",
            source: "dispatcher",
            occurredAt: new Date("2026-08-12T12:10:00.000Z"),
          },
        }),
      ).rejects.toThrow();
    } finally {
      await restore();
    }

    await expect(findFlight(tenantId, ids.activeOld)).resolves.toMatchObject({
      status: "active",
      version: 1,
      inAt: null,
    });
    const [counts] = await database.query(
      `select
         (select count(*) from audit_events where entity_id = ?1) as audit_count,
         (select count(*) from flight_operational_events where flight_id = ?1) as event_count`,
      ids.activeOld,
    );
    expect(counts).toEqual({ audit_count: 0, event_count: 0 });
  });
});
