import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { getDb } from "../client.js";
import {
  chunk,
  guard,
  insertAudit,
  isoTimestampSql,
  json,
  ms,
  queryRows,
  runAtomic,
  type AtomicStatement,
} from "../atomic.js";
import {
  acarsMessages,
  auditEvents,
  dispatchReleases,
  flightOooiEvents,
  flightOperationalEvents,
  flights,
  flightTelemetryCurrent,
  flightTelemetryLeases,
  flightTelemetryTrack,
  memberships,
  mockAcarsQueue,
  navigraphOauthTransactions,
  privacyExternalTasks,
  privacyLegalHolds,
  privacyPolicies,
  privacyRetentionRuns,
  privacySubjectControls,
  privacySubjectRequests,
  scheduleRequests,
  simbriefDispatches,
  simulatorDevices,
  tenants,
  uuidV4Sql,
  type PrivacyExternalTask,
  type PrivacyLegalHold,
  type PrivacyPolicy,
  type PrivacyRetentionRun,
  type PrivacySubjectControl,
  type PrivacySubjectRequest,
} from "../schema.js";
import type {
  ObjectionScope,
  RetentionClassKey,
  RetentionPolicyConfig,
  RetentionReport,
} from "../../domain/privacy/policy.js";

/** A running retention run is considered abandoned after this long. */
const RETENTION_RUN_STALE_MS = 10 * 60 * 1000;

const OPEN_FLIGHT_STATUSES = sql`('draft', 'offered', 'accepted', 'briefed', 'active')`;
const OPEN_REQUEST_STATUSES = sql`('pending', 'in_review', 'partially_fulfilled')`;

/** `true` when an active admin with this id belongs to the tenant. */
function activeAdmin(tenantId: string, membershipId: string): SQL {
  return sql`exists (
    select 1 from memberships actor
    where actor.id = ${membershipId}
      and actor.tenant_id = ${tenantId}
      and actor.role = 'admin'
      and actor.status = 'active'
  )`;
}

export async function createPrivacyPolicy(input: {
  tenantId: string;
  actorMembershipId: string;
  config: RetentionPolicyConfig;
}): Promise<PrivacyPolicy> {
  const id = randomUUID();
  await runAtomic([
    sql`
      insert into privacy_policies (
        id, tenant_id, version, status, config, created_by_membership_id
      )
      select
        ${id},
        ${input.tenantId},
        coalesce(max(version), 0) + 1,
        'draft',
        json(${json(input.config)}),
        ${input.actorMembershipId}
      from privacy_policies
      where tenant_id = ${input.tenantId}
    `,
    insertAudit({
      tenantId: input.tenantId,
      actorMembershipId: input.actorMembershipId,
      action: "privacy.policy_created",
      entityType: "privacy_policy",
      entityId: id,
      meta: sql`json_object(
        'version', version,
        'automaticExecution', config -> '$.automaticExecution'
      )`,
      from: sql`privacy_policies where id = ${id}`,
    }),
  ]);
  const policy = await findPrivacyPolicy(input.tenantId, id);
  if (!policy) throw new Error("Created privacy policy could not be reloaded");
  return policy;
}

export async function findPrivacyPolicy(
  tenantId: string,
  id: string,
): Promise<PrivacyPolicy | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(privacyPolicies)
    .where(
      and(eq(privacyPolicies.tenantId, tenantId), eq(privacyPolicies.id, id)),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function findActivePrivacyPolicy(
  tenantId: string,
): Promise<PrivacyPolicy | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(privacyPolicies)
    .where(
      and(
        eq(privacyPolicies.tenantId, tenantId),
        eq(privacyPolicies.status, "active"),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function listActivePrivacyPolicies(): Promise<PrivacyPolicy[]> {
  const db = getDb();
  return db
    .select()
    .from(privacyPolicies)
    .where(eq(privacyPolicies.status, "active"));
}

export async function approvePrivacyPolicy(input: {
  tenantId: string;
  policyId: string;
  actorMembershipId: string;
}): Promise<PrivacyPolicy | null> {
  const db = getDb();
  const approvedAt = new Date();
  const result = await runAtomic([
    guard(sql`
      exists (
        select 1 from privacy_policies
        where tenant_id = ${input.tenantId}
          and id = ${input.policyId}
          and status = 'draft'
          and created_by_membership_id is not ${input.actorMembershipId}
      )
      and ${activeAdmin(input.tenantId, input.actorMembershipId)}
    `),
    // The audit reads the pre-approval state, so it is written first.
    insertAudit({
      tenantId: input.tenantId,
      actorMembershipId: input.actorMembershipId,
      action: "privacy.policy_approved",
      entityType: "privacy_policy",
      entityId: input.policyId,
      meta: sql`json_object(
        'version', version,
        'retiredPolicyCount', (
          select count(*) from privacy_policies current_policy
          where current_policy.tenant_id = ${input.tenantId}
            and current_policy.status = 'active'
        )
      )`,
      createdAt: approvedAt,
      from: sql`privacy_policies where id = ${input.policyId}`,
    }),
    db
      .update(privacyPolicies)
      .set({ status: "retired", updatedAt: approvedAt })
      .where(
        and(
          eq(privacyPolicies.tenantId, input.tenantId),
          eq(privacyPolicies.status, "active"),
        ),
      ),
    db
      .update(privacyPolicies)
      .set({
        status: "active",
        approvedByMembershipId: input.actorMembershipId,
        approvedAt,
        effectiveAt: approvedAt,
        updatedAt: approvedAt,
      })
      .where(eq(privacyPolicies.id, input.policyId)),
  ]);
  if (!result) return null;
  return findPrivacyPolicy(input.tenantId, input.policyId);
}

export async function createRetentionRun(input: {
  tenantId: string;
  policyId: string;
  mode: "dry_run" | "execute";
  asOf: Date;
  dryRunId?: string;
  idempotencyKey: string;
  actorMembershipId?: string | null;
  report: RetentionReport;
}): Promise<{ run: PrivacyRetentionRun; created: boolean }> {
  const db = getDb();
  const id = randomUUID();
  await runAtomic([
    db
      .insert(privacyRetentionRuns)
      .values({
        id,
        tenantId: input.tenantId,
        policyId: input.policyId,
        mode: input.mode,
        status: "queued",
        asOf: input.asOf,
        dryRunId: input.dryRunId ?? null,
        idempotencyKey: input.idempotencyKey,
        cursor: { classIndex: 0 },
        report: input.report,
        requestedByMembershipId: input.actorMembershipId ?? null,
      })
      .onConflictDoNothing({
        target: [
          privacyRetentionRuns.tenantId,
          privacyRetentionRuns.idempotencyKey,
        ],
      }),
    // Only written when this call inserted the run: on a conflict no row
    // carries the freshly generated id.
    insertAudit({
      tenantId: input.tenantId,
      actorMembershipId: sql`requested_by_membership_id`,
      action: "privacy.retention_queued",
      entityType: "privacy_retention_run",
      entityId: id,
      meta: sql`json_object(
        'mode', mode,
        'policyId', policy_id,
        'dryRunId', dry_run_id
      )`,
      from: sql`privacy_retention_runs where id = ${id}`,
    }),
  ]);
  const rows = await db
    .select()
    .from(privacyRetentionRuns)
    .where(
      and(
        eq(privacyRetentionRuns.tenantId, input.tenantId),
        eq(privacyRetentionRuns.idempotencyKey, input.idempotencyKey),
      ),
    )
    .limit(1);
  const run = rows[0];
  if (!run) throw new Error("Retention run could not be reloaded");
  return { run, created: run.id === id };
}

export async function findRetentionRun(
  tenantId: string,
  id: string,
): Promise<PrivacyRetentionRun | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(privacyRetentionRuns)
    .where(
      and(
        eq(privacyRetentionRuns.tenantId, tenantId),
        eq(privacyRetentionRuns.id, id),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function findCompletedDryRun(
  tenantId: string,
  id: string,
): Promise<PrivacyRetentionRun | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(privacyRetentionRuns)
    .where(
      and(
        eq(privacyRetentionRuns.tenantId, tenantId),
        eq(privacyRetentionRuns.id, id),
        eq(privacyRetentionRuns.mode, "dry_run"),
        eq(privacyRetentionRuns.status, "completed"),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

function runnableRetentionRun(now: Date): SQL {
  const staleBefore = new Date(now.getTime() - RETENTION_RUN_STALE_MS);
  return or(
    eq(privacyRetentionRuns.status, "queued"),
    and(
      eq(privacyRetentionRuns.status, "running"),
      lt(privacyRetentionRuns.updatedAt, staleBefore),
    ),
  )!;
}

export async function listRunnableRetentionRuns(
  limit: number,
): Promise<PrivacyRetentionRun[]> {
  const db = getDb();
  return db
    .select()
    .from(privacyRetentionRuns)
    .where(runnableRetentionRun(new Date()))
    .orderBy(asc(privacyRetentionRuns.createdAt), asc(privacyRetentionRuns.id))
    .limit(limit);
}

export async function claimRetentionRun(input: {
  tenantId: string;
  runId: string;
}): Promise<PrivacyRetentionRun | null> {
  const db = getDb();
  const now = new Date();
  const rows = await db
    .update(privacyRetentionRuns)
    .set({
      status: "running",
      startedAt: sql`coalesce(${privacyRetentionRuns.startedAt}, ${ms(now)})`,
      updatedAt: now,
    })
    .where(
      and(
        eq(privacyRetentionRuns.tenantId, input.tenantId),
        eq(privacyRetentionRuns.id, input.runId),
        runnableRetentionRun(now),
      ),
    )
    .returning();
  return rows[0] ?? null;
}

export async function findLatestPolicyDryRun(
  tenantId: string,
  policyId: string,
): Promise<PrivacyRetentionRun | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(privacyRetentionRuns)
    .where(
      and(
        eq(privacyRetentionRuns.tenantId, tenantId),
        eq(privacyRetentionRuns.policyId, policyId),
        eq(privacyRetentionRuns.mode, "dry_run"),
        eq(privacyRetentionRuns.status, "completed"),
      ),
    )
    .orderBy(desc(privacyRetentionRuns.completedAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function retentionRunExistsSince(input: {
  tenantId: string;
  policyId: string;
  since: Date;
}): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select({ id: privacyRetentionRuns.id })
    .from(privacyRetentionRuns)
    .where(
      and(
        eq(privacyRetentionRuns.tenantId, input.tenantId),
        eq(privacyRetentionRuns.policyId, input.policyId),
        gte(privacyRetentionRuns.createdAt, input.since),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function retryRetentionRun(input: {
  tenantId: string;
  runId: string;
  actorMembershipId: string;
}): Promise<PrivacyRetentionRun | null> {
  const db = getDb();
  const retriedAt = new Date();
  const result = await runAtomic([
    guard(sql`exists (
      select 1 from privacy_retention_runs
      where tenant_id = ${input.tenantId}
        and id = ${input.runId}
        and status = 'failed'
    )`),
    db
      .update(privacyRetentionRuns)
      .set({ status: "queued", lastError: null, updatedAt: retriedAt })
      .where(eq(privacyRetentionRuns.id, input.runId)),
    insertAudit({
      tenantId: input.tenantId,
      actorMembershipId: input.actorMembershipId,
      action: "privacy.retention_retried",
      entityType: "privacy_retention_run",
      entityId: input.runId,
      meta: sql`json_object(
        'cursor', json(cursor),
        'attemptCount', attempt_count
      )`,
      createdAt: retriedAt,
      from: sql`privacy_retention_runs where id = ${input.runId}`,
    }),
  ]);
  if (!result) return null;
  return findRetentionRun(input.tenantId, input.runId);
}

export type RetentionClassResult = {
  eligible: number;
  affected: number;
  held: number;
  hasMore: boolean;
};

export async function inspectRetentionClass(input: {
  tenantId: string;
  classKey: RetentionClassKey;
  cutoff: Date;
}): Promise<RetentionClassResult> {
  const classKey = input.classKey;
  if (classKey === "logs" || classKey === "backups") {
    return { eligible: 0, affected: 0, held: 0, hasMore: false };
  }
  const now = new Date();
  const spec = retentionClassSpec({ ...input, classKey, now });
  const held = retentionProtectionPredicate(
    input.tenantId,
    sql.raw("subject_id"),
    now,
  );
  const [row] = await queryRows<{ eligible: number; held: number }>(sql`
    select
      count(*) filter (where not (${held})) as eligible,
      count(*) filter (where ${held}) as held
    from (${spec.candidates})
  `);
  return {
    eligible: Number(row?.eligible ?? 0),
    affected: 0,
    held: Number(row?.held ?? 0),
    hasMore: false,
  };
}

export async function executeRetentionClass(input: {
  tenantId: string;
  classKey: RetentionClassKey;
  cutoff: Date;
  limit: number;
}): Promise<RetentionClassResult> {
  const classKey = input.classKey;
  if (classKey === "logs" || classKey === "backups") {
    return { eligible: 0, affected: 0, held: 0, hasMore: false };
  }
  const now = new Date();
  const spec = retentionClassSpec({ ...input, classKey, now });
  const noHold = sql`not (${retentionProtectionPredicate(input.tenantId, sql.raw("subject_id"), now)})`;
  const eligible = await queryRows<{ store: string; id: string }>(sql`
    select store, id
    from (${spec.candidates})
    where ${noHold}
    order by sort_at, id
    limit ${input.limit}
  `);
  let affected = 0;
  if (eligible.length > 0) {
    const statements: AtomicStatement[] = [];
    for (const [store, mutate] of Object.entries(spec.mutations)) {
      const ids = eligible
        .filter((row) => row.store === store)
        .map((row) => row.id);
      if (ids.length === 0) continue;
      // The candidate and protection predicates are re-asserted by every
      // mutation, so a hold placed after the read still protects its rows.
      statements.push(
        mutate(
          sql`(select value from json_each(${json(ids)}))`,
          (subject) =>
            sql`not (${retentionProtectionPredicate(input.tenantId, subject, now)})`,
        ),
      );
    }
    const results = await runAtomic<{ id: string }>(statements);
    affected = (results ?? []).reduce((total, rows) => total + rows.length, 0);
  }
  return {
    eligible: affected,
    affected,
    held: 0,
    hasMore: eligible.length === input.limit,
  };
}

export async function updateRetentionRunProgress(input: {
  tenantId: string;
  runId: string;
  cursor: Record<string, unknown>;
  report: RetentionReport;
  completed: boolean;
}): Promise<PrivacyRetentionRun | null> {
  const db = getDb();
  const now = new Date();
  const statements: AtomicStatement[] = [
    guard(sql`exists (
      select 1 from privacy_retention_runs
      where tenant_id = ${input.tenantId}
        and id = ${input.runId}
        and status in ('queued', 'running')
    )`),
    db
      .update(privacyRetentionRuns)
      .set({
        status: input.completed ? "completed" : "queued",
        cursor: input.cursor,
        report: input.report,
        startedAt: sql`coalesce(${privacyRetentionRuns.startedAt}, ${ms(now)})`,
        completedAt: input.completed ? now : null,
        attemptCount: sql`${privacyRetentionRuns.attemptCount} + 1`,
        lastError: null,
        updatedAt: now,
      })
      .where(eq(privacyRetentionRuns.id, input.runId)),
  ];
  if (input.completed) {
    statements.push(
      insertAudit({
        tenantId: input.tenantId,
        actorMembershipId: sql`requested_by_membership_id`,
        action: "privacy.retention_completed",
        entityType: "privacy_retention_run",
        entityId: input.runId,
        meta: sql`json_object(
          'mode', mode,
          'asOf', ${isoTimestampSql(sql.raw("as_of"))},
          'attemptCount', attempt_count,
          'report', json(report)
        )`,
        createdAt: now,
        from: sql`privacy_retention_runs where id = ${input.runId}`,
      }),
    );
  }
  const result = await runAtomic(statements);
  if (!result) return null;
  return findRetentionRun(input.tenantId, input.runId);
}

export async function failRetentionRun(input: {
  tenantId: string;
  runId: string;
  message: string;
}): Promise<void> {
  const db = getDb();
  await db
    .update(privacyRetentionRuns)
    .set({
      status: "failed",
      lastError: input.message.slice(0, 1_000),
      attemptCount: sql`${privacyRetentionRuns.attemptCount} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(privacyRetentionRuns.tenantId, input.tenantId),
        eq(privacyRetentionRuns.id, input.runId),
        inArray(privacyRetentionRuns.status, ["queued", "running"]),
      ),
    );
}

export async function createExternalRunTask(input: {
  tenantId: string;
  runId: string;
  provider: PrivacyExternalTask["provider"];
  action: string;
}): Promise<void> {
  const db = getDb();
  await db
    .insert(privacyExternalTasks)
    .values({
      tenantId: input.tenantId,
      runId: input.runId,
      provider: input.provider,
      action: input.action,
    })
    .onConflictDoNothing();
}

export async function listExternalRunTasks(
  tenantId: string,
  runId: string,
): Promise<PrivacyExternalTask[]> {
  const db = getDb();
  return db
    .select()
    .from(privacyExternalTasks)
    .where(
      and(
        eq(privacyExternalTasks.tenantId, tenantId),
        eq(privacyExternalTasks.runId, runId),
      ),
    )
    .orderBy(asc(privacyExternalTasks.provider));
}

export async function createPrivacySubjectRequest(input: {
  tenantId: string;
  actorMembershipId: string;
  scope: "member" | "tenant";
  subjectMembershipId?: string | null;
  kind: PrivacySubjectRequest["kind"];
  payload: Record<string, unknown>;
}): Promise<PrivacySubjectRequest | null> {
  const db = getDb();
  const id = randomUUID();
  const subjectReference = `privacy-subject:${randomUUID()}`;
  const result = await runAtomic([
    guard(sql`
      ${input.scope} = 'tenant'
      or exists (
        select 1 from memberships
        where tenant_id = ${input.tenantId}
          and id = ${input.subjectMembershipId ?? null}
      )
    `),
    db.insert(privacySubjectRequests).values({
      id,
      tenantId: input.tenantId,
      scope: input.scope,
      subjectMembershipId: input.subjectMembershipId ?? null,
      subjectReference,
      kind: input.kind,
      status: "pending_verification",
      payload: input.payload,
      createdByMembershipId: input.actorMembershipId,
    }),
    requestAudit(
      input,
      id,
      "privacy.request_created",
      sql`json_object('scope', scope, 'kind', kind)`,
    ),
  ]);
  if (!result) return null;
  return findPrivacySubjectRequest(input.tenantId, id);
}

function requestAudit(
  input: { tenantId: string; actorMembershipId: string },
  requestId: string,
  action: string,
  meta: SQL,
  createdAt?: Date,
): SQL {
  return insertAudit({
    tenantId: input.tenantId,
    actorMembershipId: input.actorMembershipId,
    action,
    entityType: "privacy_subject_request",
    entityId: requestId,
    meta,
    createdAt,
    from: sql`privacy_subject_requests where id = ${requestId}`,
  });
}

function requestInState(
  tenantId: string,
  requestId: string,
  condition: SQL,
): SQL {
  return sql`exists (
    select 1 from privacy_subject_requests
    where tenant_id = ${tenantId}
      and id = ${requestId}
      and ${condition}
  )`;
}

export async function findPrivacySubjectRequest(
  tenantId: string,
  id: string,
): Promise<PrivacySubjectRequest | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(privacySubjectRequests)
    .where(
      and(
        eq(privacySubjectRequests.tenantId, tenantId),
        eq(privacySubjectRequests.id, id),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function verifyPrivacySubjectRequest(input: {
  tenantId: string;
  requestId: string;
  actorMembershipId: string;
}): Promise<PrivacySubjectRequest | null> {
  const db = getDb();
  const now = new Date();
  const result = await runAtomic([
    guard(
      requestInState(
        input.tenantId,
        input.requestId,
        sql`status = 'pending_verification'`,
      ),
    ),
    db
      .update(privacySubjectRequests)
      .set({
        status: sql`case
          when ${privacySubjectRequests.kind} in ('anonymization', 'erasure')
            then 'pending_approval'
          else 'approved'
        end`,
        verifiedByMembershipId: input.actorMembershipId,
        verifiedAt: now,
        updatedAt: now,
      })
      .where(eq(privacySubjectRequests.id, input.requestId)),
    requestAudit(
      input,
      input.requestId,
      "privacy.request_verified",
      sql`json_object('scope', scope, 'kind', kind)`,
      now,
    ),
  ]);
  if (!result) return null;
  return findPrivacySubjectRequest(input.tenantId, input.requestId);
}

export async function approvePrivacySubjectRequest(input: {
  tenantId: string;
  requestId: string;
  actorMembershipId: string;
}): Promise<PrivacySubjectRequest | null> {
  const db = getDb();
  const now = new Date();
  const result = await runAtomic([
    guard(
      requestInState(
        input.tenantId,
        input.requestId,
        sql`status = 'pending_approval'
          and created_by_membership_id is not ${input.actorMembershipId}
          and verified_by_membership_id is not null`,
      ),
    ),
    db
      .update(privacySubjectRequests)
      .set({
        status: "approved",
        approvedByMembershipId: input.actorMembershipId,
        approvedAt: now,
        updatedAt: now,
      })
      .where(eq(privacySubjectRequests.id, input.requestId)),
    requestAudit(
      input,
      input.requestId,
      "privacy.request_approved",
      sql`json_object('scope', scope, 'kind', kind)`,
      now,
    ),
  ]);
  if (!result) return null;
  return findPrivacySubjectRequest(input.tenantId, input.requestId);
}

/** Pending and active holds that have not expired, for one subject or all. */
function blockingHoldSql(
  tenantId: string,
  subject: SQL | string | null,
  now: Date,
): SQL {
  return sql`exists (
    select 1 from privacy_legal_holds hold
    where hold.tenant_id = ${tenantId}
      and hold.status in ('pending', 'active')
      and (hold.expires_at is null or hold.expires_at > ${ms(now)})
      and (
        hold.subject_membership_id is null
        or hold.subject_membership_id = ${subject}
      )
  )`;
}

export async function findBlockingLegalHold(input: {
  tenantId: string;
  membershipId?: string | null;
}): Promise<PrivacyLegalHold | null> {
  const db = getDb();
  const now = new Date();
  const subject = input.membershipId
    ? or(
        isNull(privacyLegalHolds.subjectMembershipId),
        eq(privacyLegalHolds.subjectMembershipId, input.membershipId),
      )
    : isNull(privacyLegalHolds.subjectMembershipId);
  const rows = await db
    .select()
    .from(privacyLegalHolds)
    .where(
      and(
        eq(privacyLegalHolds.tenantId, input.tenantId),
        inArray(privacyLegalHolds.status, ["pending", "active"]),
        or(
          isNull(privacyLegalHolds.expiresAt),
          gt(privacyLegalHolds.expiresAt, now),
        ),
        subject,
      ),
    )
    .orderBy(asc(privacyLegalHolds.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

async function findLegalHold(
  tenantId: string,
  id: string,
): Promise<PrivacyLegalHold | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(privacyLegalHolds)
    .where(
      and(
        eq(privacyLegalHolds.tenantId, tenantId),
        eq(privacyLegalHolds.id, id),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

function holdAudit(
  input: { tenantId: string; actorMembershipId: string },
  holdId: string,
  action: string,
  meta: SQL,
  createdAt?: Date,
): SQL {
  return insertAudit({
    tenantId: input.tenantId,
    actorMembershipId: input.actorMembershipId,
    action,
    entityType: "privacy_legal_hold",
    entityId: holdId,
    meta,
    createdAt,
    from: sql`privacy_legal_holds where id = ${holdId}`,
  });
}

const HOLD_AUDIT_META = sql`json_object(
  'scope', scope,
  'subjectMembershipId', subject_membership_id,
  'expiresAt', ${isoTimestampSql(sql.raw("expires_at"))}
)`;

export async function createLegalHold(input: {
  tenantId: string;
  actorMembershipId: string;
  subjectMembershipId?: string | null;
  scope: string;
  reason: string;
  expiresAt?: Date | null;
}): Promise<PrivacyLegalHold | null> {
  const db = getDb();
  const id = randomUUID();
  const subjectId = input.subjectMembershipId ?? null;
  const result = await runAtomic([
    guard(sql`
      ${activeAdmin(input.tenantId, input.actorMembershipId)}
      and (
        ${subjectId} is null
        or exists (
          select 1 from memberships subject
          where subject.id = ${subjectId}
            and subject.tenant_id = ${input.tenantId}
        )
      )
    `),
    db.insert(privacyLegalHolds).values({
      id,
      tenantId: input.tenantId,
      subjectMembershipId: subjectId,
      scope: input.scope,
      reason: input.reason,
      expiresAt: input.expiresAt ?? null,
      createdByMembershipId: input.actorMembershipId,
    }),
    holdAudit(input, id, "privacy.legal_hold_created", HOLD_AUDIT_META),
  ]);
  if (!result) return null;
  return findLegalHold(input.tenantId, id);
}

export async function approveLegalHold(input: {
  tenantId: string;
  holdId: string;
  actorMembershipId: string;
}): Promise<PrivacyLegalHold | null> {
  const db = getDb();
  const now = new Date();
  const result = await runAtomic([
    guard(sql`exists (
      select 1 from privacy_legal_holds
      where tenant_id = ${input.tenantId}
        and id = ${input.holdId}
        and status = 'pending'
        and created_by_membership_id is not ${input.actorMembershipId}
    )`),
    db
      .update(privacyLegalHolds)
      .set({
        status: "active",
        approvedByMembershipId: input.actorMembershipId,
        approvedAt: now,
        updatedAt: now,
      })
      .where(eq(privacyLegalHolds.id, input.holdId)),
    holdAudit(
      input,
      input.holdId,
      "privacy.legal_hold_approved",
      HOLD_AUDIT_META,
      now,
    ),
  ]);
  if (!result) return null;
  return findLegalHold(input.tenantId, input.holdId);
}

export async function releaseLegalHold(input: {
  tenantId: string;
  holdId: string;
  actorMembershipId: string;
}): Promise<PrivacyLegalHold | null> {
  const db = getDb();
  const now = new Date();
  const result = await runAtomic([
    guard(sql`exists (
      select 1 from privacy_legal_holds
      where tenant_id = ${input.tenantId}
        and id = ${input.holdId}
        and status = 'active'
    )`),
    db
      .update(privacyLegalHolds)
      .set({
        status: "released",
        releasedByMembershipId: input.actorMembershipId,
        releasedAt: now,
        updatedAt: now,
      })
      .where(eq(privacyLegalHolds.id, input.holdId)),
    holdAudit(
      input,
      input.holdId,
      "privacy.legal_hold_released",
      sql`json_object('scope', scope)`,
      now,
    ),
  ]);
  if (!result) return null;
  return findLegalHold(input.tenantId, input.holdId);
}

export async function upsertSubjectRestriction(input: {
  tenantId: string;
  membershipId: string;
  actorMembershipId: string;
  reason: string;
}): Promise<PrivacySubjectControl> {
  const db = getDb();
  const now = new Date();
  const [control] = await db
    .insert(privacySubjectControls)
    .values({
      tenantId: input.tenantId,
      membershipId: input.membershipId,
      restrictedAt: now,
      restrictionReason: input.reason,
      updatedByMembershipId: input.actorMembershipId,
    })
    .onConflictDoUpdate({
      target: [
        privacySubjectControls.tenantId,
        privacySubjectControls.membershipId,
      ],
      set: {
        restrictedAt: now,
        restrictionReason: input.reason,
        updatedByMembershipId: input.actorMembershipId,
        updatedAt: now,
      },
    })
    .returning();
  return control!;
}

export async function upsertSubjectObjection(input: {
  tenantId: string;
  membershipId: string;
  actorMembershipId: string;
  scopes: ObjectionScope[];
}): Promise<PrivacySubjectControl> {
  const db = getDb();
  const now = new Date();
  const [control] = await db
    .insert(privacySubjectControls)
    .values({
      tenantId: input.tenantId,
      membershipId: input.membershipId,
      objectedAt: now,
      objectionScopes: input.scopes,
      updatedByMembershipId: input.actorMembershipId,
    })
    .onConflictDoUpdate({
      target: [
        privacySubjectControls.tenantId,
        privacySubjectControls.membershipId,
      ],
      set: {
        objectedAt: now,
        objectionScopes: input.scopes,
        updatedByMembershipId: input.actorMembershipId,
        updatedAt: now,
      },
    })
    .returning();
  return control!;
}

export async function findSubjectControl(
  tenantId: string,
  membershipId: string,
): Promise<PrivacySubjectControl | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(privacySubjectControls)
    .where(
      and(
        eq(privacySubjectControls.tenantId, tenantId),
        eq(privacySubjectControls.membershipId, membershipId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function completePrivacyRequest(input: {
  tenantId: string;
  requestId: string;
  actorMembershipId: string;
  status: "completed" | "awaiting_external";
  result: Record<string, unknown>;
  scrubPayload?: boolean;
}): Promise<PrivacySubjectRequest | null> {
  const db = getDb();
  const now = new Date();
  const result = await runAtomic([
    guard(
      requestInState(
        input.tenantId,
        input.requestId,
        sql`status in ('approved', 'processing')`,
      ),
    ),
    db
      .update(privacySubjectRequests)
      .set({
        status: input.status,
        result: input.result,
        ...(input.scrubPayload ? { payload: {} } : {}),
        processedAt: now,
        lastError: null,
        updatedAt: now,
      })
      .where(eq(privacySubjectRequests.id, input.requestId)),
    requestAudit(
      input,
      input.requestId,
      "privacy.request_processed",
      sql`json_object('kind', kind, 'status', status, 'result', json(result))`,
      now,
    ),
  ]);
  if (!result) return null;
  return findPrivacySubjectRequest(input.tenantId, input.requestId);
}

export async function markPrivacyRequestBlocked(input: {
  tenantId: string;
  requestId: string;
  actorMembershipId: string;
  reason: string;
}): Promise<PrivacySubjectRequest | null> {
  const db = getDb();
  const now = new Date();
  const result = await runAtomic([
    guard(
      requestInState(
        input.tenantId,
        input.requestId,
        sql`status in ('approved', 'processing')`,
      ),
    ),
    db
      .update(privacySubjectRequests)
      .set({ status: "blocked", lastError: input.reason, updatedAt: now })
      .where(eq(privacySubjectRequests.id, input.requestId)),
    requestAudit(
      input,
      input.requestId,
      "privacy.request_blocked",
      sql`json_object('kind', kind, 'reason', ${input.reason})`,
      now,
    ),
  ]);
  if (!result) return null;
  return findPrivacySubjectRequest(input.tenantId, input.requestId);
}

export async function retryBlockedPrivacyRequest(input: {
  tenantId: string;
  requestId: string;
  actorMembershipId: string;
}): Promise<PrivacySubjectRequest | null> {
  const db = getDb();
  const now = new Date();
  const result = await runAtomic([
    guard(sql`
      ${requestInState(
        input.tenantId,
        input.requestId,
        sql`status = 'blocked' and approved_by_membership_id is not null`,
      )}
      and ${activeAdmin(input.tenantId, input.actorMembershipId)}
    `),
    db
      .update(privacySubjectRequests)
      .set({ status: "approved", lastError: null, updatedAt: now })
      .where(eq(privacySubjectRequests.id, input.requestId)),
    requestAudit(
      input,
      input.requestId,
      "privacy.request_retried",
      sql`json_object('kind', kind)`,
      now,
    ),
  ]);
  if (!result) return null;
  return findPrivacySubjectRequest(input.tenantId, input.requestId);
}

export async function createExternalRequestTasks(input: {
  tenantId: string;
  requestId: string;
  tasks: Array<{
    provider: PrivacyExternalTask["provider"];
    action: string;
    status?: PrivacyExternalTask["status"];
    operatorNote?: string;
  }>;
}): Promise<void> {
  if (input.tasks.length === 0) return;
  const db = getDb();
  const now = new Date();
  // Drizzle binds every column of every row; five rows stay well below the
  // D1 bound-parameter limit.
  await runAtomic(
    chunk(input.tasks, 5).map((tasks) =>
      db
        .insert(privacyExternalTasks)
        .values(
          tasks.map((task) => ({
            tenantId: input.tenantId,
            requestId: input.requestId,
            provider: task.provider,
            action: task.action,
            status: task.status ?? "pending",
            operatorNote: task.operatorNote,
            completedAt: task.status === "not_applicable" ? now : undefined,
          })),
        )
        .onConflictDoNothing(),
    ),
  );
}

export async function listExternalRequestTasks(
  tenantId: string,
  requestId: string,
): Promise<PrivacyExternalTask[]> {
  const db = getDb();
  return db
    .select()
    .from(privacyExternalTasks)
    .where(
      and(
        eq(privacyExternalTasks.tenantId, tenantId),
        eq(privacyExternalTasks.requestId, requestId),
      ),
    )
    .orderBy(asc(privacyExternalTasks.provider));
}

export async function completeExternalTask(input: {
  tenantId: string;
  taskId: string;
  actorMembershipId: string;
  status: "completed" | "not_applicable" | "failed";
  operatorNote: string;
}): Promise<PrivacyExternalTask | null> {
  const db = getDb();
  const now = new Date();
  const finalizes = input.status !== "failed";
  const result = await runAtomic([
    guard(sql`exists (
      select 1 from privacy_external_tasks
      where tenant_id = ${input.tenantId}
        and id = ${input.taskId}
        and status in ('pending', 'failed')
    )`),
    db
      .update(privacyExternalTasks)
      .set({
        status: input.status,
        operatorNote: input.operatorNote,
        completedByMembershipId: input.actorMembershipId,
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(privacyExternalTasks.id, input.taskId)),
    // The task is already updated, so "no open task remains" covers it too.
    sql`
      update privacy_subject_requests
      set status = 'completed', updated_at = ${ms(now)}
      where ${finalizes}
        and tenant_id = ${input.tenantId}
        and id = (
          select request_id from privacy_external_tasks where id = ${input.taskId}
        )
        and status = 'awaiting_external'
        and not exists (
          select 1 from privacy_external_tasks remaining
          where remaining.request_id = privacy_subject_requests.id
            and remaining.status in ('pending', 'failed')
        )
    `,
    // Must directly follow the request update: changes() reports its rows.
    insertAudit({
      tenantId: input.tenantId,
      actorMembershipId: input.actorMembershipId,
      action: "privacy.external_task_updated",
      entityType: "privacy_external_task",
      entityId: input.taskId,
      meta: sql`json_object(
        'provider', provider,
        'action', action,
        'status', status,
        'requestFinalized', json(case when changes() > 0 then 'true' else 'false' end)
      )`,
      createdAt: now,
      from: sql`privacy_external_tasks where id = ${input.taskId}`,
    }),
  ]);
  if (!result) return null;
  const rows = await db
    .select()
    .from(privacyExternalTasks)
    .where(eq(privacyExternalTasks.id, input.taskId))
    .limit(1);
  return rows[0] ?? null;
}

export async function correctMembershipForPrivacy(input: {
  tenantId: string;
  membershipId: string;
  displayName?: string | null;
  pilotCallsign?: string | null;
}): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .update(memberships)
    .set({
      ...(input.displayName !== undefined
        ? { displayName: input.displayName }
        : {}),
      ...(input.pilotCallsign !== undefined
        ? { pilotCallsign: input.pilotCallsign }
        : {}),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(memberships.tenantId, input.tenantId),
        eq(memberships.id, input.membershipId),
      ),
    )
    .returning({ id: memberships.id });
  return rows.length === 1;
}

export type PrivacyDestructionResult = {
  request: PrivacySubjectRequest;
  localRecords: {
    flights: number;
    requests: number;
    messages: number;
    telemetry: number;
  };
};

type DestructionInput = {
  tenantId: string;
  membershipId: string;
  requestId: string;
  actorMembershipId: string;
  finalStatus: "completed" | "awaiting_external";
  externalTasksRemaining: number;
};

/**
 * Row sets that the anonymization and erasure batches act on. Every set is
 * re-evaluated by each statement, so statements are ordered such that a set
 * is used before the rows it selects are deleted.
 */
function subjectSets(input: DestructionInput) {
  const tenantId = input.tenantId;
  const memberId = input.membershipId;
  const targetFlights = sql`(
    select id from flights
    where tenant_id = ${tenantId} and pilot_membership_id = ${memberId}
  )`;
  const subjectDevices = sql`(
    select id from simulator_devices
    where tenant_id = ${tenantId} and membership_id = ${memberId}
  )`;
  // Erasure clears the subject id of the processed request before this set
  // is used, so the request is included explicitly.
  const privacyRequests = sql`(
    select id from privacy_subject_requests
    where tenant_id = ${tenantId}
      and (subject_membership_id = ${memberId} or id = ${input.requestId})
  )`;
  const holds = sql`(
    select id from privacy_legal_holds
    where tenant_id = ${tenantId} and subject_membership_id = ${memberId}
  )`;
  const oooiEvents = sql`
    flight_oooi_events.tenant_id = ${tenantId}
    and (
      flight_oooi_events.actor_membership_id = ${memberId}
      or flight_oooi_events.device_id in ${subjectDevices}
      or flight_oooi_events.flight_id in ${targetFlights}
    )
  `;
  const messages = sql`
    acars_messages.tenant_id = ${tenantId}
    and (
      acars_messages.flight_id in ${targetFlights}
      or acars_messages.created_by_membership_id = ${memberId}
    )
  `;
  const scheduleRequestsOfSubject = sql`
    schedule_requests.tenant_id = ${tenantId}
    and schedule_requests.pilot_membership_id = ${memberId}
  `;
  const telemetryCount = sql`(
    (select count(*) from simulator_devices
      where tenant_id = ${tenantId} and membership_id = ${memberId})
    + (select count(*) from flight_telemetry_current
      where tenant_id = ${tenantId} and membership_id = ${memberId})
    + (select count(*) from flight_telemetry_leases
      where tenant_id = ${tenantId} and membership_id = ${memberId})
    + (select count(*) from flight_telemetry_track
      where tenant_id = ${tenantId} and membership_id = ${memberId})
    + (select count(*) from flight_oooi_events where ${oooiEvents})
  )`;
  const localRecords = sql`json_object(
    'flights', (select count(*) from flights
      where tenant_id = ${tenantId} and pilot_membership_id = ${memberId}),
    'requests', (select count(*) from schedule_requests
      where ${scheduleRequestsOfSubject}),
    'messages', (select count(*) from acars_messages where ${messages}),
    'telemetry', ${telemetryCount}
  )`;
  return {
    targetFlights,
    subjectDevices,
    privacyRequests,
    holds,
    oooiEvents,
    messages,
    scheduleRequestsOfSubject,
    localRecords,
  };
}

/**
 * Preconditions shared by anonymization and erasure: an approved request of
 * the right kind for this subject, an active admin actor, no blocking legal
 * hold and no open operational work. A failed guard leaves every record
 * untouched.
 */
function destructionGuards(
  input: DestructionInput,
  kind: "anonymization" | "erasure",
  now: Date,
): SQL[] {
  return [
    guard(sql`
      exists (
        select 1 from memberships member
        join privacy_subject_requests request
          on request.tenant_id = member.tenant_id
         and request.subject_membership_id = member.id
        where member.tenant_id = ${input.tenantId}
          and member.id = ${input.membershipId}
          and request.id = ${input.requestId}
          and request.kind = ${kind}
          and request.status = 'approved'
          and request.approved_by_membership_id is not null
      )
      and ${activeAdmin(input.tenantId, input.actorMembershipId)}
    `),
    guard(sql`not ${blockingHoldSql(input.tenantId, input.membershipId, now)}`),
    guard(sql`
      not exists (
        select 1 from flights
        where tenant_id = ${input.tenantId}
          and pilot_membership_id = ${input.membershipId}
          and status in ${OPEN_FLIGHT_STATUSES}
      )
      and not exists (
        select 1 from schedule_requests
        where tenant_id = ${input.tenantId}
          and pilot_membership_id = ${input.membershipId}
          and status in ${OPEN_REQUEST_STATUSES}
      )
    `),
  ];
}

function scrubSubjectTasks(
  input: DestructionInput,
  privacyRequests: SQL,
  nowMs: number,
): SQL {
  return sql`
    update privacy_external_tasks
    set
      status = case
        when request_id <> ${input.requestId} and status in ('pending', 'failed')
          then 'not_applicable'
        else status
      end,
      operator_note = null,
      completed_at = case
        when request_id <> ${input.requestId} and status in ('pending', 'failed')
          then ${nowMs}
        else completed_at
      end,
      updated_at = ${nowMs}
    where tenant_id = ${input.tenantId}
      and request_id in ${privacyRequests}
  `;
}

function scrubSubjectHolds(holds: SQL, nowMs: number): SQL {
  return sql`
    update privacy_legal_holds
    set reason = '[redacted by privacy workflow]', updated_at = ${nowMs}
    where id in ${holds}
  `;
}

function redactSubjectOooi(oooiEvents: SQL): SQL {
  return sql`
    update flight_oooi_events
    set actor_membership_id = null, device_id = null, reason = null
    where ${oooiEvents}
  `;
}

/** Audit rows that describe the subject, its privacy requests or holds. */
function subjectAuditRows(
  input: DestructionInput,
  privacyRequests: SQL,
  holds: SQL,
): SQL {
  return sql`
    audit_events.tenant_id = ${input.tenantId}
    and (
      audit_events.actor_membership_id = ${input.membershipId}
      or (audit_events.entity_type = 'membership'
        and audit_events.entity_id = ${input.membershipId})
      or (audit_events.entity_type = 'privacy_subject_request'
        and audit_events.entity_id in ${privacyRequests})
      or (audit_events.entity_type = 'privacy_legal_hold'
        and audit_events.entity_id in ${holds})
    )
  `;
}

function completeDestructionRequest(
  input: DestructionInput,
  operation: "anonymization" | "erasure",
  localRecords: SQL,
  nowMs: number,
): SQL {
  return sql`
    update privacy_subject_requests
    set
      ${operation === "erasure" ? sql`subject_membership_id = null,` : sql``}
      status = ${input.finalStatus},
      payload = '{}',
      result = json_object(
        'operation', ${operation},
        'localRecords', ${localRecords},
        'externalTasksRemaining', ${input.externalTasksRemaining}
      ),
      processed_at = ${nowMs},
      last_error = null,
      updated_at = ${nowMs}
    where id = ${input.requestId}
  `;
}

function destructionAudit(input: DestructionInput, now: Date): SQL {
  return insertAudit({
    tenantId: input.tenantId,
    actorMembershipId: input.actorMembershipId,
    action: "privacy.request_processed",
    entityType: "privacy_subject_request",
    entityId: input.requestId,
    meta: sql`json_object(
      'kind', kind,
      'status', status,
      'localRecords', result -> '$.localRecords',
      'externalTasksRemaining', ${input.externalTasksRemaining}
    )`,
    createdAt: now,
    from: sql`privacy_subject_requests where id = ${input.requestId}`,
  });
}

async function destructionResult(
  input: DestructionInput,
): Promise<PrivacyDestructionResult | null> {
  const request = await findPrivacySubjectRequest(
    input.tenantId,
    input.requestId,
  );
  if (!request) return null;
  const local = ((request.result as Record<string, unknown> | null)
    ?.localRecords ?? {}) as Record<string, unknown>;
  return {
    request,
    localRecords: {
      flights: Number(local.flights ?? 0),
      requests: Number(local.requests ?? 0),
      messages: Number(local.messages ?? 0),
      telemetry: Number(local.telemetry ?? 0),
    },
  };
}

export async function anonymizePrivacySubject(
  input: DestructionInput,
): Promise<PrivacyDestructionResult | null> {
  const now = new Date();
  const nowMs = ms(now);
  const sets = subjectSets(input);
  const result = await runAtomic([
    ...destructionGuards(input, "anonymization", now),
    // Counts are taken before anything below changes the subject's rows.
    completeDestructionRequest(
      input,
      "anonymization",
      sets.localRecords,
      nowMs,
    ),
    sql`
      update privacy_subject_controls
      set restriction_reason = null, updated_at = ${nowMs}
      where tenant_id = ${input.tenantId} and membership_id = ${input.membershipId}
    `,
    scrubSubjectHolds(sets.holds, nowMs),
    scrubSubjectTasks(input, sets.privacyRequests, nowMs),
    sql`
      update privacy_subject_requests
      set
        status = case
          when status in ('pending_verification', 'pending_approval', 'approved', 'processing')
            then 'cancelled'
          else status
        end,
        payload = '{}',
        result = json_object('subjectAnonymized', json('true')),
        last_error = null,
        updated_at = ${nowMs}
      where id in ${sets.privacyRequests}
        and id <> ${input.requestId}
    `,
    sql`
      update schedule_requests
      set title = null, notes = null, preferences = '{}', reject_reason = null,
        updated_at = ${nowMs}
      where ${sets.scheduleRequestsOfSubject}
    `,
    sql`
      update flights
      set dispatcher_notes = null, cancel_reason = null, declined_reason = null,
        updated_at = ${nowMs}
      where id in ${sets.targetFlights}
    `,
    sql`
      update dispatch_releases
      set release_notes = null, dispatcher_remarks = null
      where tenant_id = ${input.tenantId}
        and (
          released_by_membership_id = ${input.membershipId}
          or flight_id in ${sets.targetFlights}
        )
    `,
    sql`
      update flight_operational_events
      set actor_membership_id = null, meta = '{}'
      where tenant_id = ${input.tenantId}
        and (
          actor_membership_id = ${input.membershipId}
          or flight_id in ${sets.targetFlights}
        )
    `,
    // OOOI events reference devices with RESTRICT, so they are detached first.
    redactSubjectOooi(sets.oooiEvents),
    sql`
      delete from simulator_devices
      where tenant_id = ${input.tenantId} and membership_id = ${input.membershipId}
    `,
    sql`
      delete from simbrief_dispatches
      where tenant_id = ${input.tenantId}
        and (
          created_by_membership_id = ${input.membershipId}
          or flight_id in ${sets.targetFlights}
        )
    `,
    sql`
      update acars_messages
      set
        body = '[redacted by privacy workflow]',
        hoppie_raw = null,
        provider_message_id = null,
        from_station = 'REDACTED',
        to_station = 'REDACTED',
        created_by_membership_id = null,
        updated_at = ${nowMs}
      where ${sets.messages}
    `,
    sql`
      update audit_events
      set actor_membership_id = null, meta = '{}'
      where ${subjectAuditRows(input, sets.privacyRequests, sets.holds)}
    `,
    sql`
      update memberships
      set
        clerk_user_id = 'anon:' || ${uuidV4Sql},
        role = 'pilot',
        display_name = null,
        pilot_callsign = null,
        simbrief_user_id = null,
        simbrief_verified_at = null,
        navigraph_subject = null,
        navigraph_username = null,
        navigraph_connected_at = null,
        status = 'disabled',
        updated_at = ${nowMs}
      where id = ${input.membershipId}
    `,
    destructionAudit(input, now),
  ]);
  if (!result) return null;
  return destructionResult(input);
}

export async function erasePrivacySubject(
  input: DestructionInput,
): Promise<PrivacyDestructionResult | null> {
  const now = new Date();
  const nowMs = ms(now);
  const sets = subjectSets(input);
  const result = await runAtomic([
    ...destructionGuards(input, "erasure", now),
    // Counts are taken before anything below deletes the subject's rows.
    completeDestructionRequest(input, "erasure", sets.localRecords, nowMs),
    scrubSubjectHolds(sets.holds, nowMs),
    scrubSubjectTasks(input, sets.privacyRequests, nowMs),
    sql`delete from acars_messages where ${sets.messages}`,
    sql`
      delete from simbrief_dispatches
      where tenant_id = ${input.tenantId}
        and (
          flight_id in ${sets.targetFlights}
          or created_by_membership_id = ${input.membershipId}
        )
    `,
    sql`
      update dispatch_releases
      set release_notes = null, dispatcher_remarks = null
      where tenant_id = ${input.tenantId}
        and released_by_membership_id = ${input.membershipId}
        and flight_id not in ${sets.targetFlights}
    `,
    sql`
      update flight_operational_events
      set actor_membership_id = null, meta = '{}'
      where tenant_id = ${input.tenantId}
        and actor_membership_id = ${input.membershipId}
        and flight_id not in ${sets.targetFlights}
    `,
    redactSubjectOooi(sets.oooiEvents),
    sql`delete from flights where id in ${sets.targetFlights}`,
    sql`delete from schedule_requests where ${sets.scheduleRequestsOfSubject}`,
    sql`
      delete from audit_events
      where ${subjectAuditRows(input, sets.privacyRequests, sets.holds)}
    `,
    sql`
      update privacy_subject_requests
      set
        status = case
          when status in ('pending_verification', 'pending_approval', 'approved', 'processing')
            then 'cancelled'
          else status
        end,
        payload = '{}',
        result = json_object('subjectErased', json('true')),
        last_error = null,
        updated_at = ${nowMs}
      where tenant_id = ${input.tenantId}
        and subject_membership_id = ${input.membershipId}
        and id <> ${input.requestId}
    `,
    sql`delete from memberships where id = ${input.membershipId}`,
    destructionAudit(input, now),
  ]);
  if (!result) return null;
  return destructionResult(input);
}

export const PRIVACY_EXPORT_STORES = [
  "tenant",
  "memberships",
  "privacyPolicies",
  "retentionRuns",
  "subjectControls",
  "scheduleRequests",
  "flights",
  "dispatchReleases",
  "flightOperationalEvents",
  "simulatorDevices",
  "flightTelemetryCurrent",
  "flightTelemetryLeases",
  "flightTelemetryTrack",
  "flightOooiEvents",
  "oauthTransactions",
  "simbriefDispatches",
  "acarsMessages",
  "auditEvents",
  "privacyRequests",
  "legalHolds",
  "externalTasks",
  "mockAcarsQueue",
] as const;

export type PrivacyExportStore = (typeof PRIVACY_EXPORT_STORES)[number];

export type PrivacyExportRecord = {
  id: string;
  data: Record<string, unknown>;
};

type ExportSpec = {
  table: SQLiteTable;
  /** Primary key column; defaults to `id`. */
  idColumn?: string;
  /** Columns that never leave the database (secrets, internal references). */
  omit?: readonly string[];
  /** Flags added to every exported record. */
  extra?: Record<string, unknown>;
  /** Member-scope filter; `src` is the alias of the exported table. */
  member: (memberId: string | null) => SQL;
  /** The tenant row itself is matched by id instead of tenant_id. */
  tenantColumn?: string;
};

const ownedFlight = (column: string, memberId: string | null) => sql`exists (
  select 1 from flights flight
  where flight.id = src.${sql.raw(column)}
    and flight.tenant_id = src.tenant_id
    and flight.pilot_membership_id = ${memberId}
)`;

const EXPORT_SPECS: Record<PrivacyExportStore, ExportSpec> = {
  tenant: {
    table: tenants,
    tenantColumn: "id",
    omit: ["hoppie_logon_enc"],
    member: () => sql`1`,
  },
  memberships: {
    table: memberships,
    member: (memberId) => sql`src.id = ${memberId}`,
  },
  privacyPolicies: {
    table: privacyPolicies,
    member: (memberId) => sql`(
      src.created_by_membership_id = ${memberId}
      or src.approved_by_membership_id = ${memberId}
    )`,
  },
  retentionRuns: {
    table: privacyRetentionRuns,
    member: (memberId) => sql`src.requested_by_membership_id = ${memberId}`,
  },
  subjectControls: {
    table: privacySubjectControls,
    member: (memberId) => sql`(
      src.membership_id = ${memberId}
      or src.updated_by_membership_id = ${memberId}
    )`,
  },
  scheduleRequests: {
    table: scheduleRequests,
    member: (memberId) => sql`src.pilot_membership_id = ${memberId}`,
  },
  flights: {
    table: flights,
    member: (memberId) => sql`src.pilot_membership_id = ${memberId}`,
  },
  dispatchReleases: {
    table: dispatchReleases,
    member: (memberId) => sql`(
      src.released_by_membership_id = ${memberId}
      or ${ownedFlight("flight_id", memberId)}
    )`,
  },
  flightOperationalEvents: {
    table: flightOperationalEvents,
    member: (memberId) => sql`(
      src.actor_membership_id = ${memberId}
      or ${ownedFlight("flight_id", memberId)}
    )`,
  },
  simulatorDevices: {
    table: simulatorDevices,
    omit: ["token_mac"],
    extra: { authenticatorOmitted: true },
    member: (memberId) => sql`src.membership_id = ${memberId}`,
  },
  flightTelemetryCurrent: {
    table: flightTelemetryCurrent,
    idColumn: "flight_id",
    member: (memberId) => sql`src.membership_id = ${memberId}`,
  },
  flightTelemetryLeases: {
    table: flightTelemetryLeases,
    idColumn: "flight_id",
    member: (memberId) => sql`src.membership_id = ${memberId}`,
  },
  flightTelemetryTrack: {
    table: flightTelemetryTrack,
    member: (memberId) => sql`src.membership_id = ${memberId}`,
  },
  flightOooiEvents: {
    table: flightOooiEvents,
    member: (memberId) => sql`(
      src.actor_membership_id = ${memberId}
      or exists (
        select 1 from simulator_devices device
        where device.id = src.device_id
          and device.tenant_id = src.tenant_id
          and device.membership_id = ${memberId}
      )
      or ${ownedFlight("flight_id", memberId)}
    )`,
  },
  oauthTransactions: {
    table: navigraphOauthTransactions,
    omit: ["code_verifier_enc"],
    extra: { encryptedCredentialOmitted: true },
    member: (memberId) => sql`src.membership_id = ${memberId}`,
  },
  simbriefDispatches: {
    table: simbriefDispatches,
    omit: ["callback_token_mac"],
    member: (memberId) => sql`(
      src.created_by_membership_id = ${memberId}
      or ${ownedFlight("flight_id", memberId)}
    )`,
  },
  acarsMessages: {
    table: acarsMessages,
    member: (memberId) => sql`(
      src.created_by_membership_id = ${memberId}
      or ${ownedFlight("flight_id", memberId)}
    )`,
  },
  auditEvents: {
    table: auditEvents,
    member: (memberId) => sql`(
      src.actor_membership_id = ${memberId}
      or (src.entity_type = 'membership' and src.entity_id = ${memberId})
      or (
        src.entity_type in ('flight', 'schedule_request')
        and src.entity_id in (
          select flight.id from flights flight
          where flight.tenant_id = src.tenant_id
            and flight.pilot_membership_id = ${memberId}
          union all
          select request.id from schedule_requests request
          where request.tenant_id = src.tenant_id
            and request.pilot_membership_id = ${memberId}
        )
      )
    )`,
  },
  privacyRequests: {
    table: privacySubjectRequests,
    omit: ["subject_reference"],
    member: (memberId) => sql`(
      src.subject_membership_id = ${memberId}
      or src.created_by_membership_id = ${memberId}
      or src.verified_by_membership_id = ${memberId}
      or src.approved_by_membership_id = ${memberId}
    )`,
  },
  legalHolds: {
    table: privacyLegalHolds,
    member: (memberId) => sql`(
      src.subject_membership_id = ${memberId}
      or src.created_by_membership_id = ${memberId}
      or src.approved_by_membership_id = ${memberId}
      or src.released_by_membership_id = ${memberId}
    )`,
  },
  externalTasks: {
    table: privacyExternalTasks,
    member: (memberId) => sql`(
      exists (
        select 1 from privacy_subject_requests request
        where request.id = src.request_id
          and request.tenant_id = src.tenant_id
          and request.subject_membership_id = ${memberId}
      )
      or exists (
        select 1 from privacy_retention_runs run
        where run.id = src.run_id
          and run.tenant_id = src.tenant_id
          and run.requested_by_membership_id = ${memberId}
      )
      or src.completed_by_membership_id = ${memberId}
    )`,
  },
  mockAcarsQueue: {
    table: mockAcarsQueue,
    member: () => sql`0`,
  },
};

/** D1 allows 32 arguments per SQL function: 15 key/value pairs per object. */
const EXPORT_PAIRS_PER_OBJECT = 15;

/**
 * JSON objects that together hold every exported column of a row, keyed by
 * column name. Timestamps are ISO-8601 strings, booleans JSON booleans and
 * JSON columns embedded documents, as PostgreSQL's `to_jsonb(row)` produced.
 */
function exportJsonColumns(spec: ExportSpec): SQL[] {
  const omitted = new Set(spec.omit ?? []);
  const pairs = Object.values(getTableColumns(spec.table))
    .filter((column) => !omitted.has(column.name))
    .map((column) => {
      const ref = sql.raw(`src."${column.name}"`);
      let value: SQL;
      switch (column.columnType) {
        case "SQLiteTimestamp":
          value = isoTimestampSql(ref);
          break;
        case "SQLiteBoolean":
          value = sql`case when ${ref} is null then null when ${ref} then json('true') else json('false') end`;
          break;
        case "SQLiteTextJson":
          value = sql`json(${ref})`;
          break;
        default:
          value = ref;
      }
      return sql`${sql.raw(`'${column.name}'`)}, ${value}`;
    });
  return chunk(pairs, EXPORT_PAIRS_PER_OBJECT).map(
    (group) => sql`json_object(${sql.join(group, sql`, `)})`,
  );
}

/**
 * Read one deterministic page from one inventoried store. Member exports use
 * direct actor links plus owned-flight/request links, so provider payloads and
 * operational free text are not silently omitted.
 */
export async function listPrivacyExportStoreRecords(input: {
  tenantId: string;
  scope: "member" | "tenant";
  membershipId?: string | null;
  store: PrivacyExportStore;
  afterId?: string;
  limit: number;
}): Promise<PrivacyExportRecord[]> {
  const spec = EXPORT_SPECS[input.store];
  const idColumn = sql.raw(`src."${spec.idColumn ?? "id"}"`);
  const tenantColumn = sql.raw(`src."${spec.tenantColumn ?? "tenant_id"}"`);
  const parts = exportJsonColumns(spec);
  const memberScope = input.scope === "member";
  const afterId = input.afterId ?? "00000000-0000-0000-0000-000000000000";
  const rows = await queryRows<Record<string, string>>(sql`
    select ${idColumn} as id,
      ${sql.join(
        parts.map((part, index) => sql`${part} as ${sql.raw(`part_${index}`)}`),
        sql`, `,
      )}
    from ${spec.table} src
    where ${tenantColumn} = ${input.tenantId}
      and (not ${memberScope} or ${spec.member(input.membershipId ?? null)})
      and ${idColumn} > ${afterId}
    order by ${idColumn}
    limit ${input.limit}
  `);
  return rows.map((record) => {
    const data: Record<string, unknown> = {};
    parts.forEach((_part, index) => {
      Object.assign(data, JSON.parse(record[`part_${index}`]!) as object);
    });
    return { id: record.id!, data: { ...data, ...spec.extra } };
  });
}

type RetentionMutation = (ids: SQL, noHold: (subject: SQL) => SQL) => SQL;

type RetentionSpec = {
  /** Rows of `(store, id, subject_id, sort_at)` that are past retention. */
  candidates: SQL;
  /** One mutation per store; each re-asserts the candidate predicate. */
  mutations: Record<string, RetentionMutation>;
};

function retentionClassSpec(input: {
  tenantId: string;
  classKey: Exclude<RetentionClassKey, "logs" | "backups">;
  cutoff: Date;
  now: Date;
}): RetentionSpec {
  const tenantId = input.tenantId;
  const cutoff = ms(input.cutoff);
  const nowMs = ms(input.now);
  switch (input.classKey) {
    case "memberships": {
      const expired = (m: string) => {
        const row = sql.raw(m);
        return sql`
          ${row}.tenant_id = ${tenantId}
          and ${row}.status = 'disabled'
          and ${row}.updated_at < ${cutoff}
          and ${row}.clerk_user_id not like 'anon:%'
          and not exists (
            select 1 from flights f
            where f.tenant_id = ${row}.tenant_id
              and f.pilot_membership_id = ${row}.id
              and f.status in ${OPEN_FLIGHT_STATUSES}
          )
          and not exists (
            select 1 from schedule_requests sr
            where sr.tenant_id = ${row}.tenant_id
              and sr.pilot_membership_id = ${row}.id
              and sr.status in ${OPEN_REQUEST_STATUSES}
          )
        `;
      };
      return {
        candidates: sql`
          select 'membership' as store, m.id, m.id as subject_id, m.updated_at as sort_at
          from memberships m
          where ${expired("m")}
        `,
        mutations: {
          membership: (ids, noHold) => sql`
            update memberships
            set
              clerk_user_id = 'anon:' || ${uuidV4Sql},
              role = 'pilot',
              display_name = null,
              pilot_callsign = null,
              simbrief_user_id = null,
              simbrief_verified_at = null,
              navigraph_subject = null,
              navigraph_username = null,
              navigraph_connected_at = null,
              updated_at = ${nowMs}
            where id in ${ids}
              and ${expired("memberships")}
              and ${noHold(sql.raw("memberships.id"))}
            returning id
          `,
        },
      };
    }
    case "scheduleRequests":
      return {
        candidates: sql`
          select 'request' as store, id, pilot_membership_id as subject_id, updated_at as sort_at
          from schedule_requests
          where tenant_id = ${tenantId}
            and status in ('fulfilled', 'rejected', 'cancelled')
            and updated_at < ${cutoff}
        `,
        mutations: {
          request: (ids, noHold) => sql`
            delete from schedule_requests
            where id in ${ids}
              and tenant_id = ${tenantId}
              and status in ('fulfilled', 'rejected', 'cancelled')
              and updated_at < ${cutoff}
              and ${noHold(sql.raw("schedule_requests.pilot_membership_id"))}
            returning id
          `,
        },
      };
    case "flights":
      return {
        candidates: sql`
          select 'flight' as store, id, pilot_membership_id as subject_id, updated_at as sort_at
          from flights
          where tenant_id = ${tenantId}
            and status in ('declined', 'completed', 'cancelled')
            and updated_at < ${cutoff}
        `,
        mutations: {
          flight: (ids, noHold) => sql`
            delete from flights
            where id in ${ids}
              and tenant_id = ${tenantId}
              and status in ('declined', 'completed', 'cancelled')
              and updated_at < ${cutoff}
              and ${noHold(sql.raw("flights.pilot_membership_id"))}
            returning id
          `,
        },
      };
    case "telemetry":
      return {
        candidates: sql`
          select 'current' as store, flight_id as id, membership_id as subject_id, sample_at as sort_at
          from flight_telemetry_current
          where tenant_id = ${tenantId} and sample_at < ${cutoff}
          union all
          select 'lease', flight_id, membership_id, lease_expires_at
          from flight_telemetry_leases
          where tenant_id = ${tenantId} and lease_expires_at < ${cutoff}
          union all
          select 'track', id, membership_id, sample_at
          from flight_telemetry_track
          where tenant_id = ${tenantId} and sample_at < ${cutoff}
        `,
        mutations: {
          current: (ids, noHold) => sql`
            delete from flight_telemetry_current
            where flight_id in ${ids}
              and tenant_id = ${tenantId}
              and sample_at < ${cutoff}
              and ${noHold(sql.raw("flight_telemetry_current.membership_id"))}
            returning flight_id as id
          `,
          lease: (ids, noHold) => sql`
            delete from flight_telemetry_leases
            where flight_id in ${ids}
              and tenant_id = ${tenantId}
              and lease_expires_at < ${cutoff}
              and ${noHold(sql.raw("flight_telemetry_leases.membership_id"))}
            returning flight_id as id
          `,
          track: (ids, noHold) => sql`
            delete from flight_telemetry_track
            where id in ${ids}
              and tenant_id = ${tenantId}
              and sample_at < ${cutoff}
              and ${noHold(sql.raw("flight_telemetry_track.membership_id"))}
            returning id
          `,
        },
      };
    case "simbrief": {
      const subject = (row: string) => {
        const ref = sql.raw(row);
        return sql`coalesce(${ref}.created_by_membership_id, (
          select f.pilot_membership_id from flights f
          where f.id = ${ref}.flight_id and f.tenant_id = ${ref}.tenant_id
        ))`;
      };
      return {
        candidates: sql`
          select 'dispatch' as store, sd.id, ${subject("sd")} as subject_id, sd.created_at as sort_at
          from simbrief_dispatches sd
          where sd.tenant_id = ${tenantId}
            and sd.created_at < ${cutoff}
            and exists (
              select 1 from flights f
              where f.id = sd.flight_id and f.tenant_id = sd.tenant_id
            )
        `,
        mutations: {
          dispatch: (ids, noHold) => sql`
            delete from simbrief_dispatches
            where id in ${ids}
              and tenant_id = ${tenantId}
              and created_at < ${cutoff}
              and ${noHold(subject("simbrief_dispatches"))}
            returning id
          `,
        },
      };
    }
    case "acars": {
      const subject = (row: string) => {
        const ref = sql.raw(row);
        return sql`coalesce(${ref}.created_by_membership_id, (
          select f.pilot_membership_id from flights f
          where f.id = ${ref}.flight_id and f.tenant_id = ${ref}.tenant_id
        ))`;
      };
      return {
        candidates: sql`
          select 'message' as store, am.id, ${subject("am")} as subject_id, am.created_at as sort_at
          from acars_messages am
          where am.tenant_id = ${tenantId} and am.created_at < ${cutoff}
          union all
          select 'mock_queue', id, null, created_at
          from mock_acars_queue
          where tenant_id = ${tenantId} and created_at < ${cutoff}
        `,
        mutations: {
          message: (ids, noHold) => sql`
            delete from acars_messages
            where id in ${ids}
              and tenant_id = ${tenantId}
              and created_at < ${cutoff}
              and ${noHold(subject("acars_messages"))}
            returning id
          `,
          mock_queue: (ids, noHold) => sql`
            delete from mock_acars_queue
            where id in ${ids}
              and tenant_id = ${tenantId}
              and created_at < ${cutoff}
              and ${noHold(sql`null`)}
            returning id
          `,
        },
      };
    }
    case "oauth":
      return {
        candidates: sql`
          select 'transaction' as store, id, membership_id as subject_id, created_at as sort_at
          from navigraph_oauth_transactions
          where tenant_id = ${tenantId}
            and created_at < ${cutoff}
            and expires_at < ${nowMs}
        `,
        mutations: {
          transaction: (ids, noHold) => sql`
            delete from navigraph_oauth_transactions
            where id in ${ids}
              and tenant_id = ${tenantId}
              and created_at < ${cutoff}
              and expires_at < ${nowMs}
              and ${noHold(sql.raw("navigraph_oauth_transactions.membership_id"))}
            returning id
          `,
        },
      };
    case "audit":
      return {
        candidates: sql`
          select 'audit' as store, id, actor_membership_id as subject_id, created_at as sort_at
          from audit_events
          where tenant_id = ${tenantId} and created_at < ${cutoff}
        `,
        mutations: {
          audit: (ids, noHold) => sql`
            delete from audit_events
            where id in ${ids}
              and tenant_id = ${tenantId}
              and created_at < ${cutoff}
              and ${noHold(sql.raw("audit_events.actor_membership_id"))}
            returning id
          `,
        },
      };
  }
}

/** `true` when a legal hold or a processing restriction protects the subject. */
function retentionProtectionPredicate(
  tenantId: string,
  subject: SQL,
  now: Date,
): SQL {
  return sql`(
    ${blockingHoldSql(tenantId, subject, now)}
    or (
      ${subject} is not null
      and exists (
        select 1 from privacy_subject_controls control
        where control.tenant_id = ${tenantId}
          and control.membership_id = ${subject}
          and control.restricted_at is not null
      )
    )
  )`;
}
