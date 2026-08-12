import type { SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { PgDialect } from "drizzle-orm/pg-core";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setDbForTests, type Db } from "../client.js";
import {
  anonymizePrivacySubject,
  approveLegalHold,
  approvePrivacyPolicy,
  approvePrivacySubjectRequest,
  completePrivacyRequest,
  createExternalRequestTasks,
  createLegalHold,
  createPrivacyPolicy,
  createPrivacySubjectRequest,
  createRetentionRun,
  erasePrivacySubject,
  executeRetentionClass,
  findBlockingLegalHold,
  findPrivacySubjectRequest,
  inspectRetentionClass,
  listPrivacyExportStoreRecords,
  markPrivacyRequestBlocked,
  PRIVACY_EXPORT_STORES,
  releaseLegalHold,
  retryBlockedPrivacyRequest,
  upsertSubjectRestriction,
} from "./privacy.js";
import {
  DEFAULT_RETENTION_POLICY,
  emptyRetentionReport,
} from "../../domain/privacy/policy.js";

const { Pool } = pg;
const databaseUrl = process.env.TEST_DATABASE_URL;
const confirmedDatabase = process.env.PRIVACY_TEST_CONFIRM_DATABASE;
const describePostgres = databaseUrl ? describe : describe.skip;
const dialect = new PgDialect();

const TENANT_ONE = "28000000-0000-4000-8000-000000000001";
const TENANT_TWO = "28000000-0000-4000-8000-000000000002";
const ADMIN_ONE = "28000000-0000-4000-8000-000000000011";
const ADMIN_TWO = "28000000-0000-4000-8000-000000000012";
const ADMIN_THREE = "28000000-0000-4000-8000-000000000013";
const SUBJECT_ONE = "28000000-0000-4000-8000-000000000021";
const SUBJECT_TWO = "28000000-0000-4000-8000-000000000022";
const FLIGHT_ONE = "28000000-0000-4000-8000-000000000031";
const FLIGHT_TWO = "28000000-0000-4000-8000-000000000032";
const REQUEST_ONE = "28000000-0000-4000-8000-000000000041";
const REQUEST_TWO = "28000000-0000-4000-8000-000000000042";
const DEVICE_ONE = "28000000-0000-4000-8000-000000000061";
const DEVICE_TWO = "28000000-0000-4000-8000-000000000062";
const TRACK_ONE = "28000000-0000-4000-8000-000000000071";
const TRACK_TWO = "28000000-0000-4000-8000-000000000072";
const NOW = new Date("2026-08-12T12:00:00.000Z");

type BatchQuery = { query: SQL };

class PgBatchAdapter {
  private nextCommitPause:
    { reached: () => void; release: Promise<void> } | undefined;

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

  private run(query: SQL): Promise<pg.QueryResult> {
    const compiled = dialect.sqlToQuery(query);
    return this.pool.query(compiled.sql, compiled.params);
  }

  pauseNextBatchBeforeCommit(): {
    reached: Promise<void>;
    release: () => void;
  } {
    let reached!: () => void;
    let release!: () => void;
    const reachedPromise = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const releasePromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.nextCommitPause = { reached, release: releasePromise };
    return { reached: reachedPromise, release };
  }
}

function createPgTestDatabase(pool: pg.Pool, batchAdapter: PgBatchAdapter): Db {
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

describePostgres("privacy lifecycle repository (PostgreSQL)", () => {
  let pool: pg.Pool;
  let batchAdapter: PgBatchAdapter;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    const database = await pool.query<{ currentDatabase: string }>(
      'select current_database() as "currentDatabase"',
    );
    expect(database.rows[0]?.currentDatabase).toBe(confirmedDatabase);
    batchAdapter = new PgBatchAdapter(pool);
    setDbForTests(createPgTestDatabase(pool, batchAdapter));
  });

  beforeEach(async () => {
    await resetFixtures(pool);
  });

  afterAll(async () => {
    setDbForTests(null);
    await pool.end();
  });

  it("dual-approves one active immutable policy and is tenant-scoped", async () => {
    const policy = await createPrivacyPolicy({
      tenantId: TENANT_ONE,
      actorMembershipId: ADMIN_ONE,
      config: DEFAULT_RETENTION_POLICY,
    });
    expect(policy.version).toBe(1);
    expect(
      await approvePrivacyPolicy({
        tenantId: TENANT_ONE,
        policyId: policy.id,
        actorMembershipId: ADMIN_ONE,
      }),
    ).toBeNull();
    expect(
      await approvePrivacyPolicy({
        tenantId: TENANT_TWO,
        policyId: policy.id,
        actorMembershipId: ADMIN_TWO,
      }),
    ).toBeNull();

    const active = await approvePrivacyPolicy({
      tenantId: TENANT_ONE,
      policyId: policy.id,
      actorMembershipId: ADMIN_TWO,
    });
    expect(active).toMatchObject({ status: "active", version: 1 });
    const audit = await pool.query<{ count: string }>(
      "select count(*) from audit_events where tenant_id=$1 and action='privacy.policy_approved'",
      [TENANT_ONE],
    );
    expect(audit.rows[0]?.count).toBe("1");
  });

  it("deduplicates retention runs by tenant and rejects cross-tenant lookup", async () => {
    const policy = await activePolicy();
    const first = await createRetentionRun({
      tenantId: TENANT_ONE,
      policyId: policy.id,
      mode: "dry_run",
      asOf: NOW,
      idempotencyKey: "privacy-idempotency-one",
      actorMembershipId: ADMIN_ONE,
      report: emptyRetentionReport(NOW),
    });
    const second = await createRetentionRun({
      tenantId: TENANT_ONE,
      policyId: policy.id,
      mode: "dry_run",
      asOf: NOW,
      idempotencyKey: "privacy-idempotency-one",
      actorMembershipId: ADMIN_ONE,
      report: emptyRetentionReport(NOW),
    });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.run.id).toBe(first.run.id);
    const leaked = await pool.query(
      "select 1 from privacy_retention_runs where tenant_id=$1 and id=$2",
      [TENANT_TWO, first.run.id],
    );
    expect(leaked.rows).toHaveLength(0);
  });

  it("reports eligible and held records without mutating dry-run data", async () => {
    await pool.query(
      `insert into flights (
         tenant_id, pilot_membership_id, flight_number, dep_icao, arr_icao,
         etd, eta, status, updated_at
       ) values ($1, $2, 'PRV102', 'EKCH', 'ESSA', now()-interval '2 years',
         now()-interval '2 years'+interval '1 hour', 'completed', '2020-01-01')`,
      [TENANT_ONE, ADMIN_ONE],
    );
    await pool.query(
      "update flights set updated_at='2020-01-01' where id in ($1,$2)",
      [FLIGHT_ONE, FLIGHT_TWO],
    );
    const hold = await createLegalHold({
      tenantId: TENANT_ONE,
      actorMembershipId: ADMIN_ONE,
      subjectMembershipId: SUBJECT_ONE,
      scope: "all",
      reason: "synthetic claim preservation",
    });
    if (!hold) throw new Error("Expected legal hold fixture");
    await approveLegalHold({
      tenantId: TENANT_ONE,
      holdId: hold.id,
      actorMembershipId: ADMIN_TWO,
    });
    const result = await inspectRetentionClass({
      tenantId: TENANT_ONE,
      classKey: "flights",
      cutoff: new Date("2026-01-01"),
    });
    expect(result).toEqual({
      eligible: 1,
      affected: 0,
      held: 1,
      hasMore: false,
    });
    const count = await pool.query<{ count: string }>(
      "select count(*) from flights where tenant_id=$1",
      [TENANT_ONE],
    );
    expect(count.rows[0]?.count).toBe("2");
  });

  it("physically expires disconnected telemetry without crossing tenant boundaries", async () => {
    const cutoff = new Date("2026-08-11T12:00:00.000Z");
    await expect(
      inspectRetentionClass({
        tenantId: TENANT_ONE,
        classKey: "telemetry",
        cutoff,
      }),
    ).resolves.toEqual({
      eligible: 3,
      affected: 0,
      held: 0,
      hasMore: false,
    });

    await expect(
      executeRetentionClass({
        tenantId: TENANT_ONE,
        classKey: "telemetry",
        cutoff,
        limit: 100,
      }),
    ).resolves.toMatchObject({ affected: 3, hasMore: false });

    const counts = await pool.query<{
      tenantId: string;
      currentCount: string;
      leaseCount: string;
      trackCount: string;
    }>(`
      select tenant.id::text as "tenantId",
        (select count(*) from flight_telemetry_current current_state where current_state.tenant_id=tenant.id) as "currentCount",
        (select count(*) from flight_telemetry_leases lease where lease.tenant_id=tenant.id) as "leaseCount",
        (select count(*) from flight_telemetry_track track where track.tenant_id=tenant.id) as "trackCount"
      from tenants tenant
      order by tenant.id
    `);
    expect(counts.rows).toEqual([
      {
        tenantId: TENANT_ONE,
        currentCount: "0",
        leaseCount: "0",
        trackCount: "0",
      },
      {
        tenantId: TENANT_TWO,
        currentCount: "1",
        leaseCount: "1",
        trackCount: "1",
      },
    ]);
  });

  it("treats a processing restriction as retention protection", async () => {
    await pool.query("update flights set updated_at='2020-01-01' where id=$1", [
      FLIGHT_ONE,
    ]);
    await upsertSubjectRestriction({
      tenantId: TENANT_ONE,
      membershipId: SUBJECT_ONE,
      actorMembershipId: ADMIN_ONE,
      reason: "synthetic verified restriction",
    });
    await expect(
      inspectRetentionClass({
        tenantId: TENANT_ONE,
        classKey: "flights",
        cutoff: new Date("2026-01-01"),
      }),
    ).resolves.toEqual({
      eligible: 0,
      affected: 0,
      held: 1,
      hasMore: false,
    });
    await expect(
      executeRetentionClass({
        tenantId: TENANT_ONE,
        classKey: "flights",
        cutoff: new Date("2026-01-01"),
        limit: 100,
      }),
    ).resolves.toMatchObject({ affected: 0 });
    const retained = await pool.query("select 1 from flights where id=$1", [
      FLIGHT_ONE,
    ]);
    expect(retained.rows).toHaveLength(1);
  });

  it("keeps destructive approval distinct and legal holds block the subject", async () => {
    const request = await createPrivacySubjectRequest({
      tenantId: TENANT_ONE,
      actorMembershipId: ADMIN_ONE,
      scope: "member",
      subjectMembershipId: SUBJECT_ONE,
      kind: "erasure",
      payload: { reason: "verified synthetic erasure" },
    });
    expect(request).not.toBeNull();
    await pool.query(
      "update privacy_subject_requests set status='pending_approval', verified_by_membership_id=$1, verified_at=now() where id=$2",
      [ADMIN_ONE, request!.id],
    );
    expect(
      await approvePrivacySubjectRequest({
        tenantId: TENANT_ONE,
        requestId: request!.id,
        actorMembershipId: ADMIN_ONE,
      }),
    ).toBeNull();
    expect(
      await approvePrivacySubjectRequest({
        tenantId: TENANT_ONE,
        requestId: request!.id,
        actorMembershipId: ADMIN_TWO,
      }),
    ).toMatchObject({ status: "approved" });

    const hold = await createLegalHold({
      tenantId: TENANT_ONE,
      actorMembershipId: ADMIN_ONE,
      subjectMembershipId: SUBJECT_ONE,
      scope: "all",
      reason: "synthetic active hold",
    });
    if (!hold) throw new Error("Expected legal hold fixture");
    const pause = batchAdapter.pauseNextBatchBeforeCommit();
    const approval = approveLegalHold({
      tenantId: TENANT_ONE,
      holdId: hold.id,
      actorMembershipId: ADMIN_TWO,
    });
    await pause.reached;
    const destruction = erasePrivacySubject({
      tenantId: TENANT_ONE,
      membershipId: SUBJECT_ONE,
      requestId: request!.id,
      actorMembershipId: ADMIN_ONE,
      finalStatus: "completed",
      externalTasksRemaining: 0,
    });
    pause.release();
    await expect(approval).resolves.toMatchObject({ status: "active" });
    expect(
      await findBlockingLegalHold({
        tenantId: TENANT_ONE,
        membershipId: SUBJECT_ONE,
      }),
    ).toMatchObject({ id: hold.id, status: "active" });
    await expect(destruction).resolves.toBeNull();
    const evidence = await pool.query<{ action: string }>(
      "select action from audit_events where entity_id=$1 order by created_at",
      [hold.id],
    );
    expect(evidence.rows.map((row) => row.action)).toEqual([
      "privacy.legal_hold_created",
      "privacy.legal_hold_approved",
    ]);
    await markPrivacyRequestBlocked({
      tenantId: TENANT_ONE,
      requestId: request!.id,
      actorMembershipId: ADMIN_ONE,
      reason: `Active legal hold ${hold.id}`,
    });
    await releaseLegalHold({
      tenantId: TENANT_ONE,
      holdId: hold.id,
      actorMembershipId: ADMIN_TWO,
    });
    await expect(
      retryBlockedPrivacyRequest({
        tenantId: TENANT_ONE,
        requestId: request!.id,
        actorMembershipId: ADMIN_ONE,
      }),
    ).resolves.toMatchObject({ status: "approved", lastError: null });
  });

  it("exports all current stores with free text/provider payload and no secrets", async () => {
    const policy = await activePolicy();
    await createRetentionRun({
      tenantId: TENANT_ONE,
      policyId: policy.id,
      mode: "dry_run",
      asOf: NOW,
      idempotencyKey: "privacy-export-inventory",
      actorMembershipId: ADMIN_ONE,
      report: emptyRetentionReport(NOW),
    });
    await createPrivacySubjectRequest({
      tenantId: TENANT_ONE,
      actorMembershipId: ADMIN_ONE,
      scope: "member",
      subjectMembershipId: SUBJECT_ONE,
      kind: "export",
      payload: {},
    });
    const records = new Map<string, unknown[]>();
    for (const store of PRIVACY_EXPORT_STORES) {
      records.set(
        store,
        await listPrivacyExportStoreRecords({
          tenantId: TENANT_ONE,
          scope: "tenant",
          store,
          limit: 100,
        }),
      );
    }
    expect([...records.keys()]).toEqual(PRIVACY_EXPORT_STORES);
    expect(records.get("privacyPolicies")).toHaveLength(1);
    expect(records.get("retentionRuns")).toHaveLength(1);
    expect(records.get("acarsMessages")).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({
          body: "synthetic free text",
          hoppie_raw: { packet: "synthetic provider payload" },
        }),
      }),
    ]);
    expect(records.get("simbriefDispatches")).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({
          ofp: { general: { route: "NORKU" } },
        }),
      }),
    ]);
    expect(JSON.stringify(records.get("tenant"))).not.toContain(
      "encrypted-hoppie",
    );
    expect(JSON.stringify(records.get("oauthTransactions"))).not.toContain(
      "encrypted-verifier",
    );
    expect(JSON.stringify(records.get("simbriefDispatches"))).not.toContain(
      "callback-mac",
    );
    expect(records.get("simulatorDevices")).toHaveLength(1);
    expect(JSON.stringify(records.get("simulatorDevices"))).not.toContain(
      "device-token-mac",
    );
    expect(records.get("flightTelemetryCurrent")).toHaveLength(1);
    expect(records.get("flightTelemetryLeases")).toHaveLength(1);
    expect(records.get("flightTelemetryTrack")).toHaveLength(1);
    expect(records.get("flightOooiEvents")).toHaveLength(1);
    await expect(
      listPrivacyExportStoreRecords({
        tenantId: TENANT_ONE,
        scope: "member",
        membershipId: ADMIN_TWO,
        store: "privacyPolicies",
        limit: 100,
      }),
    ).resolves.toHaveLength(1);
    await expect(
      listPrivacyExportStoreRecords({
        tenantId: TENANT_ONE,
        scope: "member",
        membershipId: ADMIN_ONE,
        store: "retentionRuns",
        limit: 100,
      }),
    ).resolves.toHaveLength(1);
    await expect(
      listPrivacyExportStoreRecords({
        tenantId: TENANT_ONE,
        scope: "member",
        membershipId: ADMIN_ONE,
        store: "privacyRequests",
        limit: 100,
      }),
    ).resolves.toHaveLength(1);
    await expect(
      listPrivacyExportStoreRecords({
        tenantId: TENANT_ONE,
        scope: "member",
        membershipId: SUBJECT_ONE,
        store: "simbriefDispatches",
        limit: 100,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        data: expect.objectContaining({
          request: { remarks: "synthetic free text" },
          ofp: { general: { route: "NORKU" } },
        }),
      }),
    ]);
    await expect(
      listPrivacyExportStoreRecords({
        tenantId: TENANT_ONE,
        scope: "member",
        membershipId: SUBJECT_ONE,
        store: "acarsMessages",
        limit: 100,
      }),
    ).resolves.toHaveLength(1);
  });

  it("erasure is tenant-scoped and cannot leave a completed request half-written", async () => {
    const erasure = await approvedErasureRequest();
    const result = await erasePrivacySubject({
      tenantId: TENANT_ONE,
      membershipId: SUBJECT_ONE,
      requestId: erasure.id,
      actorMembershipId: ADMIN_ONE,
      finalStatus: "completed",
      externalTasksRemaining: 0,
    });
    expect(result).toMatchObject({
      request: { id: erasure.id, status: "completed" },
      localRecords: { flights: 1, requests: 1, messages: 1, telemetry: 5 },
    });
    const local = await pool.query("select 1 from memberships where id=$1", [
      SUBJECT_ONE,
    ]);
    const outside = await pool.query("select 1 from memberships where id=$1", [
      SUBJECT_TWO,
    ]);
    expect(local.rows).toHaveLength(0);
    expect(outside.rows).toHaveLength(1);

    const workflow = await createPrivacySubjectRequest({
      tenantId: TENANT_TWO,
      actorMembershipId: ADMIN_THREE,
      scope: "member",
      subjectMembershipId: SUBJECT_TWO,
      kind: "correction",
      payload: { displayName: "Corrected" },
    });
    await pool.query(
      "update privacy_subject_requests set status='approved' where id=$1",
      [workflow!.id],
    );
    const completed = await completePrivacyRequest({
      tenantId: TENANT_TWO,
      requestId: workflow!.id,
      actorMembershipId: ADMIN_THREE,
      status: "completed",
      result: { corrected: true },
    });
    expect(completed?.status).toBe("completed");
    expect(
      await findPrivacySubjectRequest(TENANT_ONE, workflow!.id),
    ).toBeNull();
  });

  it("anonymizes identity and free text while preserving operational rows", async () => {
    const priorRequest = await createPrivacySubjectRequest({
      tenantId: TENANT_ONE,
      actorMembershipId: ADMIN_ONE,
      scope: "member",
      subjectMembershipId: SUBJECT_ONE,
      kind: "restriction",
      payload: { reason: "synthetic prior private reason" },
    });
    await pool.query(
      "update privacy_subject_requests set status='completed' where id=$1",
      [priorRequest!.id],
    );
    await createExternalRequestTasks({
      tenantId: TENANT_ONE,
      requestId: priorRequest!.id,
      tasks: [
        {
          provider: "clerk",
          action: "synthetic_prior_task",
          operatorNote: "synthetic private provider note",
        },
      ],
    });
    const releasedHold = await createLegalHold({
      tenantId: TENANT_ONE,
      actorMembershipId: ADMIN_ONE,
      subjectMembershipId: SUBJECT_ONE,
      scope: "synthetic-release",
      reason: "synthetic private hold reason",
    });
    if (!releasedHold) throw new Error("Expected legal hold fixture");
    await approveLegalHold({
      tenantId: TENANT_ONE,
      holdId: releasedHold.id,
      actorMembershipId: ADMIN_TWO,
    });
    await releaseLegalHold({
      tenantId: TENANT_ONE,
      holdId: releasedHold.id,
      actorMembershipId: ADMIN_TWO,
    });
    const request = await approvedDestructionRequest("anonymization");
    const result = await anonymizePrivacySubject({
      tenantId: TENANT_ONE,
      membershipId: SUBJECT_ONE,
      requestId: request.id,
      actorMembershipId: ADMIN_ONE,
      finalStatus: "awaiting_external",
      externalTasksRemaining: 1,
    });
    expect(result).toMatchObject({
      request: { id: request.id, status: "awaiting_external" },
      localRecords: { flights: 1, requests: 1, messages: 1, telemetry: 5 },
    });
    const member = await pool.query<{
      clerkUserId: string;
      displayName: string | null;
    }>(
      'select clerk_user_id as "clerkUserId", display_name as "displayName" from memberships where id=$1',
      [SUBJECT_ONE],
    );
    expect(member.rows[0]?.clerkUserId).toMatch(/^anon:/);
    expect(member.rows[0]?.displayName).toBeNull();
    const retained = await pool.query<{
      requestNotes: string | null;
      dispatcherNotes: string | null;
      messageBody: string;
      simbriefCount: string;
    }>(
      `select
         request.notes as "requestNotes",
         flight.dispatcher_notes as "dispatcherNotes",
         message.body as "messageBody",
         (select count(*) from simbrief_dispatches where tenant_id=$1) as "simbriefCount"
       from schedule_requests request
       join flights flight on flight.schedule_request_id=request.id
       join acars_messages message on message.flight_id=flight.id
       where request.tenant_id=$1 and request.id=$2`,
      [TENANT_ONE, REQUEST_ONE],
    );
    expect(retained.rows[0]).toEqual({
      requestNotes: null,
      dispatcherNotes: null,
      messageBody: "[redacted by privacy workflow]",
      simbriefCount: "0",
    });
    const telemetry = await pool.query<{
      deviceCount: string;
      currentCount: string;
      leaseCount: string;
      trackCount: string;
      eventCount: string;
      linkedEventCount: string;
    }>(
      `select
        (select count(*) from simulator_devices where membership_id=$1) as "deviceCount",
        (select count(*) from flight_telemetry_current where membership_id=$1) as "currentCount",
        (select count(*) from flight_telemetry_leases where membership_id=$1) as "leaseCount",
        (select count(*) from flight_telemetry_track where membership_id=$1) as "trackCount",
        (select count(*) from flight_oooi_events where flight_id=$2) as "eventCount",
        (select count(*) from flight_oooi_events where actor_membership_id=$1 or device_id=$3) as "linkedEventCount"`,
      [SUBJECT_ONE, FLIGHT_ONE, DEVICE_ONE],
    );
    expect(telemetry.rows[0]).toEqual({
      deviceCount: "0",
      currentCount: "0",
      leaseCount: "0",
      trackCount: "0",
      eventCount: "1",
      linkedEventCount: "0",
    });
    const audit = await pool.query<{ count: string }>(
      "select count(*) from audit_events where entity_id=$1 and action='privacy.request_processed'",
      [request.id],
    );
    expect(audit.rows[0]?.count).toBe("1");
    const scrubbed = await pool.query<{
      holdReason: string;
      requestPayload: Record<string, unknown>;
      operatorNote: string | null;
      taskStatus: string;
    }>(
      `select
         hold.reason as "holdReason",
         request.payload as "requestPayload",
         task.operator_note as "operatorNote",
         task.status as "taskStatus"
       from privacy_legal_holds hold
       join privacy_subject_requests request on request.id=$2
       join privacy_external_tasks task on task.request_id=request.id
       where hold.id=$1`,
      [releasedHold.id, priorRequest!.id],
    );
    expect(scrubbed.rows[0]).toEqual({
      holdReason: "[redacted by privacy workflow]",
      requestPayload: {},
      operatorNote: null,
      taskStatus: "not_applicable",
    });
  });

  it("rolls back every erasure mutation when the final member deletion fails", async () => {
    const erasure = await approvedErasureRequest();
    await pool.query(`
      create function privacy_test_reject_member_delete() returns trigger
      language plpgsql as $$
      begin
        if old.id = '${SUBJECT_ONE}'::uuid then
          raise exception 'synthetic erasure failure';
        end if;
        return old;
      end
      $$;
      create trigger privacy_test_reject_member_delete
      before delete on memberships
      for each row execute function privacy_test_reject_member_delete()
    `);
    try {
      let failure: unknown;
      try {
        await erasePrivacySubject({
          tenantId: TENANT_ONE,
          membershipId: SUBJECT_ONE,
          requestId: erasure.id,
          actorMembershipId: ADMIN_ONE,
          finalStatus: "completed",
          externalTasksRemaining: 0,
        });
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(Error);
      expect(
        failure instanceof Error
          ? `${failure.message} ${failure.cause instanceof Error ? failure.cause.message : ""}`
          : "",
      ).toContain("synthetic erasure failure");
      const persisted = await pool.query<{ entity: string }>(
        `select 'membership' as entity from memberships where id=$1
         union all select 'request' from schedule_requests where id=$2
         union all select 'flight' from flights where id=$3
         union all select 'message' from acars_messages where flight_id=$3
         union all select 'device' from simulator_devices where id=$4
         union all select 'telemetry' from flight_telemetry_current where flight_id=$3
         union all select 'oooi' from flight_oooi_events where flight_id=$3 and device_id=$4`,
        [SUBJECT_ONE, REQUEST_ONE, FLIGHT_ONE, DEVICE_ONE],
      );
      expect(persisted.rows.map((row) => row.entity).sort()).toEqual([
        "device",
        "flight",
        "membership",
        "message",
        "oooi",
        "request",
        "telemetry",
      ]);
    } finally {
      await pool.query(
        "drop trigger if exists privacy_test_reject_member_delete on memberships",
      );
      await pool.query(
        "drop function if exists privacy_test_reject_member_delete()",
      );
    }
  });

  async function activePolicy() {
    const policy = await createPrivacyPolicy({
      tenantId: TENANT_ONE,
      actorMembershipId: ADMIN_ONE,
      config: DEFAULT_RETENTION_POLICY,
    });
    return (await approvePrivacyPolicy({
      tenantId: TENANT_ONE,
      policyId: policy.id,
      actorMembershipId: ADMIN_TWO,
    }))!;
  }

  async function approvedErasureRequest() {
    return approvedDestructionRequest("erasure");
  }

  async function approvedDestructionRequest(kind: "anonymization" | "erasure") {
    const request = await createPrivacySubjectRequest({
      tenantId: TENANT_ONE,
      actorMembershipId: ADMIN_ONE,
      scope: "member",
      subjectMembershipId: SUBJECT_ONE,
      kind,
      payload: { reason: `synthetic approved ${kind}` },
    });
    await pool.query(
      "update privacy_subject_requests set status='pending_approval', verified_by_membership_id=$1, verified_at=now() where id=$2",
      [ADMIN_ONE, request!.id],
    );
    return (await approvePrivacySubjectRequest({
      tenantId: TENANT_ONE,
      requestId: request!.id,
      actorMembershipId: ADMIN_TWO,
    }))!;
  }
});

async function resetFixtures(pool: pg.Pool) {
  await pool.query(`
    truncate table
      privacy_external_tasks,
      privacy_subject_controls,
      privacy_legal_holds,
      privacy_subject_requests,
      privacy_retention_runs,
      privacy_policies,
      flight_oooi_events,
      flight_telemetry_track,
      flight_telemetry_current,
      flight_telemetry_leases,
      simulator_devices,
      flight_operational_events,
      dispatch_releases,
      simbrief_dispatches,
      navigraph_oauth_transactions,
      mock_acars_queue,
      acars_messages,
      audit_events,
      flights,
      schedule_requests,
      memberships,
      tenants
    restart identity cascade
  `);
  await pool.query(
    `insert into tenants (id, slug, name, clerk_org_id, hoppie_logon_enc)
     values ($1, 'privacy-one', 'Privacy One', 'org_privacy_one', 'encrypted-hoppie'),
            ($2, 'privacy-two', 'Privacy Two', 'org_privacy_two', null)`,
    [TENANT_ONE, TENANT_TWO],
  );
  await pool.query(
    `insert into memberships (
       id, tenant_id, clerk_user_id, role, display_name, status
     ) values
       ($1, $4, 'admin_one', 'admin', 'Admin One', 'active'),
       ($2, $4, 'admin_two', 'admin', 'Admin Two', 'active'),
       ($3, $4, 'subject_one', 'pilot', 'Subject One', 'disabled'),
       ($5, $6, 'subject_two', 'pilot', 'Subject Two', 'disabled'),
       ($7, $6, 'admin_two_tenant', 'admin', 'Admin Two Tenant', 'active')`,
    [
      ADMIN_ONE,
      ADMIN_TWO,
      SUBJECT_ONE,
      TENANT_ONE,
      SUBJECT_TWO,
      TENANT_TWO,
      ADMIN_THREE,
    ],
  );
  await pool.query(
    `insert into schedule_requests (
       id, tenant_id, pilot_membership_id, title, notes, window_start, window_end,
       desired_flight_count, status
     ) values
       ($1, $3, $4, 'Synthetic request', 'synthetic request notes', now()-interval '2 years', now()-interval '2 years'+interval '2 hours', 1, 'cancelled'),
       ($2, $5, $6, 'Outside request', 'outside tenant', now()-interval '2 years', now()-interval '2 years'+interval '2 hours', 1, 'cancelled')`,
    [
      REQUEST_ONE,
      REQUEST_TWO,
      TENANT_ONE,
      SUBJECT_ONE,
      TENANT_TWO,
      SUBJECT_TWO,
    ],
  );
  await pool.query(
    `insert into flights (
       id, tenant_id, schedule_request_id, pilot_membership_id, flight_number,
       dep_icao, arr_icao, etd, eta, status
     ) values
       ($1, $3, $4, $5, 'PRV101', 'EKCH', 'ENGM', now()-interval '2 years', now()-interval '2 years'+interval '1 hour', 'completed'),
       ($2, $6, $7, $8, 'PRV202', 'ENGM', 'ESSA', now()-interval '2 years', now()-interval '2 years'+interval '1 hour', 'completed')`,
    [
      FLIGHT_ONE,
      FLIGHT_TWO,
      TENANT_ONE,
      REQUEST_ONE,
      SUBJECT_ONE,
      TENANT_TWO,
      REQUEST_TWO,
      SUBJECT_TWO,
    ],
  );
  await pool.query(
    `insert into simulator_devices (
       id, tenant_id, membership_id, name, token_mac, status, last_sequence,
       last_ingest_at, last_seen_at
     ) values
       ($1, $3, $4, 'Subject simulator', 'device-token-mac-one', 'active', 10,
         '2026-08-10T10:00:00Z', '2026-08-10T10:00:00Z'),
       ($2, $5, $6, 'Outside simulator', 'device-token-mac-two', 'active', 10,
         '2026-08-10T10:00:00Z', '2026-08-10T10:00:00Z')`,
    [DEVICE_ONE, DEVICE_TWO, TENANT_ONE, SUBJECT_ONE, TENANT_TWO, SUBJECT_TWO],
  );
  await pool.query(
    `insert into flight_telemetry_current (
       flight_id, tenant_id, membership_id, device_id, phase, latitude,
       longitude, altitude_feet, ground_speed_knots, heading_degrees,
       simulator_time, sample_at, sequence
     ) values
       ($1, $3, $4, $5, 'parked', 55.618, 12.656, 20, 0, 180,
         '2026-08-10T10:00:00Z', '2026-08-10T10:00:00Z', 10),
       ($2, $6, $7, $8, 'parked', 59.651, 17.918, 30, 0, 180,
         '2026-08-10T10:00:00Z', '2026-08-10T10:00:00Z', 10)`,
    [
      FLIGHT_ONE,
      FLIGHT_TWO,
      TENANT_ONE,
      SUBJECT_ONE,
      DEVICE_ONE,
      TENANT_TWO,
      SUBJECT_TWO,
      DEVICE_TWO,
    ],
  );
  await pool.query(
    `insert into flight_telemetry_leases (
       flight_id, tenant_id, membership_id, device_id, lease_expires_at
     ) values
       ($1, $3, $4, $5, '2026-08-10T10:00:30Z'),
       ($2, $6, $7, $8, '2026-08-10T10:00:30Z')`,
    [
      FLIGHT_ONE,
      FLIGHT_TWO,
      TENANT_ONE,
      SUBJECT_ONE,
      DEVICE_ONE,
      TENANT_TWO,
      SUBJECT_TWO,
      DEVICE_TWO,
    ],
  );
  await pool.query(
    `insert into flight_telemetry_track (
       id, tenant_id, flight_id, membership_id, device_id, phase, latitude,
       longitude, altitude_feet, ground_speed_knots, heading_degrees,
       simulator_time, sample_at, sequence
     ) values
       ($1, $3, $4, $5, $6, 'parked', 55.618, 12.656, 20, 0, 180,
         '2026-08-10T10:00:00Z', '2026-08-10T10:00:00Z', 10),
       ($2, $7, $8, $9, $10, 'parked', 59.651, 17.918, 30, 0, 180,
         '2026-08-10T10:00:00Z', '2026-08-10T10:00:00Z', 10)`,
    [
      TRACK_ONE,
      TRACK_TWO,
      TENANT_ONE,
      FLIGHT_ONE,
      SUBJECT_ONE,
      DEVICE_ONE,
      TENANT_TWO,
      FLIGHT_TWO,
      SUBJECT_TWO,
      DEVICE_TWO,
    ],
  );
  await pool.query(
    `insert into flight_oooi_events (
       tenant_id, flight_id, event_type, occurred_at, source, device_id, reason
     ) values
       ($1, $2, 'out', '2026-08-10T10:00:00Z', 'telemetry', $3, 'subject device event'),
       ($4, $5, 'out', '2026-08-10T10:00:00Z', 'telemetry', $6, 'outside device event')`,
    [TENANT_ONE, FLIGHT_ONE, DEVICE_ONE, TENANT_TWO, FLIGHT_TWO, DEVICE_TWO],
  );
  await pool.query(
    `insert into acars_messages (
       tenant_id, direction, from_station, to_station, body, hoppie_raw,
       provider, provider_message_id, flight_id, created_by_membership_id
     ) values ($1, 'outbound', 'GROUND', 'PRV101', 'synthetic free text',
       '{"packet":"synthetic provider payload"}', 'hoppie', 'synthetic-provider-id', $2, $3)`,
    [TENANT_ONE, FLIGHT_ONE, SUBJECT_ONE],
  );
  await pool.query(
    `insert into simbrief_dispatches (
       tenant_id, flight_id, created_by_membership_id, simbrief_user_id,
       static_id, callback_token_mac, callback_expires_at, status, revision,
       flight_snapshot, request, ofp
     ) values ($1, $2, $3, '123456', 'PRIVACY_STATIC', 'callback-mac',
       now()+interval '1 hour', 'pending', 1, '{}',
       '{"remarks":"synthetic free text"}', '{"general":{"route":"NORKU"}}')`,
    [TENANT_ONE, FLIGHT_ONE, SUBJECT_ONE],
  );
  await pool.query(
    `insert into navigraph_oauth_transactions (
       tenant_id, membership_id, state_id, code_verifier_enc, expires_at
     ) values ($1, $2, 'synthetic-state', 'encrypted-verifier', now()-interval '1 day')`,
    [TENANT_ONE, SUBJECT_ONE],
  );
}
