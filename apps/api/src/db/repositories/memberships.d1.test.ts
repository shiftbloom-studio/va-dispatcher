import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../test/d1.js";
import { flights, memberships, scheduleRequests, tenants } from "../schema.js";
import {
  administrativelyUpdateMembership,
  createDirectoryMembershipWithAudit,
  listMemberships,
  provisionPilotMembershipWithAudit,
  recoverMembershipAsTenantAdmin,
  submitMembershipApplicationWithAudit,
  cancelMembershipApplicationWithAudit,
} from "./memberships.js";

const TENANT_ONE = "26000000-0000-4000-8000-000000000001";
const TENANT_TWO = "26000000-0000-4000-8000-000000000002";
const ADMIN_ONE = "26000000-0000-4000-8000-000000000011";
const ADMIN_TWO = "26000000-0000-4000-8000-000000000012";
const PILOT_ONE = "26000000-0000-4000-8000-000000000021";
const PILOT_TWO = "26000000-0000-4000-8000-000000000022";
const OUTSIDE_PILOT = "26000000-0000-4000-8000-000000000023";
const REQUEST_ONE = "26000000-0000-4000-8000-000000000031";
const FLIGHT_ONE = "26000000-0000-4000-8000-000000000041";
const FLIGHT_ACTIVE = "26000000-0000-4000-8000-000000000042";
const REQUEST_TERMINAL = "26000000-0000-4000-8000-000000000032";
const FLIGHT_TERMINAL_LINK = "26000000-0000-4000-8000-000000000043";
const FLIGHT_DRAFT = "26000000-0000-4000-8000-000000000044";
const FLIGHT_RACE = "26000000-0000-4000-8000-000000000045";

const HOUR = 60 * 60 * 1000;

describe("administrative member transactions (D1)", () => {
  let database: TestDatabase;
  const pool = {
    async query<T = Record<string, unknown>>(
      statement: string,
      params: unknown[] = [],
    ): Promise<{ rows: T[] }> {
      return { rows: await database.query<T>(statement, ...params) };
    },
  };

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  beforeEach(async () => {
    await database.reset();
    await seedFixtures(database);
  });

  afterAll(async () => {
    await database.dispose();
  });

  async function insertFlight(
    id: string,
    pilotMembershipId: string,
    flightNumber: string,
    status: (typeof flights.$inferInsert)["status"],
    scheduleRequestId: string | null = null,
  ) {
    const etd = new Date();
    await database.db.insert(flights).values({
      id,
      tenantId: TENANT_ONE,
      scheduleRequestId,
      pilotMembershipId,
      flightNumber,
      depIcao: "EKCH",
      arrIcao: "ENGM",
      etd,
      eta: new Date(etd.getTime() + HOUR),
      status,
    });
  }

  it("serializes simultaneous demotions and preserves one active admin", async () => {
    const [first, second] = await Promise.all([
      administrativelyUpdateMembership({
        tenantId: TENANT_ONE,
        membershipId: ADMIN_ONE,
        actorMembershipId: ADMIN_ONE,
        patch: { role: "dispatcher" },
      }),
      administrativelyUpdateMembership({
        tenantId: TENANT_ONE,
        membershipId: ADMIN_TWO,
        actorMembershipId: ADMIN_TWO,
        patch: { role: "dispatcher" },
      }),
    ]);

    expect([first.kind, second.kind].sort()).toEqual(["blocked", "updated"]);
    const blocked = [first, second].find((result) => result.kind === "blocked");
    expect(blocked).toMatchObject({
      kind: "blocked",
      reason: "last_active_admin",
    });
    const activeAdmins = await pool.query<{ count: number }>(
      `select count(*) as count from memberships
       where tenant_id = ?1 and role = 'admin' and status = 'active'`,
      [TENANT_ONE],
    );
    expect(activeAdmins.rows[0]?.count).toBe(1);
    const audits = await pool.query<{ count: number }>(
      `select count(*) as count from audit_events
       where tenant_id = ?1 and action = 'member.updated'`,
      [TENANT_ONE],
    );
    expect(audits.rows[0]?.count).toBe(1);
  });

  it("lists tenant members with unambiguous correlated work-impact counts", async () => {
    const page = await listMemberships({
      tenantId: TENANT_ONE,
      search: "Pilot One",
      limit: 10,
    });

    expect(page.nextCursor).toBeNull();
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      id: PILOT_ONE,
      tenantId: TENANT_ONE,
      openFlightCount: 1,
      activeFlightCount: 0,
      openScheduleRequestCount: 1,
      terminalRequestLinkedFlightCount: 0,
    });
  });

  it("rolls back the member update when its audit insert fails", async () => {
    const activeAdmin = await pool.query<{ id: string }>(
      `select id from memberships
       where tenant_id = ?1 and role = 'admin' and status = 'active' limit 1`,
      [TENANT_ONE],
    );
    const adminId = activeAdmin.rows[0]!.id;
    await database.failInserts(
      "audit_events",
      "new.action = 'member.updated'",
      "synthetic audit failure",
    );

    await expect(
      administrativelyUpdateMembership({
        tenantId: TENANT_ONE,
        membershipId: adminId,
        actorMembershipId: adminId,
        patch: { displayName: "Must roll back" },
      }),
    ).rejects.toThrow("synthetic audit failure");

    const member = await pool.query<{ displayName: string | null }>(
      'select display_name as "displayName" from memberships where id = ?1',
      [adminId],
    );
    expect(member.rows[0]?.displayName).not.toBe("Must roll back");
  });

  it("reoffers accepted work, keeps its linked request consistent, and audits each entity", async () => {
    const actor = await pool.query<{ id: string }>(
      `select id from memberships
       where tenant_id = ?1 and role = 'admin' and status = 'active' limit 1`,
      [TENANT_ONE],
    );
    const result = await administrativelyUpdateMembership({
      tenantId: TENANT_ONE,
      membershipId: PILOT_ONE,
      actorMembershipId: actor.rows[0]!.id,
      patch: { role: "dispatcher" },
      reassignToMembershipId: PILOT_TWO,
    });

    expect(result).toMatchObject({
      kind: "updated",
      reassignedFlightCount: 1,
      reassignedScheduleRequestCount: 1,
    });
    const flight = await pool.query<{
      pilotMembershipId: string;
      status: string;
      version: number;
      assignmentRevision: number;
      assignmentConfirmedRevision: number | null;
    }>(
      `select
         pilot_membership_id as "pilotMembershipId",
         status,
         version,
         assignment_revision as "assignmentRevision",
         assignment_confirmed_revision as "assignmentConfirmedRevision"
       from flights where id = ?1`,
      [FLIGHT_ONE],
    );
    expect(flight.rows[0]).toEqual({
      pilotMembershipId: PILOT_TWO,
      status: "offered",
      version: 2,
      assignmentRevision: 2,
      assignmentConfirmedRevision: null,
    });
    const request = await pool.query<{
      pilotMembershipId: string;
      version: number;
    }>(
      `select pilot_membership_id as "pilotMembershipId", version
       from schedule_requests where id = ?1`,
      [REQUEST_ONE],
    );
    expect(request.rows[0]).toEqual({
      pilotMembershipId: PILOT_TWO,
      version: 2,
    });
    const events = await pool.query<{
      action: string;
      meta: Record<string, unknown>;
    }>(
      `select action, meta from audit_events
       where tenant_id = ?1
         and action in (
           'flight.assignment_reassigned',
           'schedule_request.assignment_reassigned'
         ) order by action`,
      [TENANT_ONE],
    );
    expect(events.rows.map((event) => event.action)).toEqual([
      "flight.assignment_reassigned",
      "schedule_request.assignment_reassigned",
    ]);
    expect(JSON.parse(String(events.rows[0]?.meta))).toMatchObject({
      before: {
        pilotMembershipId: PILOT_ONE,
        status: "accepted",
        version: 1,
        assignmentRevision: 1,
        assignmentConfirmedRevision: 1,
      },
      after: {
        pilotMembershipId: PILOT_TWO,
        status: "offered",
        version: 2,
        assignmentRevision: 2,
        assignmentConfirmedRevision: null,
      },
      acceptanceInvalidated: true,
      reason: "member_became_ineligible",
    });
    expect(JSON.parse(String(events.rows[1]?.meta))).toMatchObject({
      before: {
        pilotMembershipId: PILOT_ONE,
        status: "in_review",
        version: 1,
      },
      after: {
        pilotMembershipId: PILOT_TWO,
        status: "in_review",
        version: 2,
      },
      reason: "member_became_ineligible",
    });
  });

  it("rejects a cross-tenant replacement and blocks changes during an active flight", async () => {
    const actor = await pool.query<{ id: string }>(
      `select id from memberships
       where tenant_id = ?1 and role = 'admin' and status = 'active' limit 1`,
      [TENANT_ONE],
    );
    const crossTenant = await administrativelyUpdateMembership({
      tenantId: TENANT_ONE,
      membershipId: PILOT_TWO,
      actorMembershipId: actor.rows[0]!.id,
      patch: { status: "disabled" },
      reassignToMembershipId: OUTSIDE_PILOT,
    });
    expect(crossTenant).toMatchObject({
      kind: "blocked",
      reason: "invalid_replacement",
    });
    await expect(
      administrativelyUpdateMembership({
        tenantId: TENANT_ONE,
        membershipId: OUTSIDE_PILOT,
        actorMembershipId: ADMIN_ONE,
        patch: { displayName: "Cross-tenant write" },
      }),
    ).resolves.toEqual({ kind: "not_found" });

    await pool.query(
      `insert into flights (
        id, tenant_id, pilot_membership_id, flight_number, dep_icao, arr_icao,
        etd, eta, status
      ) values (?1, ?2, ?3, 'SK902', 'EKCH', 'ENGM', cast(unixepoch('subsec') * 1000 as integer), cast(unixepoch('subsec') * 1000 as integer) + 3600000, 'active')`,
      [FLIGHT_ACTIVE, TENANT_ONE, PILOT_TWO],
    );
    const active = await administrativelyUpdateMembership({
      tenantId: TENANT_ONE,
      membershipId: PILOT_TWO,
      actorMembershipId: actor.rows[0]!.id,
      patch: { status: "disabled" },
    });
    expect(active).toMatchObject({
      kind: "blocked",
      reason: "active_flight",
    });
  });

  it("lets a committed briefed-to-active transition win without reassigning the active flight", async () => {
    await insertFlight(FLIGHT_RACE, PILOT_TWO, "SK905", "briefed");
    // D1 serializes writes: the pilot's transition commits first.
    await database.query(
      "update flights set status = 'active' where id = ? and status = 'briefed'",
      FLIGHT_RACE,
    );
    await expect(
      administrativelyUpdateMembership({
        tenantId: TENANT_ONE,
        membershipId: PILOT_TWO,
        actorMembershipId: ADMIN_ONE,
        patch: { status: "disabled" },
        reassignToMembershipId: PILOT_ONE,
      }),
    ).resolves.toMatchObject({ kind: "blocked", reason: "active_flight" });
    const flight = await pool.query(
      `select pilot_membership_id as "pilotMembershipId", status
       from flights where id = ?1`,
      [FLIGHT_RACE],
    );
    expect(flight.rows[0]).toEqual({
      pilotMembershipId: PILOT_TWO,
      status: "active",
    });
  });

  it("lets admin reassignment win without a stale briefed-to-active overwrite", async () => {
    await insertFlight(FLIGHT_RACE, PILOT_TWO, "SK905", "briefed");
    await expect(
      administrativelyUpdateMembership({
        tenantId: TENANT_ONE,
        membershipId: PILOT_TWO,
        actorMembershipId: ADMIN_ONE,
        patch: { status: "disabled" },
        reassignToMembershipId: PILOT_ONE,
      }),
    ).resolves.toMatchObject({ kind: "updated", reassignedFlightCount: 1 });
    // The stale transition still expects the briefed state it read earlier.
    const stale = await database.query(
      "update flights set status = 'active' where id = ? and status = 'briefed' returning id",
      FLIGHT_RACE,
    );
    expect(stale).toHaveLength(0);
    const flight = await pool.query(
      `select pilot_membership_id as "pilotMembershipId", status
       from flights where id = ?1`,
      [FLIGHT_RACE],
    );
    expect(flight.rows[0]).toEqual({
      pilotMembershipId: PILOT_ONE,
      status: "offered",
    });
  });

  it("does not rewrite request ownership when a committed terminal transition wins", async () => {
    await database.query(
      "update schedule_requests set status = 'fulfilled' where id = ? and status = 'in_review'",
      REQUEST_ONE,
    );
    await expect(
      administrativelyUpdateMembership({
        tenantId: TENANT_ONE,
        membershipId: PILOT_ONE,
        actorMembershipId: ADMIN_ONE,
        patch: { status: "disabled" },
        reassignToMembershipId: PILOT_TWO,
      }),
    ).resolves.toMatchObject({
      kind: "blocked",
      reason: "terminal_request_link",
    });
    const request = await pool.query(
      `select pilot_membership_id as "pilotMembershipId", status
       from schedule_requests where id = ?1`,
      [REQUEST_ONE],
    );
    expect(request.rows[0]).toEqual({
      pilotMembershipId: PILOT_ONE,
      status: "fulfilled",
    });
    const flight = await pool.query<{ pilotMembershipId: string }>(
      `select pilot_membership_id as "pilotMembershipId"
       from flights where id = ?1`,
      [FLIGHT_ONE],
    );
    expect(flight.rows[0]?.pilotMembershipId).toBe(PILOT_ONE);
  });

  it("lets admin reassignment win before a stale terminal transition", async () => {
    await expect(
      administrativelyUpdateMembership({
        tenantId: TENANT_ONE,
        membershipId: PILOT_ONE,
        actorMembershipId: ADMIN_ONE,
        patch: { status: "disabled" },
        reassignToMembershipId: PILOT_TWO,
      }),
    ).resolves.toMatchObject({
      kind: "updated",
      reassignedScheduleRequestCount: 1,
    });
    const stale = await database.query(
      `update schedule_requests set status = 'fulfilled'
       where id = ? and pilot_membership_id = ? and status = 'in_review'
       returning id`,
      REQUEST_ONE,
      PILOT_ONE,
    );
    expect(stale).toHaveLength(0);
    const request = await pool.query(
      `select pilot_membership_id as "pilotMembershipId", status
       from schedule_requests where id = ?1`,
      [REQUEST_ONE],
    );
    expect(request.rows[0]).toEqual({
      pilotMembershipId: PILOT_TWO,
      status: "in_review",
    });
  });

  it("blocks reassignment instead of rewriting terminal schedule-request history", async () => {
    await pool.query(
      `insert into schedule_requests (
        id, tenant_id, pilot_membership_id, window_start, window_end,
        desired_flight_count, status
      ) values (?1, ?2, ?3, cast(unixepoch('subsec') * 1000 as integer), cast(unixepoch('subsec') * 1000 as integer) + 86400000, 1, 'fulfilled')`,
      [REQUEST_TERMINAL, TENANT_ONE, PILOT_ONE],
    );
    await pool.query(
      `insert into flights (
        id, tenant_id, schedule_request_id, pilot_membership_id, flight_number,
        dep_icao, arr_icao, etd, eta, status
      ) values (
        ?1, ?2, ?3, ?4, 'SK903', 'EKCH', 'ENGM', cast(unixepoch('subsec') * 1000 as integer),
        cast(unixepoch('subsec') * 1000 as integer) + 3600000, 'accepted'
      )`,
      [FLIGHT_TERMINAL_LINK, TENANT_ONE, REQUEST_TERMINAL, PILOT_ONE],
    );

    const result = await administrativelyUpdateMembership({
      tenantId: TENANT_ONE,
      membershipId: PILOT_ONE,
      actorMembershipId: ADMIN_ONE,
      patch: { status: "disabled" },
      reassignToMembershipId: PILOT_TWO,
    });
    expect(result).toMatchObject({
      kind: "blocked",
      reason: "terminal_request_link",
      impact: { terminalRequestLinkedFlightCount: 1 },
    });
    const request = await pool.query<{ pilotMembershipId: string }>(
      `select pilot_membership_id as "pilotMembershipId"
       from schedule_requests where id = ?1`,
      [REQUEST_TERMINAL],
    );
    expect(request.rows[0]?.pilotMembershipId).toBe(PILOT_ONE);
  });

  it("transfers assigned draft work without changing its status", async () => {
    await pool.query(
      `insert into flights (
        id, tenant_id, pilot_membership_id, flight_number, dep_icao, arr_icao,
        etd, eta, status
      ) values (?1, ?2, ?3, 'SK904', 'EKCH', 'ENGM', cast(unixepoch('subsec') * 1000 as integer), cast(unixepoch('subsec') * 1000 as integer) + 3600000, 'draft')`,
      [FLIGHT_DRAFT, TENANT_ONE, PILOT_TWO],
    );
    const result = await administrativelyUpdateMembership({
      tenantId: TENANT_ONE,
      membershipId: PILOT_TWO,
      actorMembershipId: ADMIN_ONE,
      patch: { status: "disabled" },
      reassignToMembershipId: PILOT_ONE,
    });
    expect(result).toMatchObject({ kind: "updated", reassignedFlightCount: 1 });
    const flight = await pool.query<{
      pilotMembershipId: string;
      status: string;
    }>(
      `select pilot_membership_id as "pilotMembershipId", status
       from flights where id = ?1`,
      [FLIGHT_DRAFT],
    );
    expect(flight.rows[0]).toEqual({
      pilotMembershipId: PILOT_ONE,
      status: "draft",
    });
  });

  it("creates a directory member and audit atomically", async () => {
    const actor = await pool.query<{ id: string }>(
      `select id from memberships
       where tenant_id = ?1 and role = 'admin' and status = 'active' limit 1`,
      [TENANT_ONE],
    );
    const created = await createDirectoryMembershipWithAudit({
      tenantId: TENANT_ONE,
      actorMembershipId: actor.rows[0]!.id,
      authUserId: "user_directory_atomic",
      role: "pilot",
      displayName: "Directory Pilot",
    });
    expect(created).toMatchObject({
      authUserId: "user_directory_atomic",
      role: "pilot",
    });
    const audit = await pool.query<{ count: number }>(
      `select count(*) as count from audit_events
       where tenant_id = ?1 and entity_id = ?2 and action = 'member.directory_created'`,
      [TENANT_ONE, created!.id],
    );
    expect(audit.rows[0]?.count).toBe(1);
  });

  it("provisions first-login membership as pilot with a self-attributed audit", async () => {
    const created = await provisionPilotMembershipWithAudit({
      tenantId: TENANT_ONE,
      authUserId: "user_first_login",
    });

    expect(created).toMatchObject({
      authUserId: "user_first_login",
      role: "pilot",
      status: "active",
    });
    const audit = await pool.query<{
      actorMembershipId: string;
      authority: string;
    }>(
      `select
         actor_membership_id as "actorMembershipId",
         meta ->> '$.authority' as authority
       from audit_events
       where tenant_id = ?1
         and entity_id = ?2
         and action = 'member.self_provisioned'`,
      [TENANT_ONE, created.id],
    );
    expect(audit.rows).toEqual([
      {
        actorMembershipId: created.id,
        authority: "verified_identity_membership",
      },
    ]);
  });

  it("rolls back first-login membership when its audit insert fails", async () => {
    await database.failInserts(
      "audit_events",
      "new.action = 'member.self_provisioned'",
      "synthetic self-provision audit failure",
    );

    await expect(
      provisionPilotMembershipWithAudit({
        tenantId: TENANT_ONE,
        authUserId: "user_unaudited_first_login",
      }),
    ).rejects.toThrow("synthetic self-provision audit failure");

    const membership = await pool.query<{ count: number }>(
      `select count(*) as count
       from memberships
       where tenant_id = ?1 and auth_user_id = ?2`,
      [TENANT_ONE, "user_unaudited_first_login"],
    );
    expect(membership.rows[0]?.count).toBe(0);
  });

  it("submits, updates, and cancels a tenant-scoped membership application atomically", async () => {
    const authUserId = "user_membership_applicant";
    const submitted = await submitMembershipApplicationWithAudit({
      tenantId: TENANT_ONE,
      authUserId,
      requestedRole: "dispatcher",
      displayName: "Applicant",
    });
    expect(submitted).toMatchObject({
      submitted: true,
      membership: {
        tenantId: TENANT_ONE,
        authUserId,
        role: "dispatcher",
        status: "invited",
      },
    });

    const revised = await submitMembershipApplicationWithAudit({
      tenantId: TENANT_ONE,
      authUserId,
      requestedRole: "pilot",
      displayName: "Applicant Updated",
    });
    expect(revised.membership).toMatchObject({
      id: submitted.membership.id,
      role: "pilot",
      displayName: "Applicant Updated",
      status: "invited",
    });

    await expect(
      cancelMembershipApplicationWithAudit({
        tenantId: TENANT_TWO,
        authUserId,
      }),
    ).resolves.toBeNull();
    await expect(
      cancelMembershipApplicationWithAudit({
        tenantId: TENANT_ONE,
        authUserId,
      }),
    ).resolves.toMatchObject({
      id: submitted.membership.id,
      role: "pilot",
      status: "disabled",
    });

    const audit = await pool.query<{ action: string }>(
      `select action from audit_events
       where tenant_id = ?1 and entity_id = ?2
       order by created_at`,
      [TENANT_ONE, submitted.membership.id],
    );
    expect(audit.rows.map((row) => row.action)).toEqual([
      "membership.application_submitted",
      "membership.application_submitted",
      "membership.application_cancelled",
    ]);
  });

  it("never downgrades an active member through membership application submission", async () => {
    const result = await submitMembershipApplicationWithAudit({
      tenantId: TENANT_ONE,
      authUserId: "pilot_one",
      requestedRole: "dispatcher",
      displayName: "Attempted Application",
    });

    expect(result).toMatchObject({
      submitted: false,
      membership: {
        id: PILOT_ONE,
        role: "pilot",
        status: "active",
      },
    });
    const audit = await pool.query<{ count: number }>(
      `select count(*) as count from audit_events
       where tenant_id = ?1
         and entity_id = ?2
         and action = 'membership.application_submitted'`,
      [TENANT_ONE, PILOT_ONE],
    );
    expect(audit.rows[0]?.count).toBe(0);
  });

  it("accepts only the first decision for a pending membership application", async () => {
    const submitted = await submitMembershipApplicationWithAudit({
      tenantId: TENANT_ONE,
      authUserId: "user_decision_race",
      requestedRole: "dispatcher",
      displayName: "Decision Race",
    });
    const approved = await administrativelyUpdateMembership({
      tenantId: TENANT_ONE,
      membershipId: submitted.membership.id,
      actorMembershipId: ADMIN_ONE,
      patch: { role: "dispatcher", status: "active" },
      expectedStatus: "invited",
      auditAction: "membership.application_approved",
    });
    expect(approved).toMatchObject({
      kind: "updated",
      membership: {
        role: "dispatcher",
        status: "active",
      },
    });

    const staleDecision = await administrativelyUpdateMembership({
      tenantId: TENANT_ONE,
      membershipId: submitted.membership.id,
      actorMembershipId: ADMIN_ONE,
      patch: { status: "disabled" },
      expectedStatus: "invited",
      auditAction: "membership.application_rejected",
    });
    expect(staleDecision).toEqual({ kind: "not_found" });
  });

  it("recovers a verified caller only when the tenant has no active admin", async () => {
    const recovered = await recoverMembershipAsTenantAdmin({
      tenantId: TENANT_TWO,
      membershipId: OUTSIDE_PILOT,
    });
    expect(recovered).toMatchObject({ role: "admin", status: "active" });
    const secondAttempt = await recoverMembershipAsTenantAdmin({
      tenantId: TENANT_TWO,
      membershipId: OUTSIDE_PILOT,
    });
    expect(secondAttempt).toBeNull();
    const audit = await pool.query<{ count: number }>(
      `select count(*) as count from audit_events
       where tenant_id = ?1 and action = 'member.admin_recovered'`,
      [TENANT_TWO],
    );
    expect(audit.rows[0]?.count).toBe(1);
  });
});

async function seedFixtures({ db }: TestDatabase): Promise<void> {
  await db.insert(tenants).values([
    {
      id: TENANT_ONE,
      slug: "admin-test-one",
      name: "Admin Test One",
      authOrgId: "org_admin_test_one",
    },
    {
      id: TENANT_TWO,
      slug: "admin-test-two",
      name: "Admin Test Two",
      authOrgId: "org_admin_test_two",
    },
  ]);
  await db.insert(memberships).values([
    {
      id: ADMIN_ONE,
      tenantId: TENANT_ONE,
      authUserId: "admin_one",
      role: "admin",
      displayName: "Admin One",
      status: "active",
    },
    {
      id: ADMIN_TWO,
      tenantId: TENANT_ONE,
      authUserId: "admin_two",
      role: "admin",
      displayName: "Admin Two",
      status: "active",
    },
    {
      id: PILOT_ONE,
      tenantId: TENANT_ONE,
      authUserId: "pilot_one",
      role: "pilot",
      displayName: "Pilot One",
      status: "active",
    },
    {
      id: PILOT_TWO,
      tenantId: TENANT_ONE,
      authUserId: "pilot_two",
      role: "pilot",
      displayName: "Pilot Two",
      status: "active",
    },
    {
      id: OUTSIDE_PILOT,
      tenantId: TENANT_TWO,
      authUserId: "outside_pilot",
      role: "pilot",
      displayName: "Outside Pilot",
      status: "active",
    },
  ]);
  const now = new Date();
  await db.insert(scheduleRequests).values({
    id: REQUEST_ONE,
    tenantId: TENANT_ONE,
    pilotMembershipId: PILOT_ONE,
    windowStart: now,
    windowEnd: new Date(now.getTime() + 24 * HOUR),
    desiredFlightCount: 1,
    status: "in_review",
  });
  await db.insert(flights).values({
    id: FLIGHT_ONE,
    tenantId: TENANT_ONE,
    scheduleRequestId: REQUEST_ONE,
    pilotMembershipId: PILOT_ONE,
    flightNumber: "SK901",
    depIcao: "EKCH",
    arrIcao: "ENGM",
    etd: now,
    eta: new Date(now.getTime() + HOUR),
    status: "accepted",
    assignmentConfirmedRevision: 1,
    assignmentConfirmedAt: now,
  });
}
