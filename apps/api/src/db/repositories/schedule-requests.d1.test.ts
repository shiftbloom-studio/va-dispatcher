import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../test/d1.js";
import { flights, memberships, scheduleRequests, tenants } from "../schema.js";
import {
  cancelScheduleRequest,
  createScheduleRequest,
  findScheduleRequest,
  updateScheduleRequest,
} from "./schedule-requests.js";

const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const requestId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const pilotId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const flightIds = {
  offered: "dddddddd-dddd-4ddd-8ddd-000000000001",
  briefed: "dddddddd-dddd-4ddd-8ddd-000000000002",
  active: "dddddddd-dddd-4ddd-8ddd-000000000003",
  completed: "dddddddd-dddd-4ddd-8ddd-000000000004",
};
const windowStart = new Date("2026-09-10T08:00:00.000Z");
const windowEnd = new Date("2026-09-10T12:00:00.000Z");
const preferences = {
  availability: [
    { startAt: windowStart.toISOString(), endAt: windowEnd.toISOString() },
  ],
};

describe("schedule request repository D1 contracts", () => {
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
    await db.insert(tenants).values({
      id: tenantId,
      slug: "vsas",
      name: "Virtual SAS",
      clerkOrgId: "org_vsas",
    });
    await db.insert(memberships).values({
      id: pilotId,
      tenantId,
      clerkUserId: "user_pilot",
      role: "pilot",
      status: "active",
    });
    await db.insert(scheduleRequests).values({
      id: requestId,
      tenantId,
      pilotMembershipId: pilotId,
      windowStart,
      windowEnd,
      desiredFlightCount: 4,
      version: 2,
      status: "partially_fulfilled",
    });
    for (const [key, id] of Object.entries(flightIds)) {
      await db.insert(flights).values({
        id,
        tenantId,
        scheduleRequestId: requestId,
        pilotMembershipId: pilotId,
        flightNumber: `SK${id.slice(-3)}`,
        depIcao: "EKCH",
        arrIcao: "ENGM",
        etd: windowStart,
        eta: windowEnd,
        status: key as keyof typeof flightIds,
      });
    }
  });

  async function rejectAuditInserts() {
    await database.query(`
      create trigger reject_audit_insert before insert on audit_events
      begin select raise(abort, 'synthetic audit failure'); end
    `);
    return () => database.query("drop trigger if exists reject_audit_insert");
  }

  async function auditCount(entityId: string) {
    const [row] = await database.query<{ count: number }>(
      "select count(*) as count from audit_events where entity_id = ?",
      entityId,
    );
    return row?.count ?? 0;
  }

  it("creates a request and its actor audit atomically", async () => {
    const created = await createScheduleRequest({
      tenantId,
      pilotMembershipId: pilotId,
      actorMembershipId: pilotId,
      title: "September request",
      windowStart,
      windowEnd,
      desiredFlightCount: 1,
      preferences,
    });
    expect(created).toMatchObject({ status: "pending", version: 1, preferences });
    await expect(auditCount(created.id)).resolves.toBe(1);

    const restore = await rejectAuditInserts();
    try {
      await expect(
        createScheduleRequest({
          tenantId,
          pilotMembershipId: pilotId,
          actorMembershipId: pilotId,
          title: "Unaudited request",
          windowStart,
          windowEnd,
          desiredFlightCount: 1,
          preferences,
        }),
      ).rejects.toThrow();
    } finally {
      await restore();
    }
    const [row] = await database.query<{ count: number }>(
      "select count(*) as count from schedule_requests where title = 'Unaudited request'",
    );
    expect(row?.count).toBe(0);
  });

  it("edits only the expected pending version and audits atomically", async () => {
    const created = await createScheduleRequest({
      tenantId,
      pilotMembershipId: pilotId,
      actorMembershipId: pilotId,
      title: "Original",
      windowStart,
      windowEnd,
      desiredFlightCount: 1,
      preferences,
    });
    const edit = (expectedVersion: number) =>
      updateScheduleRequest({
        tenantId,
        id: created.id,
        expectedVersion,
        expectedStatus: "pending",
        actorMembershipId: pilotId,
        action: "schedule_request.edited",
        auditMeta: { changedFields: ["title"] },
        patch: {
          title: "Revised availability",
          notes: null,
          windowStart,
          windowEnd,
          desiredFlightCount: 2,
          preferences,
        },
      });

    await expect(edit(4)).resolves.toBeNull();
    await expect(edit(1)).resolves.toMatchObject({
      title: "Revised availability",
      version: 2,
      desiredFlightCount: 2,
    });
    await expect(edit(1)).resolves.toBeNull();
    await expect(auditCount(created.id)).resolves.toBe(2);
  });

  it("cancels only pre-departure linked flights with per-row audits", async () => {
    await expect(
      cancelScheduleRequest({
        tenantId,
        id: requestId,
        expectedVersion: 1,
        expectedStatus: "partially_fulfilled",
        actorMembershipId: pilotId,
        linkedFlightAction: "cancel_predeparture",
        reason: "Pilot unavailable",
      }),
    ).resolves.toBeNull();

    const cancelled = await cancelScheduleRequest({
      tenantId,
      id: requestId,
      expectedVersion: 2,
      expectedStatus: "partially_fulfilled",
      actorMembershipId: pilotId,
      linkedFlightAction: "cancel_predeparture",
      reason: "Pilot unavailable",
    });
    expect(cancelled).toMatchObject({ status: "cancelled", version: 3 });

    const rows = await database.query<{ id: string; status: string; version: number }>(
      "select id, status, version from flights order by id",
    );
    expect(rows).toEqual([
      { id: flightIds.offered, status: "cancelled", version: 2 },
      { id: flightIds.briefed, status: "cancelled", version: 2 },
      { id: flightIds.active, status: "active", version: 1 },
      { id: flightIds.completed, status: "completed", version: 1 },
    ]);
    const [requestAudit] = await database.query<{ meta: string }>(
      "select meta from audit_events where entity_id = ?",
      requestId,
    );
    expect(JSON.parse(requestAudit!.meta)).toMatchObject({
      from: "partially_fulfilled",
      to: "cancelled",
      fromVersion: 2,
      toVersion: 3,
      reason: "Pilot unavailable",
      linkedFlightAction: "cancel_predeparture",
    });
    const flightAudits = await database.query<{ entity_id: string; meta: string }>(
      "select entity_id, meta from audit_events where entity_type = 'flight' order by entity_id",
    );
    expect(flightAudits.map((row) => row.entity_id)).toEqual([
      flightIds.offered,
      flightIds.briefed,
    ]);
    expect(JSON.parse(flightAudits[0]!.meta)).toMatchObject({
      reason: "Pilot unavailable",
      scheduleRequestId: requestId,
    });
  });

  it("rolls back request and flight cancellation when an audit insert fails", async () => {
    const restore = await rejectAuditInserts();
    try {
      await expect(
        cancelScheduleRequest({
          tenantId,
          id: requestId,
          expectedVersion: 2,
          expectedStatus: "partially_fulfilled",
          actorMembershipId: pilotId,
          linkedFlightAction: "cancel_predeparture",
        }),
      ).rejects.toThrow();
    } finally {
      await restore();
    }
    await expect(findScheduleRequest(tenantId, requestId)).resolves.toMatchObject({
      status: "partially_fulfilled",
      version: 2,
    });
    const [row] = await database.query<{ count: number }>(
      "select count(*) as count from flights where status = 'cancelled'",
    );
    expect(row?.count).toBe(0);
  });
});
