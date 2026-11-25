import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../test/d1.js";
import {
  acarsMessages,
  flightOooiEvents,
  flights,
  flightTelemetryCurrent,
  flightTelemetryLeases,
  flightTelemetryTrack,
  memberships,
  navigraphOauthTransactions,
  scheduleRequests,
  simbriefDispatches,
  simulatorDevices,
  tenants,
} from "../schema.js";
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

const HOUR_MS = 60 * 60 * 1000;
const LONG_AGO = new Date("2020-01-01T00:00:00.000Z");
const TWO_YEARS_AGO = new Date(Date.now() - 2 * 365 * 24 * HOUR_MS);

describe("privacy lifecycle repository (D1)", () => {
  let database: TestDatabase;

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
    const audit = await database.query<{ count: number }>(
      "select count(*) as count from audit_events where tenant_id=? and action='privacy.policy_approved'",
      TENANT_ONE,
    );
    expect(audit[0]?.count).toBe(1);
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
    const leaked = await database.query(
      "select 1 from privacy_retention_runs where tenant_id=? and id=?",
      TENANT_TWO,
      first.run.id,
    );
    expect(leaked).toHaveLength(0);
  });

  it("reports eligible and held records without mutating dry-run data", async () => {
    await database.db.insert(flights).values({
      tenantId: TENANT_ONE,
      pilotMembershipId: ADMIN_ONE,
      flightNumber: "PRV102",
      depIcao: "EKCH",
      arrIcao: "ESSA",
      etd: TWO_YEARS_AGO,
      eta: new Date(TWO_YEARS_AGO.getTime() + HOUR_MS),
      status: "completed",
      updatedAt: LONG_AGO,
    });
    await database.query(
      "update flights set updated_at=? where id in (?,?)",
      LONG_AGO.getTime(),
      FLIGHT_ONE,
      FLIGHT_TWO,
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
    const count = await database.query<{ count: number }>(
      "select count(*) as count from flights where tenant_id=?",
      TENANT_ONE,
    );
    expect(count[0]?.count).toBe(2);
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

    const counts = await database.query<{
      tenantId: string;
      currentCount: number;
      leaseCount: number;
      trackCount: number;
    }>(
      `
      select tenant.id as "tenantId",
        (select count(*) from flight_telemetry_current current_state where current_state.tenant_id=tenant.id) as "currentCount",
        (select count(*) from flight_telemetry_leases lease where lease.tenant_id=tenant.id) as "leaseCount",
        (select count(*) from flight_telemetry_track track where track.tenant_id=tenant.id) as "trackCount"
      from tenants tenant
      where tenant.id in (?, ?)
      order by tenant.id
    `,
      TENANT_ONE,
      TENANT_TWO,
    );
    expect(counts).toEqual([
      { tenantId: TENANT_ONE, currentCount: 0, leaseCount: 0, trackCount: 0 },
      { tenantId: TENANT_TWO, currentCount: 1, leaseCount: 1, trackCount: 1 },
    ]);
  });

  it("treats a processing restriction as retention protection", async () => {
    await database.query(
      "update flights set updated_at=? where id=?",
      LONG_AGO.getTime(),
      FLIGHT_ONE,
    );
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
    const retained = await database.query(
      "select 1 from flights where id=?",
      FLIGHT_ONE,
    );
    expect(retained).toHaveLength(1);
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
    await database.query(
      "update privacy_subject_requests set status='pending_approval', verified_by_membership_id=?, verified_at=? where id=?",
      ADMIN_ONE,
      Date.now(),
      request!.id,
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
    // D1 serializes writes, so a hold approved concurrently is committed
    // before or after the erasure batch; either way the hold wins.
    const approval = approveLegalHold({
      tenantId: TENANT_ONE,
      holdId: hold.id,
      actorMembershipId: ADMIN_TWO,
    });
    await approval;
    const destruction = erasePrivacySubject({
      tenantId: TENANT_ONE,
      membershipId: SUBJECT_ONE,
      requestId: request!.id,
      actorMembershipId: ADMIN_ONE,
      finalStatus: "completed",
      externalTasksRemaining: 0,
    });
    await expect(approval).resolves.toMatchObject({ status: "active" });
    expect(
      await findBlockingLegalHold({
        tenantId: TENANT_ONE,
        membershipId: SUBJECT_ONE,
      }),
    ).toMatchObject({ id: hold.id, status: "active" });
    await expect(destruction).resolves.toBeNull();
    const evidence = await database.query<{ action: string }>(
      "select action from audit_events where entity_id=? order by created_at",
      hold.id,
    );
    expect(evidence.map((row) => row.action)).toEqual([
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
    const local = await database.query(
      "select 1 from memberships where id=?",
      SUBJECT_ONE,
    );
    const outside = await database.query(
      "select 1 from memberships where id=?",
      SUBJECT_TWO,
    );
    expect(local).toHaveLength(0);
    expect(outside).toHaveLength(1);

    const workflow = await createPrivacySubjectRequest({
      tenantId: TENANT_TWO,
      actorMembershipId: ADMIN_THREE,
      scope: "member",
      subjectMembershipId: SUBJECT_TWO,
      kind: "correction",
      payload: { displayName: "Corrected" },
    });
    await database.query(
      "update privacy_subject_requests set status='approved' where id=?",
      workflow!.id,
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
    await database.query(
      "update privacy_subject_requests set status='completed' where id=?",
      priorRequest!.id,
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
    const member = await database.query<{
      clerkUserId: string;
      displayName: string | null;
    }>(
      'select clerk_user_id as "clerkUserId", display_name as "displayName" from memberships where id=?',
      SUBJECT_ONE,
    );
    expect(member[0]?.clerkUserId).toMatch(/^anon:/);
    expect(member[0]?.displayName).toBeNull();
    const retained = await database.query<{
      requestNotes: string | null;
      dispatcherNotes: string | null;
      messageBody: string;
      simbriefCount: number;
    }>(
      `select
         request.notes as "requestNotes",
         flight.dispatcher_notes as "dispatcherNotes",
         message.body as "messageBody",
         (select count(*) from simbrief_dispatches where tenant_id=?1) as "simbriefCount"
       from schedule_requests request
       join flights flight on flight.schedule_request_id=request.id
       join acars_messages message on message.flight_id=flight.id
       where request.tenant_id=?1 and request.id=?2`,
      TENANT_ONE,
      REQUEST_ONE,
    );
    expect(retained[0]).toEqual({
      requestNotes: null,
      dispatcherNotes: null,
      messageBody: "[redacted by privacy workflow]",
      simbriefCount: 0,
    });
    const telemetry = await database.query(
      `select
        (select count(*) from simulator_devices where membership_id=?1) as "deviceCount",
        (select count(*) from flight_telemetry_current where membership_id=?1) as "currentCount",
        (select count(*) from flight_telemetry_leases where membership_id=?1) as "leaseCount",
        (select count(*) from flight_telemetry_track where membership_id=?1) as "trackCount",
        (select count(*) from flight_oooi_events where flight_id=?2) as "eventCount",
        (select count(*) from flight_oooi_events where actor_membership_id=?1 or device_id=?3) as "linkedEventCount"`,
      SUBJECT_ONE,
      FLIGHT_ONE,
      DEVICE_ONE,
    );
    expect(telemetry[0]).toEqual({
      deviceCount: 0,
      currentCount: 0,
      leaseCount: 0,
      trackCount: 0,
      eventCount: 1,
      linkedEventCount: 0,
    });
    const audit = await database.query<{ count: number }>(
      "select count(*) as count from audit_events where entity_id=? and action='privacy.request_processed'",
      request.id,
    );
    expect(audit[0]?.count).toBe(1);
    const scrubbed = await database.query<{
      holdReason: string;
      requestPayload: string;
      operatorNote: string | null;
      taskStatus: string;
    }>(
      `select
         hold.reason as "holdReason",
         request.payload as "requestPayload",
         task.operator_note as "operatorNote",
         task.status as "taskStatus"
       from privacy_legal_holds hold
       join privacy_subject_requests request on request.id=?2
       join privacy_external_tasks task on task.request_id=request.id
       where hold.id=?1`,
      releasedHold.id,
      priorRequest!.id,
    );
    expect({
      ...scrubbed[0],
      requestPayload: JSON.parse(scrubbed[0]!.requestPayload),
    }).toEqual({
      holdReason: "[redacted by privacy workflow]",
      requestPayload: {},
      operatorNote: null,
      taskStatus: "not_applicable",
    });
  });

  it("rolls back every erasure mutation when the final member deletion fails", async () => {
    const erasure = await approvedErasureRequest();
    await database.query(`
      create trigger privacy_test_reject_member_delete
      before delete on memberships
      when old.id = '${SUBJECT_ONE}'
      begin
        select raise(abort, 'synthetic erasure failure');
      end
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
      const probes: Array<[string, string, ...string[]]> = [
        ["membership", "select 1 from memberships where id=?", SUBJECT_ONE],
        ["request", "select 1 from schedule_requests where id=?", REQUEST_ONE],
        ["flight", "select 1 from flights where id=?", FLIGHT_ONE],
        ["message", "select 1 from acars_messages where flight_id=?", FLIGHT_ONE],
        ["device", "select 1 from simulator_devices where id=?", DEVICE_ONE],
        ["telemetry", "select 1 from flight_telemetry_current where flight_id=?", FLIGHT_ONE],
        ["oooi", "select 1 from flight_oooi_events where flight_id=? and device_id=?", FLIGHT_ONE, DEVICE_ONE],
      ];
      const persisted: Array<{ entity: string }> = [];
      for (const [entity, statement, ...params] of probes) {
        if ((await database.query(statement, ...params)).length > 0) {
          persisted.push({ entity });
        }
      }
      expect(persisted.map((row) => row.entity).sort()).toEqual([
        "device",
        "flight",
        "membership",
        "message",
        "oooi",
        "request",
        "telemetry",
      ]);
    } finally {
      await database.query(
        "drop trigger if exists privacy_test_reject_member_delete",
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
    await database.query(
      "update privacy_subject_requests set status='pending_approval', verified_by_membership_id=?, verified_at=? where id=?",
      ADMIN_ONE,
      Date.now(),
      request!.id,
    );
    return (await approvePrivacySubjectRequest({
      tenantId: TENANT_ONE,
      requestId: request!.id,
      actorMembershipId: ADMIN_TWO,
    }))!;
  }
});

async function seedFixtures({ db }: TestDatabase) {
  const sampleAt = new Date("2026-08-10T10:00:00Z");
  await db.insert(tenants).values([
    {
      id: TENANT_ONE,
      slug: "privacy-one",
      name: "Privacy One",
      clerkOrgId: "org_privacy_one",
      hoppieLogonEnc: "encrypted-hoppie",
    },
    {
      id: TENANT_TWO,
      slug: "privacy-two",
      name: "Privacy Two",
      clerkOrgId: "org_privacy_two",
    },
  ]);
  await db.insert(memberships).values([
    { id: ADMIN_ONE, tenantId: TENANT_ONE, clerkUserId: "admin_one", role: "admin", displayName: "Admin One", status: "active" },
    { id: ADMIN_TWO, tenantId: TENANT_ONE, clerkUserId: "admin_two", role: "admin", displayName: "Admin Two", status: "active" },
    { id: SUBJECT_ONE, tenantId: TENANT_ONE, clerkUserId: "subject_one", role: "pilot", displayName: "Subject One", status: "disabled" },
    { id: SUBJECT_TWO, tenantId: TENANT_TWO, clerkUserId: "subject_two", role: "pilot", displayName: "Subject Two", status: "disabled" },
    { id: ADMIN_THREE, tenantId: TENANT_TWO, clerkUserId: "admin_two_tenant", role: "admin", displayName: "Admin Two Tenant", status: "active" },
  ]);
  const windowEnd = new Date(TWO_YEARS_AGO.getTime() + 2 * HOUR_MS);
  await db.insert(scheduleRequests).values([
    { id: REQUEST_ONE, tenantId: TENANT_ONE, pilotMembershipId: SUBJECT_ONE, title: "Synthetic request", notes: "synthetic request notes", windowStart: TWO_YEARS_AGO, windowEnd, desiredFlightCount: 1, status: "cancelled" },
    { id: REQUEST_TWO, tenantId: TENANT_TWO, pilotMembershipId: SUBJECT_TWO, title: "Outside request", notes: "outside tenant", windowStart: TWO_YEARS_AGO, windowEnd, desiredFlightCount: 1, status: "cancelled" },
  ]);
  const eta = new Date(TWO_YEARS_AGO.getTime() + HOUR_MS);
  await db.insert(flights).values([
    { id: FLIGHT_ONE, tenantId: TENANT_ONE, scheduleRequestId: REQUEST_ONE, pilotMembershipId: SUBJECT_ONE, flightNumber: "PRV101", depIcao: "EKCH", arrIcao: "ENGM", etd: TWO_YEARS_AGO, eta, status: "completed" },
    { id: FLIGHT_TWO, tenantId: TENANT_TWO, scheduleRequestId: REQUEST_TWO, pilotMembershipId: SUBJECT_TWO, flightNumber: "PRV202", depIcao: "ENGM", arrIcao: "ESSA", etd: TWO_YEARS_AGO, eta, status: "completed" },
  ]);
  await db.insert(simulatorDevices).values([
    { id: DEVICE_ONE, tenantId: TENANT_ONE, membershipId: SUBJECT_ONE, name: "Subject simulator", tokenMac: "device-token-mac-one", status: "active", lastSequence: 10, lastIngestAt: sampleAt, lastSeenAt: sampleAt },
    { id: DEVICE_TWO, tenantId: TENANT_TWO, membershipId: SUBJECT_TWO, name: "Outside simulator", tokenMac: "device-token-mac-two", status: "active", lastSequence: 10, lastIngestAt: sampleAt, lastSeenAt: sampleAt },
  ]);
  const sample = {
    phase: "parked" as const,
    altitudeFeet: 20,
    groundSpeedKnots: 0,
    headingDegrees: 180,
    simulatorTime: sampleAt,
    sampleAt,
    sequence: 10,
  };
  await db.insert(flightTelemetryCurrent).values([
    { ...sample, flightId: FLIGHT_ONE, tenantId: TENANT_ONE, membershipId: SUBJECT_ONE, deviceId: DEVICE_ONE, latitude: 55.618, longitude: 12.656 },
    { ...sample, flightId: FLIGHT_TWO, tenantId: TENANT_TWO, membershipId: SUBJECT_TWO, deviceId: DEVICE_TWO, latitude: 59.651, longitude: 17.918, altitudeFeet: 30 },
  ]);
  const leaseExpiresAt = new Date("2026-08-10T10:00:30Z");
  await db.insert(flightTelemetryLeases).values([
    { flightId: FLIGHT_ONE, tenantId: TENANT_ONE, membershipId: SUBJECT_ONE, deviceId: DEVICE_ONE, leaseExpiresAt },
    { flightId: FLIGHT_TWO, tenantId: TENANT_TWO, membershipId: SUBJECT_TWO, deviceId: DEVICE_TWO, leaseExpiresAt },
  ]);
  await db.insert(flightTelemetryTrack).values([
    { ...sample, id: TRACK_ONE, tenantId: TENANT_ONE, flightId: FLIGHT_ONE, membershipId: SUBJECT_ONE, deviceId: DEVICE_ONE, latitude: 55.618, longitude: 12.656 },
    { ...sample, id: TRACK_TWO, tenantId: TENANT_TWO, flightId: FLIGHT_TWO, membershipId: SUBJECT_TWO, deviceId: DEVICE_TWO, latitude: 59.651, longitude: 17.918, altitudeFeet: 30 },
  ]);
  await db.insert(flightOooiEvents).values([
    { tenantId: TENANT_ONE, flightId: FLIGHT_ONE, eventType: "out", occurredAt: sampleAt, source: "telemetry", deviceId: DEVICE_ONE, reason: "subject device event" },
    { tenantId: TENANT_TWO, flightId: FLIGHT_TWO, eventType: "out", occurredAt: sampleAt, source: "telemetry", deviceId: DEVICE_TWO, reason: "outside device event" },
  ]);
  await db.insert(acarsMessages).values({
    tenantId: TENANT_ONE,
    direction: "outbound",
    fromStation: "GROUND",
    toStation: "PRV101",
    body: "synthetic free text",
    hoppieRaw: { packet: "synthetic provider payload" },
    provider: "hoppie",
    providerMessageId: "synthetic-provider-id",
    flightId: FLIGHT_ONE,
    createdByMembershipId: SUBJECT_ONE,
  });
  await db.insert(simbriefDispatches).values({
    tenantId: TENANT_ONE,
    flightId: FLIGHT_ONE,
    createdByMembershipId: SUBJECT_ONE,
    simbriefUserId: "123456",
    staticId: "PRIVACY_STATIC",
    callbackTokenMac: "callback-mac",
    callbackExpiresAt: new Date(Date.now() + HOUR_MS),
    status: "pending",
    revision: 1,
    flightSnapshot: {},
    request: { remarks: "synthetic free text" },
    ofp: { general: { route: "NORKU" } },
  });
  await db.insert(navigraphOauthTransactions).values({
    tenantId: TENANT_ONE,
    membershipId: SUBJECT_ONE,
    stateId: "synthetic-state",
    codeVerifierEnc: "encrypted-verifier",
    expiresAt: new Date(Date.now() - 24 * HOUR_MS),
  });
}
