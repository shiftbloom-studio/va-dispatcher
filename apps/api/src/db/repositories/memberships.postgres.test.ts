import { PgDialect } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/node-postgres";
import type { SQL } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { setDbForTests, type Db } from "../client.js";
import {
  administrativelyUpdateMembership,
  createDirectoryMembershipWithAudit,
  listMemberships,
  provisionPilotMembershipWithAudit,
  recoverMembershipAsTenantAdmin,
} from "./memberships.js";

const { Pool } = pg;
const databaseUrl = process.env.TEST_DATABASE_URL;
const confirmedDatabase = process.env.TEST_CONFIRM_DATABASE;
const describePostgres = databaseUrl ? describe : describe.skip;
const dialect = new PgDialect();

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

type BatchQuery = { query: SQL };

class PgTestAdapter {
  private nextCommitPause:
    | {
        reached: () => void;
        release: Promise<void>;
      }
    | undefined;

  constructor(private readonly pool: pg.Pool) {}

  execute(query: SQL): BatchQuery & PromiseLike<pg.QueryResult> {
    return {
      query,
      then: (onFulfilled, onRejected) =>
        this.run(query).then(onFulfilled, onRejected),
    };
  }

  async batch(queries: readonly BatchQuery[]): Promise<pg.QueryResult[]> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const results: pg.QueryResult[] = [];
      for (const item of queries) {
        const compiled = dialect.sqlToQuery(item.query);
        results.push(await client.query(compiled.sql, compiled.params));
      }
      const pause = this.nextCommitPause;
      this.nextCommitPause = undefined;
      if (pause) {
        pause.reached();
        await pause.release;
      }
      await client.query("commit");
      return results;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  private async run(query: SQL): Promise<pg.QueryResult> {
    const compiled = dialect.sqlToQuery(query);
    return this.pool.query(compiled.sql, compiled.params);
  }

  pauseNextBatchBeforeCommit(): {
    reached: Promise<void>;
    release: () => void;
  } {
    let markReached!: () => void;
    let release!: () => void;
    const reached = new Promise<void>((resolve) => {
      markReached = resolve;
    });
    const releasePromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.nextCommitPause = { reached: markReached, release: releasePromise };
    return { reached, release };
  }
}

describePostgres("administrative member transactions (PostgreSQL)", () => {
  let pool: pg.Pool;
  let adapter: PgTestAdapter;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    const database = await pool.query<{ currentDatabase: string }>(
      'select current_database() as "currentDatabase"',
    );
    expect(database.rows[0]?.currentDatabase).toBe(confirmedDatabase);
    adapter = new PgTestAdapter(pool);
    setDbForTests(createPgTestDatabase(pool, adapter));
  });

  beforeEach(async () => {
    await resetFixtures(pool);
  });

  afterAll(async () => {
    setDbForTests(null);
    if (pool) {
      await pool.query(
        "drop trigger if exists audit_events_test_failure on audit_events",
      );
      await pool.query(
        "drop trigger if exists self_provision_audit_test_failure on audit_events",
      );
      await pool.query(
        "drop function if exists reject_test_audit_event() cascade",
      );
      await pool.query(
        "drop function if exists reject_self_provision_audit() cascade",
      );
      await pool.query("delete from tenants where id = any($1::uuid[])", [
        [TENANT_ONE, TENANT_TWO],
      ]);
      await pool.end();
    }
  });

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
      `select count(*)::int as count from memberships
       where tenant_id = $1 and role = 'admin' and status = 'active'`,
      [TENANT_ONE],
    );
    expect(activeAdmins.rows[0]?.count).toBe(1);
    const audits = await pool.query<{ count: number }>(
      `select count(*)::int as count from audit_events
       where tenant_id = $1 and action = 'member.updated'`,
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
       where tenant_id = $1 and role = 'admin' and status = 'active' limit 1`,
      [TENANT_ONE],
    );
    const adminId = activeAdmin.rows[0]!.id;
    await pool.query(`
      create or replace function reject_test_audit_event()
      returns trigger language plpgsql as $$
      begin
        if new.action = 'member.updated' then
          raise exception 'synthetic audit failure';
        end if;
        return new;
      end $$
    `);
    await pool.query(`
      create trigger audit_events_test_failure
      before insert on audit_events
      for each row execute function reject_test_audit_event()
    `);

    await expect(
      administrativelyUpdateMembership({
        tenantId: TENANT_ONE,
        membershipId: adminId,
        actorMembershipId: adminId,
        patch: { displayName: "Must roll back" },
      }),
    ).rejects.toThrow("synthetic audit failure");
    await pool.query("drop trigger audit_events_test_failure on audit_events");

    const member = await pool.query<{ displayName: string | null }>(
      'select display_name as "displayName" from memberships where id = $1',
      [adminId],
    );
    expect(member.rows[0]?.displayName).not.toBe("Must roll back");
  });

  it("reoffers accepted work, keeps its linked request consistent, and audits each entity", async () => {
    const actor = await pool.query<{ id: string }>(
      `select id from memberships
       where tenant_id = $1 and role = 'admin' and status = 'active' limit 1`,
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
       from flights where id = $1`,
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
       from schedule_requests where id = $1`,
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
       where tenant_id = $1
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
    expect(events.rows[0]?.meta).toMatchObject({
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
    expect(events.rows[1]?.meta).toMatchObject({
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
       where tenant_id = $1 and role = 'admin' and status = 'active' limit 1`,
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
      ) values ($1, $2, $3, 'SK902', 'EKCH', 'ENGM', now(), now() + interval '1 hour', 'active')`,
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

  it("lets a concurrent briefed-to-active transition win without reassigning the active flight", async () => {
    await pool.query(
      `insert into flights (
        id, tenant_id, pilot_membership_id, flight_number, dep_icao, arr_icao,
        etd, eta, status
      ) values ($1, $2, $3, 'SK905', 'EKCH', 'ENGM', now(), now() + interval '1 hour', 'briefed')`,
      [FLIGHT_RACE, TENANT_ONE, PILOT_TWO],
    );
    const transition = await pool.connect();
    let transactionOpen = false;
    try {
      await transition.query("begin");
      transactionOpen = true;
      await transition.query(
        `update flights set status = 'active', updated_at = now()
         where id = $1 and status = 'briefed'`,
        [FLIGHT_RACE],
      );
      const administration = administrativelyUpdateMembership({
        tenantId: TENANT_ONE,
        membershipId: PILOT_TWO,
        actorMembershipId: ADMIN_ONE,
        patch: { status: "disabled" },
        reassignToMembershipId: PILOT_ONE,
      });
      await waitForLockWait(pool, "with target as materialized");
      await transition.query("commit");
      transactionOpen = false;

      await expect(administration).resolves.toMatchObject({
        kind: "blocked",
        reason: "active_flight",
      });
    } finally {
      if (transactionOpen) {
        await transition.query("rollback").catch(() => undefined);
      }
      transition.release();
    }
    const flight = await pool.query<{
      pilotMembershipId: string;
      status: string;
    }>(
      `select pilot_membership_id as "pilotMembershipId", status
       from flights where id = $1`,
      [FLIGHT_RACE],
    );
    expect(flight.rows[0]).toEqual({
      pilotMembershipId: PILOT_TWO,
      status: "active",
    });
  });

  it("lets admin reassignment win without a stale briefed-to-active overwrite", async () => {
    await pool.query(
      `insert into flights (
        id, tenant_id, pilot_membership_id, flight_number, dep_icao, arr_icao,
        etd, eta, status
      ) values ($1, $2, $3, 'SK905', 'EKCH', 'ENGM', now(), now() + interval '1 hour', 'briefed')`,
      [FLIGHT_RACE, TENANT_ONE, PILOT_TWO],
    );
    const gate = adapter.pauseNextBatchBeforeCommit();
    const administration = administrativelyUpdateMembership({
      tenantId: TENANT_ONE,
      membershipId: PILOT_TWO,
      actorMembershipId: ADMIN_ONE,
      patch: { status: "disabled" },
      reassignToMembershipId: PILOT_ONE,
    });
    await gate.reached;
    const transition = pool.query(
      `update flights set status = 'active', updated_at = now()
       where id = $1 and status = 'briefed'
       returning id`,
      [FLIGHT_RACE],
    );
    await waitForLockWait(pool, "update flights set status = 'active'");
    gate.release();

    await expect(administration).resolves.toMatchObject({
      kind: "updated",
      reassignedFlightCount: 1,
    });
    expect((await transition).rowCount).toBe(0);
    const flight = await pool.query<{
      pilotMembershipId: string;
      status: string;
    }>(
      `select pilot_membership_id as "pilotMembershipId", status
       from flights where id = $1`,
      [FLIGHT_RACE],
    );
    expect(flight.rows[0]).toEqual({
      pilotMembershipId: PILOT_ONE,
      status: "offered",
    });
  });

  it("does not rewrite request ownership when a concurrent terminal transition wins", async () => {
    const transition = await pool.connect();
    let transactionOpen = false;
    try {
      await transition.query("begin");
      transactionOpen = true;
      await transition.query(
        `update schedule_requests set status = 'fulfilled', updated_at = now()
         where id = $1 and status = 'in_review'`,
        [REQUEST_ONE],
      );
      const administration = administrativelyUpdateMembership({
        tenantId: TENANT_ONE,
        membershipId: PILOT_ONE,
        actorMembershipId: ADMIN_ONE,
        patch: { status: "disabled" },
        reassignToMembershipId: PILOT_TWO,
      });
      await waitForLockWait(pool, "with target as materialized");
      await transition.query("commit");
      transactionOpen = false;

      await expect(administration).resolves.toMatchObject({
        kind: "blocked",
        reason: "terminal_request_link",
      });
    } finally {
      if (transactionOpen) {
        await transition.query("rollback").catch(() => undefined);
      }
      transition.release();
    }
    const request = await pool.query<{
      pilotMembershipId: string;
      status: string;
    }>(
      `select pilot_membership_id as "pilotMembershipId", status
       from schedule_requests where id = $1`,
      [REQUEST_ONE],
    );
    expect(request.rows[0]).toEqual({
      pilotMembershipId: PILOT_ONE,
      status: "fulfilled",
    });
    const flight = await pool.query<{ pilotMembershipId: string }>(
      `select pilot_membership_id as "pilotMembershipId"
       from flights where id = $1`,
      [FLIGHT_ONE],
    );
    expect(flight.rows[0]?.pilotMembershipId).toBe(PILOT_ONE);
  });

  it("lets admin reassignment win before a stale terminal transition", async () => {
    const gate = adapter.pauseNextBatchBeforeCommit();
    const administration = administrativelyUpdateMembership({
      tenantId: TENANT_ONE,
      membershipId: PILOT_ONE,
      actorMembershipId: ADMIN_ONE,
      patch: { status: "disabled" },
      reassignToMembershipId: PILOT_TWO,
    });
    await gate.reached;
    const terminalTransition = pool.query(
      `update schedule_requests
       set status = 'fulfilled', updated_at = now()
       where id = $1
         and pilot_membership_id = $2
         and status = 'in_review'
       returning id`,
      [REQUEST_ONE, PILOT_ONE],
    );
    await waitForLockWait(pool, "update schedule_requests");
    gate.release();

    await expect(administration).resolves.toMatchObject({
      kind: "updated",
      reassignedScheduleRequestCount: 1,
    });
    expect((await terminalTransition).rowCount).toBe(0);
    const request = await pool.query<{
      pilotMembershipId: string;
      status: string;
    }>(
      `select pilot_membership_id as "pilotMembershipId", status
       from schedule_requests where id = $1`,
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
      ) values ($1, $2, $3, now(), now() + interval '1 day', 1, 'fulfilled')`,
      [REQUEST_TERMINAL, TENANT_ONE, PILOT_ONE],
    );
    await pool.query(
      `insert into flights (
        id, tenant_id, schedule_request_id, pilot_membership_id, flight_number,
        dep_icao, arr_icao, etd, eta, status
      ) values (
        $1, $2, $3, $4, 'SK903', 'EKCH', 'ENGM', now(),
        now() + interval '1 hour', 'accepted'
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
       from schedule_requests where id = $1`,
      [REQUEST_TERMINAL],
    );
    expect(request.rows[0]?.pilotMembershipId).toBe(PILOT_ONE);
  });

  it("transfers assigned draft work without changing its status", async () => {
    await pool.query(
      `insert into flights (
        id, tenant_id, pilot_membership_id, flight_number, dep_icao, arr_icao,
        etd, eta, status
      ) values ($1, $2, $3, 'SK904', 'EKCH', 'ENGM', now(), now() + interval '1 hour', 'draft')`,
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
       from flights where id = $1`,
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
       where tenant_id = $1 and role = 'admin' and status = 'active' limit 1`,
      [TENANT_ONE],
    );
    const created = await createDirectoryMembershipWithAudit({
      tenantId: TENANT_ONE,
      actorMembershipId: actor.rows[0]!.id,
      clerkUserId: "user_directory_atomic",
      role: "pilot",
      displayName: "Directory Pilot",
    });
    expect(created).toMatchObject({
      clerkUserId: "user_directory_atomic",
      role: "pilot",
    });
    const audit = await pool.query<{ count: number }>(
      `select count(*)::int as count from audit_events
       where tenant_id = $1 and entity_id = $2 and action = 'member.directory_created'`,
      [TENANT_ONE, created!.id],
    );
    expect(audit.rows[0]?.count).toBe(1);
  });

  it("provisions first-login membership as pilot with a self-attributed audit", async () => {
    const created = await provisionPilotMembershipWithAudit({
      tenantId: TENANT_ONE,
      clerkUserId: "user_first_login",
    });

    expect(created).toMatchObject({
      clerkUserId: "user_first_login",
      role: "pilot",
      status: "active",
    });
    const audit = await pool.query<{
      actorMembershipId: string;
      authority: string;
    }>(
      `select
         actor_membership_id as "actorMembershipId",
         meta->>'authority' as authority
       from audit_events
       where tenant_id = $1
         and entity_id = $2
         and action = 'member.self_provisioned'`,
      [TENANT_ONE, created.id],
    );
    expect(audit.rows).toEqual([
      {
        actorMembershipId: created.id,
        authority: "verified_clerk_membership",
      },
    ]);
  });

  it("rolls back first-login membership when its audit insert fails", async () => {
    await pool.query(`
      create or replace function reject_self_provision_audit()
      returns trigger language plpgsql as $$
      begin
        if new.action = 'member.self_provisioned' then
          raise exception 'synthetic self-provision audit failure';
        end if;
        return new;
      end $$
    `);
    await pool.query(`
      create trigger self_provision_audit_test_failure
      before insert on audit_events
      for each row execute function reject_self_provision_audit()
    `);

    await expect(
      provisionPilotMembershipWithAudit({
        tenantId: TENANT_ONE,
        clerkUserId: "user_unaudited_first_login",
      }),
    ).rejects.toThrow("synthetic self-provision audit failure");
    await pool.query(
      "drop trigger self_provision_audit_test_failure on audit_events",
    );

    const membership = await pool.query<{ count: number }>(
      `select count(*)::int as count
       from memberships
       where tenant_id = $1 and clerk_user_id = $2`,
      [TENANT_ONE, "user_unaudited_first_login"],
    );
    expect(membership.rows[0]?.count).toBe(0);
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
      `select count(*)::int as count from audit_events
       where tenant_id = $1 and action = 'member.admin_recovered'`,
      [TENANT_TWO],
    );
    expect(audit.rows[0]?.count).toBe(1);
  });
});

function createPgTestDatabase(pool: pg.Pool, batchAdapter: PgTestAdapter): Db {
  const database = drizzle({ client: pool });
  return new Proxy(database, {
    get(target, property, receiver) {
      if (property === "execute")
        return batchAdapter.execute.bind(batchAdapter);
      if (property === "batch") return batchAdapter.batch.bind(batchAdapter);
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as unknown as Db;
}

async function resetFixtures(pool: pg.Pool): Promise<void> {
  await pool.query("delete from tenants where id = any($1::uuid[])", [
    [TENANT_ONE, TENANT_TWO],
  ]);
  await pool.query(
    `insert into tenants (id, slug, name, clerk_org_id) values
      ($1, 'admin-test-one', 'Admin Test One', 'org_admin_test_one'),
      ($2, 'admin-test-two', 'Admin Test Two', 'org_admin_test_two')`,
    [TENANT_ONE, TENANT_TWO],
  );
  await pool.query(
    `insert into memberships (
      id, tenant_id, clerk_user_id, role, display_name, status
    ) values
      ($1, $6, 'admin_one', 'admin', 'Admin One', 'active'),
      ($2, $6, 'admin_two', 'admin', 'Admin Two', 'active'),
      ($3, $6, 'pilot_one', 'pilot', 'Pilot One', 'active'),
      ($4, $6, 'pilot_two', 'pilot', 'Pilot Two', 'active'),
      ($5, $7, 'outside_pilot', 'pilot', 'Outside Pilot', 'active')`,
    [
      ADMIN_ONE,
      ADMIN_TWO,
      PILOT_ONE,
      PILOT_TWO,
      OUTSIDE_PILOT,
      TENANT_ONE,
      TENANT_TWO,
    ],
  );
  await pool.query(
    `insert into schedule_requests (
      id, tenant_id, pilot_membership_id, window_start, window_end,
      desired_flight_count, status
    ) values ($1, $2, $3, now(), now() + interval '1 day', 1, 'in_review')`,
    [REQUEST_ONE, TENANT_ONE, PILOT_ONE],
  );
  await pool.query(
    `insert into flights (
      id, tenant_id, schedule_request_id, pilot_membership_id, flight_number,
      dep_icao, arr_icao, etd, eta, status,
      assignment_confirmed_revision, assignment_confirmed_at
    ) values (
      $1, $2, $3, $4, 'SK901', 'EKCH', 'ENGM', now(),
      now() + interval '1 hour', 'accepted', 1, now()
    )`,
    [FLIGHT_ONE, TENANT_ONE, REQUEST_ONE, PILOT_ONE],
  );
}

async function waitForLockWait(pool: pg.Pool, queryFragment: string) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const waiting = await pool.query<{ waiting: boolean }>(
      `select exists (
        select 1 from pg_stat_activity
        where datname = current_database()
          and wait_event_type = 'Lock'
          and query ilike '%' || $1 || '%'
      ) as waiting`,
      [queryFragment],
    );
    if (waiting.rows[0]?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for PostgreSQL lock: ${queryFragment}`);
}
