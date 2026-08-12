import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { getDb } from "../client.js";
import {
  privacyExternalTasks,
  privacyPolicies,
  privacyRetentionRuns,
  privacySubjectControls,
  privacySubjectRequests,
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

export async function createPrivacyPolicy(input: {
  tenantId: string;
  actorMembershipId: string;
  config: RetentionPolicyConfig;
}): Promise<PrivacyPolicy> {
  const db = getDb();
  const result = await db.execute<PrivacyPolicy>(sql`
    with next_version as (
      select coalesce(max(version), 0)::int + 1 as version
      from privacy_policies
      where tenant_id = ${input.tenantId}::uuid
    ), inserted as (
      insert into privacy_policies (
        tenant_id, version, status, config, created_by_membership_id
      )
      select
        ${input.tenantId}::uuid,
        next_version.version,
        'draft',
        ${JSON.stringify(input.config)}::jsonb,
        ${input.actorMembershipId}::uuid
      from next_version
      returning *
    ), recorded_audit as (
      insert into audit_events (
        tenant_id, actor_membership_id, action, entity_type, entity_id, meta
      )
      select
        tenant_id,
        ${input.actorMembershipId}::uuid,
        'privacy.policy_created',
        'privacy_policy',
        id::text,
        jsonb_build_object(
          'version', version,
          'automaticExecution', config->'automaticExecution'
        )
      from inserted
      returning id
    )
    select inserted.*
    from inserted, recorded_audit
  `);
  return normalizePolicy(result.rows[0]!);
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
  const lock = privacyTenantLock(db, input.tenantId);
  const operation = db.execute<PrivacyPolicy>(sql`
    with candidate as materialized (
      select p.*
      from privacy_policies p
      join memberships approver
        on approver.id = ${input.actorMembershipId}::uuid
       and approver.tenant_id = p.tenant_id
       and approver.role = 'admin'
       and approver.status = 'active'
      where p.tenant_id = ${input.tenantId}::uuid
        and p.id = ${input.policyId}::uuid
        and p.status = 'draft'
        and p.created_by_membership_id is distinct from ${input.actorMembershipId}::uuid
      for update of p
    ), retired as (
      update privacy_policies current_policy
      set status = 'retired', updated_at = ${approvedAt}
      from candidate
      where current_policy.tenant_id = candidate.tenant_id
        and current_policy.status = 'active'
      returning current_policy.id
    ), activated as (
      update privacy_policies policy
      set
        status = 'active',
        approved_by_membership_id = ${input.actorMembershipId}::uuid,
        approved_at = ${approvedAt},
        effective_at = ${approvedAt},
        updated_at = ${approvedAt}
      from candidate
      where policy.id = candidate.id
      returning policy.*
    ), recorded_audit as (
      insert into audit_events (
        tenant_id, actor_membership_id, action, entity_type, entity_id, meta
      )
      select
        tenant_id,
        ${input.actorMembershipId}::uuid,
        'privacy.policy_approved',
        'privacy_policy',
        id::text,
        jsonb_build_object(
          'version', version,
          'retiredPolicyCount', (select count(*)::int from retired)
        )
      from activated
      returning id
    )
    select activated.*
    from activated, recorded_audit
  `);
  const [, result] = await db.batch([lock, operation] as const);
  return result.rows[0] ? normalizePolicy(result.rows[0]) : null;
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
  const result = await db.execute<PrivacyRetentionRun & { inserted: boolean }>(
    sql`
      with inserted as (
        insert into privacy_retention_runs (
          id,
          tenant_id,
          policy_id,
          mode,
          status,
          as_of,
          dry_run_id,
          idempotency_key,
          cursor,
          report,
          requested_by_membership_id
        ) values (
          ${id}::uuid,
          ${input.tenantId}::uuid,
          ${input.policyId}::uuid,
          ${input.mode}::privacy_run_mode,
          'queued',
          ${input.asOf},
          ${input.dryRunId ?? null}::uuid,
          ${input.idempotencyKey},
          ${JSON.stringify({ classIndex: 0 })}::jsonb,
          ${JSON.stringify(input.report)}::jsonb,
          ${input.actorMembershipId ?? null}::uuid
        )
        on conflict (tenant_id, idempotency_key) do nothing
        returning *, true as inserted
      ), selected as (
        select *, false as inserted
        from privacy_retention_runs
        where tenant_id = ${input.tenantId}::uuid
          and idempotency_key = ${input.idempotencyKey}
          and not exists (select 1 from inserted)
      ), recorded_audit as (
        insert into audit_events (
          tenant_id, actor_membership_id, action, entity_type, entity_id, meta
        )
        select
          tenant_id,
          requested_by_membership_id,
          'privacy.retention_queued',
          'privacy_retention_run',
          id::text,
          jsonb_build_object(
            'mode', mode,
            'policyId', policy_id,
            'dryRunId', dry_run_id
          )
        from inserted
        returning id
      )
      select inserted.* from inserted, recorded_audit
      union all
      select * from selected
      limit 1
    `,
  );
  const row = result.rows[0]!;
  return { run: normalizeRun(row), created: row.inserted };
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

export async function listRunnableRetentionRuns(
  limit: number,
): Promise<PrivacyRetentionRun[]> {
  const db = getDb();
  const result = await db.execute<PrivacyRetentionRun>(sql`
    select *
    from privacy_retention_runs
    where status = 'queued'
      or (status = 'running' and updated_at < now() - interval '10 minutes')
    order by created_at, id
    limit ${limit}
  `);
  return result.rows.map(normalizeRun);
}

export async function claimRetentionRun(input: {
  tenantId: string;
  runId: string;
}): Promise<PrivacyRetentionRun | null> {
  const db = getDb();
  const result = await db.execute<PrivacyRetentionRun>(sql`
    update privacy_retention_runs
    set
      status = 'running',
      started_at = coalesce(started_at, now()),
      updated_at = now()
    where tenant_id = ${input.tenantId}::uuid
      and id = ${input.runId}::uuid
      and (
        status = 'queued'
        or (status = 'running' and updated_at < now() - interval '10 minutes')
      )
    returning *
  `);
  return result.rows[0] ? normalizeRun(result.rows[0]) : null;
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
  const result = await db.execute<{ present: boolean }>(sql`
    select exists (
      select 1
      from privacy_retention_runs
      where tenant_id = ${input.tenantId}::uuid
        and policy_id = ${input.policyId}::uuid
        and created_at >= ${input.since}
    ) as present
  `);
  return Boolean(result.rows[0]?.present);
}

export async function retryRetentionRun(input: {
  tenantId: string;
  runId: string;
  actorMembershipId: string;
}): Promise<PrivacyRetentionRun | null> {
  const db = getDb();
  const retriedAt = new Date();
  const result = await db.execute<PrivacyRetentionRun>(sql`
    with retried as (
      update privacy_retention_runs
      set status = 'queued', last_error = null, updated_at = ${retriedAt}
      where tenant_id = ${input.tenantId}::uuid
        and id = ${input.runId}::uuid
        and status = 'failed'
      returning *
    ), recorded_audit as (
      insert into audit_events (
        tenant_id, actor_membership_id, action, entity_type, entity_id, meta
      )
      select
        tenant_id,
        ${input.actorMembershipId}::uuid,
        'privacy.retention_retried',
        'privacy_retention_run',
        id::text,
        jsonb_build_object('cursor', cursor, 'attemptCount', attempt_count)
      from retried
      returning id
    )
    select retried.* from retried, recorded_audit
  `);
  return result.rows[0] ? normalizeRun(result.rows[0]) : null;
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
  const db = getDb();
  const query = retentionCountQuery({ ...input, classKey });
  const result = await db.execute<{
    eligible: number;
    held: number;
  }>(query);
  const row = result.rows[0] ?? { eligible: 0, held: 0 };
  return {
    eligible: Number(row.eligible),
    affected: 0,
    held: Number(row.held),
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
  const db = getDb();
  const lock = privacyTenantLock(db, input.tenantId);
  const operation = db.execute<{ affected: number }>(
    retentionMutationQuery({ ...input, classKey }),
  );
  const [, result] = await db.batch([lock, operation] as const);
  const affected = Number(result.rows[0]?.affected ?? 0);
  return {
    eligible: affected,
    affected,
    held: 0,
    hasMore: affected === input.limit,
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
  const status = input.completed ? "completed" : "queued";
  const result = await db.execute<PrivacyRetentionRun>(sql`
    with updated as (
      update privacy_retention_runs
      set
        status = ${status}::privacy_run_status,
        cursor = ${JSON.stringify(input.cursor)}::jsonb,
        report = ${JSON.stringify(input.report)}::jsonb,
        started_at = coalesce(started_at, ${now}),
        completed_at = case when ${input.completed} then ${now} else null end,
        attempt_count = attempt_count + 1,
        last_error = null,
        updated_at = ${now}
      where tenant_id = ${input.tenantId}::uuid
        and id = ${input.runId}::uuid
        and status in ('queued', 'running')
      returning *
    ), recorded_audit as (
      insert into audit_events (
        tenant_id, actor_membership_id, action, entity_type, entity_id, meta
      )
      select
        tenant_id,
        requested_by_membership_id,
        'privacy.retention_completed',
        'privacy_retention_run',
        id::text,
        jsonb_build_object(
          'mode', mode,
          'asOf', as_of,
          'attemptCount', attempt_count,
          'report', report
        )
      from updated
      where ${input.completed}
      returning id
    )
    select updated.*
    from updated
  `);
  return result.rows[0] ? normalizeRun(result.rows[0]) : null;
}

export async function failRetentionRun(input: {
  tenantId: string;
  runId: string;
  message: string;
}): Promise<void> {
  const db = getDb();
  await db.execute(sql`
    update privacy_retention_runs
    set
      status = 'failed',
      last_error = ${input.message.slice(0, 1_000)},
      attempt_count = attempt_count + 1,
      updated_at = now()
    where tenant_id = ${input.tenantId}::uuid
      and id = ${input.runId}::uuid
      and status in ('queued', 'running')
  `);
}

export async function createExternalRunTask(input: {
  tenantId: string;
  runId: string;
  provider: "vercel" | "backup" | "hoppie";
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
  const result = await db.execute<PrivacySubjectRequest>(sql`
    with valid_subject as (
      select 1
      where ${input.scope}::privacy_request_scope = 'tenant'
      union all
      select 1
      from memberships
      where tenant_id = ${input.tenantId}::uuid
        and id = ${input.subjectMembershipId ?? null}::uuid
        and ${input.scope}::privacy_request_scope = 'member'
    ), inserted as (
      insert into privacy_subject_requests (
        id,
        tenant_id,
        scope,
        subject_membership_id,
        subject_reference,
        kind,
        status,
        payload,
        created_by_membership_id
      )
      select
        ${id}::uuid,
        ${input.tenantId}::uuid,
        ${input.scope}::privacy_request_scope,
        ${input.subjectMembershipId ?? null}::uuid,
        ${subjectReference},
        ${input.kind}::privacy_request_kind,
        'pending_verification',
        ${JSON.stringify(input.payload)}::jsonb,
        ${input.actorMembershipId}::uuid
      from valid_subject
      limit 1
      returning *
    ), recorded_audit as (
      insert into audit_events (
        tenant_id, actor_membership_id, action, entity_type, entity_id, meta
      )
      select
        tenant_id,
        ${input.actorMembershipId}::uuid,
        'privacy.request_created',
        'privacy_subject_request',
        id::text,
        jsonb_build_object('scope', scope, 'kind', kind)
      from inserted
      returning id
    )
    select inserted.* from inserted, recorded_audit
  `);
  return result.rows[0] ? normalizeRequest(result.rows[0]) : null;
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
  const result = await db.execute<PrivacySubjectRequest>(sql`
    with verified as (
      update privacy_subject_requests
      set
        status = case
          when kind in ('anonymization', 'erasure')
            then 'pending_approval'::privacy_request_status
          else 'approved'::privacy_request_status
        end,
        verified_by_membership_id = ${input.actorMembershipId}::uuid,
        verified_at = ${now},
        updated_at = ${now}
      where tenant_id = ${input.tenantId}::uuid
        and id = ${input.requestId}::uuid
        and status = 'pending_verification'
      returning *
    ), recorded_audit as (
      insert into audit_events (
        tenant_id, actor_membership_id, action, entity_type, entity_id, meta
      )
      select
        tenant_id,
        ${input.actorMembershipId}::uuid,
        'privacy.request_verified',
        'privacy_subject_request',
        id::text,
        jsonb_build_object('scope', scope, 'kind', kind)
      from verified
      returning id
    )
    select verified.* from verified, recorded_audit
  `);
  return result.rows[0] ? normalizeRequest(result.rows[0]) : null;
}

export async function approvePrivacySubjectRequest(input: {
  tenantId: string;
  requestId: string;
  actorMembershipId: string;
}): Promise<PrivacySubjectRequest | null> {
  const db = getDb();
  const now = new Date();
  const result = await db.execute<PrivacySubjectRequest>(sql`
    with approved as (
      update privacy_subject_requests
      set
        status = 'approved',
        approved_by_membership_id = ${input.actorMembershipId}::uuid,
        approved_at = ${now},
        updated_at = ${now}
      where tenant_id = ${input.tenantId}::uuid
        and id = ${input.requestId}::uuid
        and status = 'pending_approval'
        and created_by_membership_id is distinct from ${input.actorMembershipId}::uuid
        and verified_by_membership_id is not null
      returning *
    ), recorded_audit as (
      insert into audit_events (
        tenant_id, actor_membership_id, action, entity_type, entity_id, meta
      )
      select
        tenant_id,
        ${input.actorMembershipId}::uuid,
        'privacy.request_approved',
        'privacy_subject_request',
        id::text,
        jsonb_build_object('scope', scope, 'kind', kind)
      from approved
      returning id
    )
    select approved.* from approved, recorded_audit
  `);
  return result.rows[0] ? normalizeRequest(result.rows[0]) : null;
}

export async function findBlockingLegalHold(input: {
  tenantId: string;
  membershipId?: string | null;
}): Promise<PrivacyLegalHold | null> {
  const db = getDb();
  const result = await db.execute<PrivacyLegalHold>(sql`
    select *
    from privacy_legal_holds
    where tenant_id = ${input.tenantId}::uuid
      and status in ('pending', 'active')
      and (expires_at is null or expires_at > now())
      and (
        subject_membership_id is null
        or subject_membership_id = ${input.membershipId ?? null}::uuid
      )
    order by created_at
    limit 1
  `);
  return result.rows[0] ? normalizeHold(result.rows[0]) : null;
}

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
  const lock = privacyTenantLock(db, input.tenantId);
  const operation = db.execute<PrivacyLegalHold>(sql`
    with inserted as (
      insert into privacy_legal_holds (
        id, tenant_id, subject_membership_id, scope, reason, expires_at,
        created_by_membership_id
      )
      select
        ${id}::uuid,
        actor.tenant_id,
        ${input.subjectMembershipId ?? null}::uuid,
        ${input.scope},
        ${input.reason},
        ${input.expiresAt ?? null},
        actor.id
      from memberships actor
      where actor.id = ${input.actorMembershipId}::uuid
        and actor.tenant_id = ${input.tenantId}::uuid
        and actor.role = 'admin'
        and actor.status = 'active'
        and (
          ${input.subjectMembershipId ?? null}::uuid is null
          or exists (
            select 1 from memberships subject
            where subject.id = ${input.subjectMembershipId ?? null}::uuid
              and subject.tenant_id = actor.tenant_id
          )
        )
      returning *
    ), recorded_audit as (
      insert into audit_events (
        tenant_id, actor_membership_id, action, entity_type, entity_id, meta
      )
      select
        tenant_id,
        ${input.actorMembershipId}::uuid,
        'privacy.legal_hold_created',
        'privacy_legal_hold',
        id::text,
        jsonb_build_object(
          'scope', scope,
          'subjectMembershipId', subject_membership_id,
          'expiresAt', expires_at
        )
      from inserted
      returning id
    )
    select inserted.* from inserted, recorded_audit
  `);
  const [, result] = await db.batch([lock, operation] as const);
  const hold = result.rows[0];
  return hold ? normalizeHold(hold) : null;
}

export async function approveLegalHold(input: {
  tenantId: string;
  holdId: string;
  actorMembershipId: string;
}): Promise<PrivacyLegalHold | null> {
  const db = getDb();
  const now = new Date();
  const lock = privacyTenantLock(db, input.tenantId);
  const operation = db.execute<PrivacyLegalHold>(sql`
    with approved as (
      update privacy_legal_holds
      set
        status = 'active',
        approved_by_membership_id = ${input.actorMembershipId}::uuid,
        approved_at = ${now},
        updated_at = ${now}
      where tenant_id = ${input.tenantId}::uuid
        and id = ${input.holdId}::uuid
        and status = 'pending'
        and created_by_membership_id is distinct from ${input.actorMembershipId}::uuid
      returning *
    ), recorded_audit as (
      insert into audit_events (
        tenant_id, actor_membership_id, action, entity_type, entity_id, meta
      )
      select
        tenant_id,
        ${input.actorMembershipId}::uuid,
        'privacy.legal_hold_approved',
        'privacy_legal_hold',
        id::text,
        jsonb_build_object(
          'scope', scope,
          'subjectMembershipId', subject_membership_id,
          'expiresAt', expires_at
        )
      from approved
      returning id
    )
    select approved.* from approved, recorded_audit
  `);
  const [, result] = await db.batch([lock, operation] as const);
  return result.rows[0] ? normalizeHold(result.rows[0]) : null;
}

export async function releaseLegalHold(input: {
  tenantId: string;
  holdId: string;
  actorMembershipId: string;
}): Promise<PrivacyLegalHold | null> {
  const db = getDb();
  const now = new Date();
  const lock = privacyTenantLock(db, input.tenantId);
  const operation = db.execute<PrivacyLegalHold>(sql`
    with released as (
      update privacy_legal_holds
      set
        status = 'released',
        released_by_membership_id = ${input.actorMembershipId}::uuid,
        released_at = ${now},
        updated_at = ${now}
      where tenant_id = ${input.tenantId}::uuid
        and id = ${input.holdId}::uuid
        and status = 'active'
      returning *
    ), recorded_audit as (
      insert into audit_events (
        tenant_id, actor_membership_id, action, entity_type, entity_id, meta
      )
      select
        tenant_id,
        ${input.actorMembershipId}::uuid,
        'privacy.legal_hold_released',
        'privacy_legal_hold',
        id::text,
        jsonb_build_object('scope', scope)
      from released
      returning id
    )
    select released.* from released, recorded_audit
  `);
  const [, result] = await db.batch([lock, operation] as const);
  return result.rows[0] ? normalizeHold(result.rows[0]) : null;
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
  const response = await db.execute<PrivacySubjectRequest>(sql`
    with completed as (
      update privacy_subject_requests
      set
        status = ${input.status}::privacy_request_status,
        result = ${JSON.stringify(input.result)}::jsonb,
        payload = case when ${input.scrubPayload ?? false} then '{}'::jsonb else payload end,
        processed_at = ${now},
        last_error = null,
        updated_at = ${now}
      where tenant_id = ${input.tenantId}::uuid
        and id = ${input.requestId}::uuid
        and status in ('approved', 'processing')
      returning *
    ), recorded_audit as (
      insert into audit_events (
        tenant_id, actor_membership_id, action, entity_type, entity_id, meta
      )
      select
        tenant_id,
        ${input.actorMembershipId}::uuid,
        'privacy.request_processed',
        'privacy_subject_request',
        id::text,
        jsonb_build_object('kind', kind, 'status', status, 'result', result)
      from completed
      returning id
    )
    select completed.* from completed, recorded_audit
  `);
  return response.rows[0] ? normalizeRequest(response.rows[0]) : null;
}

export async function markPrivacyRequestBlocked(input: {
  tenantId: string;
  requestId: string;
  actorMembershipId: string;
  reason: string;
}): Promise<PrivacySubjectRequest | null> {
  const db = getDb();
  const now = new Date();
  const result = await db.execute<PrivacySubjectRequest>(sql`
    with blocked as (
      update privacy_subject_requests
      set status = 'blocked', last_error = ${input.reason}, updated_at = ${now}
      where tenant_id = ${input.tenantId}::uuid
        and id = ${input.requestId}::uuid
        and status in ('approved', 'processing')
      returning *
    ), recorded_audit as (
      insert into audit_events (
        tenant_id, actor_membership_id, action, entity_type, entity_id, meta
      )
      select
        tenant_id,
        ${input.actorMembershipId}::uuid,
        'privacy.request_blocked',
        'privacy_subject_request',
        id::text,
        jsonb_build_object('kind', kind, 'reason', ${input.reason}::text)
      from blocked
      returning id
    )
    select blocked.* from blocked, recorded_audit
  `);
  return result.rows[0] ? normalizeRequest(result.rows[0]) : null;
}

export async function retryBlockedPrivacyRequest(input: {
  tenantId: string;
  requestId: string;
  actorMembershipId: string;
}): Promise<PrivacySubjectRequest | null> {
  const db = getDb();
  const now = new Date();
  const result = await db.execute<PrivacySubjectRequest>(sql`
    with retried as (
      update privacy_subject_requests request
      set status = 'approved', last_error = null, updated_at = ${now}
      from memberships actor
      where request.tenant_id = ${input.tenantId}::uuid
        and request.id = ${input.requestId}::uuid
        and request.status = 'blocked'
        and request.approved_by_membership_id is not null
        and actor.id = ${input.actorMembershipId}::uuid
        and actor.tenant_id = request.tenant_id
        and actor.role = 'admin'
        and actor.status = 'active'
      returning request.*
    ), recorded_audit as (
      insert into audit_events (
        tenant_id, actor_membership_id, action, entity_type, entity_id, meta
      )
      select
        tenant_id,
        ${input.actorMembershipId}::uuid,
        'privacy.request_retried',
        'privacy_subject_request',
        id::text,
        jsonb_build_object('kind', kind)
      from retried
      returning id
    )
    select retried.* from retried, recorded_audit
  `);
  return result.rows[0] ? normalizeRequest(result.rows[0]) : null;
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
  await db
    .insert(privacyExternalTasks)
    .values(
      input.tasks.map((task) => ({
        tenantId: input.tenantId,
        requestId: input.requestId,
        provider: task.provider,
        action: task.action,
        status: task.status ?? "pending",
        operatorNote: task.operatorNote,
        completedAt: task.status === "not_applicable" ? new Date() : undefined,
      })),
    )
    .onConflictDoNothing();
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
  const result = await db.execute<PrivacyExternalTask>(sql`
    with completed as (
      update privacy_external_tasks
      set
        status = ${input.status}::privacy_external_task_status,
        operator_note = ${input.operatorNote},
        completed_by_membership_id = ${input.actorMembershipId}::uuid,
        completed_at = ${now},
        updated_at = ${now}
      where tenant_id = ${input.tenantId}::uuid
        and id = ${input.taskId}::uuid
        and status in ('pending', 'failed')
      returning *
    ), finalized_request as (
      update privacy_subject_requests request
      set status = 'completed', updated_at = ${now}
      from completed
      where request.id = completed.request_id
        and request.tenant_id = completed.tenant_id
        and request.status = 'awaiting_external'
        and not exists (
          select 1
          from privacy_external_tasks remaining
          where remaining.request_id = request.id
            and remaining.id <> completed.id
            and remaining.status in ('pending', 'failed')
        )
        and completed.status in ('completed', 'not_applicable')
      returning request.id
    ), recorded_audit as (
      insert into audit_events (
        tenant_id, actor_membership_id, action, entity_type, entity_id, meta
      )
      select
        tenant_id,
        ${input.actorMembershipId}::uuid,
        'privacy.external_task_updated',
        'privacy_external_task',
        id::text,
        jsonb_build_object(
          'provider', provider,
          'action', action,
          'status', status,
          'requestFinalized', exists (select 1 from finalized_request)
        )
      from completed
      returning id
    )
    select completed.* from completed, recorded_audit
  `);
  return result.rows[0] ? normalizeExternalTask(result.rows[0]) : null;
}

export async function correctMembershipForPrivacy(input: {
  tenantId: string;
  membershipId: string;
  displayName?: string | null;
  pilotCallsign?: string | null;
}): Promise<boolean> {
  const db = getDb();
  const result = await db.execute<{ id: string }>(sql`
    update memberships
    set
      display_name = case
        when ${input.displayName !== undefined} then ${input.displayName ?? null}::text
        else display_name
      end,
      pilot_callsign = case
        when ${input.pilotCallsign !== undefined} then ${input.pilotCallsign ?? null}::text
        else pilot_callsign
      end,
      updated_at = now()
    where tenant_id = ${input.tenantId}::uuid
      and id = ${input.membershipId}::uuid
    returning id
  `);
  return result.rows.length === 1;
}

export type PrivacyDestructionResult = {
  request: PrivacySubjectRequest;
  localRecords: { flights: number; requests: number; messages: number };
};

export async function anonymizePrivacySubject(input: {
  tenantId: string;
  membershipId: string;
  requestId: string;
  actorMembershipId: string;
  finalStatus: "completed" | "awaiting_external";
  externalTasksRemaining: number;
}): Promise<PrivacyDestructionResult | null> {
  const db = getDb();
  const lock = privacyTenantLock(db, input.tenantId);
  const operation = db.execute<
    PrivacySubjectRequest & {
      localFlights: number;
      localRequests: number;
      localMessages: number;
    }
  >(sql`
    with subject as materialized (
      select member.id, request.id as request_id
      from memberships member
      join privacy_subject_requests request
        on request.tenant_id = member.tenant_id
       and request.subject_membership_id = member.id
       and request.id = ${input.requestId}::uuid
       and request.kind = 'anonymization'
       and request.status = 'approved'
       and request.approved_by_membership_id is not null
      join memberships actor
        on actor.id = ${input.actorMembershipId}::uuid
       and actor.tenant_id = member.tenant_id
       and actor.role = 'admin'
       and actor.status = 'active'
      where member.tenant_id = ${input.tenantId}::uuid
        and member.id = ${input.membershipId}::uuid
        and not exists (
          select 1 from privacy_legal_holds hold
          where hold.tenant_id = member.tenant_id
            and hold.status in ('pending', 'active')
            and (hold.expires_at is null or hold.expires_at > now())
            and (
              hold.subject_membership_id is null
              or hold.subject_membership_id = member.id
            )
        )
      for update of member, request
    ), open_work as materialized (
      select exists (
        select 1 from flights, subject
        where flights.tenant_id = ${input.tenantId}::uuid
          and flights.pilot_membership_id = subject.id
          and flights.status in ('draft', 'offered', 'accepted', 'briefed', 'active')
        union all
        select 1 from schedule_requests, subject
        where schedule_requests.tenant_id = ${input.tenantId}::uuid
          and schedule_requests.pilot_membership_id = subject.id
          and schedule_requests.status in ('pending', 'in_review', 'partially_fulfilled')
      ) as present
    ), target_flights as materialized (
      select f.id
      from flights f, subject, open_work
      where not open_work.present
        and f.tenant_id = ${input.tenantId}::uuid
        and f.pilot_membership_id = subject.id
    ), subject_privacy_requests as materialized (
      select request.id
      from privacy_subject_requests request, subject
      where request.tenant_id = ${input.tenantId}::uuid
        and request.subject_membership_id = subject.id
    ), subject_holds as materialized (
      select hold.id
      from privacy_legal_holds hold, subject
      where hold.tenant_id = ${input.tenantId}::uuid
        and hold.subject_membership_id = subject.id
    ), scrubbed_controls as (
      update privacy_subject_controls control
      set restriction_reason = null, updated_at = now()
      from subject
      where control.tenant_id = ${input.tenantId}::uuid
        and control.membership_id = subject.id
      returning control.id
    ), scrubbed_holds as (
      update privacy_legal_holds hold
      set reason = '[redacted by privacy workflow]', updated_at = now()
      from subject_holds
      where hold.id = subject_holds.id
      returning hold.id
    ), scrubbed_tasks as (
      update privacy_external_tasks task
      set
        status = case
          when task.request_id <> ${input.requestId}::uuid
            and task.status in ('pending', 'failed')
            then 'not_applicable'::privacy_external_task_status
          else task.status
        end,
        operator_note = null,
        completed_at = case
          when task.request_id <> ${input.requestId}::uuid
            and task.status in ('pending', 'failed')
            then now()
          else task.completed_at
        end,
        updated_at = now()
      where task.tenant_id = ${input.tenantId}::uuid
        and task.request_id in (select id from subject_privacy_requests)
      returning task.id
    ), scrubbed_privacy_requests as (
      update privacy_subject_requests privacy_request
      set
        status = case
          when status in ('pending_verification', 'pending_approval', 'approved', 'processing')
            then 'cancelled'::privacy_request_status
          else status
        end,
        payload = '{}',
        result = jsonb_build_object('subjectAnonymized', true),
        last_error = null,
        updated_at = now()
      where privacy_request.id in (select id from subject_privacy_requests)
        and privacy_request.id <> ${input.requestId}::uuid
      returning privacy_request.id
    ), redacted_requests as (
      update schedule_requests sr
      set title = null, notes = null, preferences = '{}', reject_reason = null, updated_at = now()
      from subject, open_work
      where not open_work.present
        and sr.tenant_id = ${input.tenantId}::uuid
        and sr.pilot_membership_id = subject.id
      returning sr.id
    ), redacted_flights as (
      update flights f
      set dispatcher_notes = null, cancel_reason = null, declined_reason = null, updated_at = now()
      from target_flights tf
      where f.id = tf.id
      returning f.id
    ), redacted_releases as (
      update dispatch_releases dr
      set release_notes = null, dispatcher_remarks = null
      where dr.tenant_id = ${input.tenantId}::uuid
        and (
          dr.released_by_membership_id = ${input.membershipId}::uuid
          or dr.flight_id in (select id from target_flights)
        )
      returning dr.id
    ), redacted_events as (
      update flight_operational_events event
      set actor_membership_id = null, meta = '{}'
      where event.tenant_id = ${input.tenantId}::uuid
        and (
          event.actor_membership_id = ${input.membershipId}::uuid
          or event.flight_id in (select id from target_flights)
        )
      returning event.id
    ), deleted_simbrief as (
      delete from simbrief_dispatches dispatch
      where dispatch.tenant_id = ${input.tenantId}::uuid
        and (
          dispatch.created_by_membership_id = ${input.membershipId}::uuid
          or dispatch.flight_id in (select id from target_flights)
        )
      returning dispatch.id
    ), redacted_messages as (
      update acars_messages message
      set
        body = '[redacted by privacy workflow]',
        hoppie_raw = null,
        provider_message_id = null,
        from_station = 'REDACTED',
        to_station = 'REDACTED',
        created_by_membership_id = null,
        updated_at = now()
      where message.tenant_id = ${input.tenantId}::uuid
        and (
          message.flight_id in (select id from target_flights)
          or message.created_by_membership_id = ${input.membershipId}::uuid
        )
      returning message.id
    ), redacted_audit as (
      update audit_events audit
      set actor_membership_id = null, meta = '{}'
      where audit.tenant_id = ${input.tenantId}::uuid
        and (
          audit.actor_membership_id = ${input.membershipId}::uuid
          or (audit.entity_type = 'membership' and audit.entity_id = ${input.membershipId})
          or (
            audit.entity_type = 'privacy_subject_request'
            and audit.entity_id in (select id::text from subject_privacy_requests)
          )
          or (
            audit.entity_type = 'privacy_legal_hold'
            and audit.entity_id in (select id::text from subject_holds)
          )
        )
      returning audit.id
    ), anonymized_member as (
      update memberships member
      set
        clerk_user_id = 'anon:' || gen_random_uuid()::text,
        role = 'pilot',
        display_name = null,
        pilot_callsign = null,
        simbrief_user_id = null,
        simbrief_verified_at = null,
        navigraph_subject = null,
        navigraph_username = null,
        navigraph_connected_at = null,
        status = 'disabled',
        updated_at = now()
      from subject, open_work
      where not open_work.present
        and member.id = subject.id
      returning member.id
    ), completed_request as (
      update privacy_subject_requests request
      set
        status = ${input.finalStatus}::privacy_request_status,
        payload = '{}',
        result = jsonb_build_object(
          'operation', 'anonymization',
          'localRecords', jsonb_build_object(
            'flights', (select count(*)::int from redacted_flights),
            'requests', (select count(*)::int from redacted_requests),
            'messages', (select count(*)::int from redacted_messages)
          ),
          'externalTasksRemaining', ${input.externalTasksRemaining}::int
        ),
        processed_at = now(),
        last_error = null,
        updated_at = now()
      from subject, anonymized_member
      where request.id = subject.request_id
      returning request.*
    ), recorded_audit as (
      insert into audit_events (
        tenant_id, actor_membership_id, action, entity_type, entity_id, meta
      )
      select
        tenant_id,
        ${input.actorMembershipId}::uuid,
        'privacy.request_processed',
        'privacy_subject_request',
        id::text,
        jsonb_build_object(
          'kind', kind,
          'status', status,
          'localRecords', result->'localRecords',
          'externalTasksRemaining', ${input.externalTasksRemaining}::int
        )
      from completed_request
      returning id
    )
    select
      completed_request.*,
      (select count(*)::int from redacted_flights) as local_flights,
      (select count(*)::int from redacted_requests) as local_requests,
      (select count(*)::int from redacted_messages) as local_messages
    from completed_request, recorded_audit
  `);
  const [, result] = await db.batch([lock, operation] as const);
  const row = result.rows[0];
  return row
    ? {
        request: normalizeRequest(row),
        localRecords: {
          flights: Number(camelRow(row).localFlights),
          requests: Number(camelRow(row).localRequests),
          messages: Number(camelRow(row).localMessages),
        },
      }
    : null;
}

export async function erasePrivacySubject(input: {
  tenantId: string;
  membershipId: string;
  requestId: string;
  actorMembershipId: string;
  finalStatus: "completed" | "awaiting_external";
  externalTasksRemaining: number;
}): Promise<PrivacyDestructionResult | null> {
  const db = getDb();
  const lock = privacyTenantLock(db, input.tenantId);
  const operation = db.execute<
    PrivacySubjectRequest & {
      localFlights: number;
      localRequests: number;
      localMessages: number;
    }
  >(sql`
    with subject as materialized (
      select member.id, request.id as request_id
      from memberships member
      join privacy_subject_requests request
        on request.tenant_id = member.tenant_id
       and request.subject_membership_id = member.id
       and request.id = ${input.requestId}::uuid
       and request.kind = 'erasure'
       and request.status = 'approved'
       and request.approved_by_membership_id is not null
      join memberships actor
        on actor.id = ${input.actorMembershipId}::uuid
       and actor.tenant_id = member.tenant_id
       and actor.role = 'admin'
       and actor.status = 'active'
      where member.tenant_id = ${input.tenantId}::uuid
        and member.id = ${input.membershipId}::uuid
        and not exists (
          select 1 from privacy_legal_holds hold
          where hold.tenant_id = member.tenant_id
            and hold.status in ('pending', 'active')
            and (hold.expires_at is null or hold.expires_at > now())
            and (
              hold.subject_membership_id is null
              or hold.subject_membership_id = member.id
            )
        )
      for update of member, request
    ), open_work as materialized (
      select exists (
        select 1 from flights, subject
        where flights.tenant_id = ${input.tenantId}::uuid
          and flights.pilot_membership_id = subject.id
          and flights.status in ('draft', 'offered', 'accepted', 'briefed', 'active')
        union all
        select 1 from schedule_requests, subject
        where schedule_requests.tenant_id = ${input.tenantId}::uuid
          and schedule_requests.pilot_membership_id = subject.id
          and schedule_requests.status in ('pending', 'in_review', 'partially_fulfilled')
      ) as present
    ), target_flights as materialized (
      select f.id
      from flights f, subject, open_work
      where not open_work.present
        and f.tenant_id = ${input.tenantId}::uuid
        and f.pilot_membership_id = subject.id
    ), subject_privacy_requests as materialized (
      select request.id
      from privacy_subject_requests request, subject
      where request.tenant_id = ${input.tenantId}::uuid
        and request.subject_membership_id = subject.id
    ), subject_holds as materialized (
      select hold.id
      from privacy_legal_holds hold, subject
      where hold.tenant_id = ${input.tenantId}::uuid
        and hold.subject_membership_id = subject.id
    ), scrubbed_holds as (
      update privacy_legal_holds hold
      set reason = '[redacted by privacy workflow]', updated_at = now()
      from subject_holds
      where hold.id = subject_holds.id
      returning hold.id
    ), scrubbed_tasks as (
      update privacy_external_tasks task
      set
        status = case
          when task.request_id <> ${input.requestId}::uuid
            and task.status in ('pending', 'failed')
            then 'not_applicable'::privacy_external_task_status
          else task.status
        end,
        operator_note = null,
        completed_at = case
          when task.request_id <> ${input.requestId}::uuid
            and task.status in ('pending', 'failed')
            then now()
          else task.completed_at
        end,
        updated_at = now()
      where task.tenant_id = ${input.tenantId}::uuid
        and task.request_id in (select id from subject_privacy_requests)
      returning task.id
    ), deleted_messages as (
      delete from acars_messages message
      where message.tenant_id = ${input.tenantId}::uuid
        and (
          message.flight_id in (select id from target_flights)
          or message.created_by_membership_id = ${input.membershipId}::uuid
        )
      returning message.id
    ), deleted_simbrief as (
      delete from simbrief_dispatches dispatch
      where dispatch.tenant_id = ${input.tenantId}::uuid
        and (
          dispatch.flight_id in (select id from target_flights)
          or dispatch.created_by_membership_id = ${input.membershipId}::uuid
        )
      returning dispatch.id
    ), redacted_releases as (
      update dispatch_releases release
      set release_notes = null, dispatcher_remarks = null
      where release.tenant_id = ${input.tenantId}::uuid
        and release.released_by_membership_id = ${input.membershipId}::uuid
        and release.flight_id not in (select id from target_flights)
      returning release.id
    ), redacted_events as (
      update flight_operational_events event
      set actor_membership_id = null, meta = '{}'
      where event.tenant_id = ${input.tenantId}::uuid
        and event.actor_membership_id = ${input.membershipId}::uuid
        and event.flight_id not in (select id from target_flights)
      returning event.id
    ), deleted_flights as (
      delete from flights flight
      using target_flights tf
      where flight.id = tf.id
      returning flight.id
    ), deleted_requests as (
      delete from schedule_requests request
      using subject, open_work
      where not open_work.present
        and request.tenant_id = ${input.tenantId}::uuid
        and request.pilot_membership_id = subject.id
      returning request.id
    ), deleted_subject_audit as (
      delete from audit_events audit
      using subject, open_work
      where not open_work.present
        and audit.tenant_id = ${input.tenantId}::uuid
        and (
          audit.actor_membership_id = subject.id
          or (audit.entity_type = 'membership' and audit.entity_id = subject.id::text)
          or (
            audit.entity_type = 'privacy_subject_request'
            and audit.entity_id in (select id::text from subject_privacy_requests)
          )
          or (
            audit.entity_type = 'privacy_legal_hold'
            and audit.entity_id in (select id::text from subject_holds)
          )
        )
      returning audit.id
    ), scrubbed_privacy_requests as (
      update privacy_subject_requests privacy_request
      set
        status = case
          when status in ('pending_verification', 'pending_approval', 'approved', 'processing')
            then 'cancelled'::privacy_request_status
          else status
        end,
        payload = '{}',
        result = jsonb_build_object('subjectErased', true),
        last_error = null,
        updated_at = now()
      where privacy_request.tenant_id = ${input.tenantId}::uuid
        and privacy_request.subject_membership_id = ${input.membershipId}::uuid
        and privacy_request.id <> ${input.requestId}::uuid
      returning privacy_request.id
    ), completed_request as (
      update privacy_subject_requests privacy_request
      set
        subject_membership_id = null,
        status = ${input.finalStatus}::privacy_request_status,
        payload = '{}',
        result = jsonb_build_object(
          'operation', 'erasure',
          'localRecords', jsonb_build_object(
            'flights', (select count(*)::int from deleted_flights),
            'requests', (select count(*)::int from deleted_requests),
            'messages', (select count(*)::int from deleted_messages)
          ),
          'externalTasksRemaining', ${input.externalTasksRemaining}::int
        ),
        processed_at = now(),
        last_error = null,
        updated_at = now()
      from subject, open_work
      where not open_work.present
        and privacy_request.id = subject.request_id
      returning privacy_request.*
    ), deleted_member as (
      delete from memberships member
      using subject, open_work, completed_request
      where not open_work.present
        and member.id = subject.id
      returning member.id
    ), recorded_audit as (
      insert into audit_events (
        tenant_id, actor_membership_id, action, entity_type, entity_id, meta
      )
      select
        completed_request.tenant_id,
        ${input.actorMembershipId}::uuid,
        'privacy.request_processed',
        'privacy_subject_request',
        completed_request.id::text,
        jsonb_build_object(
          'kind', completed_request.kind,
          'status', completed_request.status,
          'localRecords', completed_request.result->'localRecords',
          'externalTasksRemaining', ${input.externalTasksRemaining}::int
        )
      from completed_request, deleted_member
      returning id
    )
    select
      completed_request.*,
      (select count(*)::int from deleted_flights) as local_flights,
      (select count(*)::int from deleted_requests) as local_requests,
      (select count(*)::int from deleted_messages) as local_messages
    from completed_request, recorded_audit
  `);
  const [, result] = await db.batch([lock, operation] as const);
  const row = result.rows[0];
  return row
    ? {
        request: normalizeRequest(row),
        localRecords: {
          flights: Number(camelRow(row).localFlights),
          requests: Number(camelRow(row).localRequests),
          messages: Number(camelRow(row).localMessages),
        },
      }
    : null;
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
  const db = getDb();
  const query = privacyExportQuery(input);
  const result = await db.execute<PrivacyExportRecord>(query);
  return result.rows.map((row) => ({
    id: row.id,
    data:
      typeof row.data === "string"
        ? (JSON.parse(row.data) as Record<string, unknown>)
        : row.data,
  }));
}

function privacyExportQuery(input: {
  tenantId: string;
  scope: "member" | "tenant";
  membershipId?: string | null;
  store: PrivacyExportStore;
  afterId?: string;
  limit: number;
}) {
  const afterId = input.afterId ?? "00000000-0000-0000-0000-000000000000";
  const memberId = input.membershipId ?? null;
  const memberScope = input.scope === "member";
  switch (input.store) {
    case "tenant":
      return sql`
        select tenant.id::text as id,
          to_jsonb(tenant) - 'hoppie_logon_enc' as data
        from tenants tenant
        where tenant.id = ${input.tenantId}::uuid
          and tenant.id > ${afterId}::uuid
        order by tenant.id
        limit ${input.limit}
      `;
    case "memberships":
      return sql`
        select member.id::text as id, to_jsonb(member) as data
        from memberships member
        where member.tenant_id = ${input.tenantId}::uuid
          and (not ${memberScope} or member.id = ${memberId}::uuid)
          and member.id > ${afterId}::uuid
        order by member.id
        limit ${input.limit}
      `;
    case "privacyPolicies":
      return sql`
        select policy.id::text as id, to_jsonb(policy) as data
        from privacy_policies policy
        where policy.tenant_id = ${input.tenantId}::uuid
          and (
            not ${memberScope}
            or policy.created_by_membership_id = ${memberId}::uuid
            or policy.approved_by_membership_id = ${memberId}::uuid
          )
          and policy.id > ${afterId}::uuid
        order by policy.id
        limit ${input.limit}
      `;
    case "retentionRuns":
      return sql`
        select run.id::text as id, to_jsonb(run) as data
        from privacy_retention_runs run
        where run.tenant_id = ${input.tenantId}::uuid
          and (
            not ${memberScope}
            or run.requested_by_membership_id = ${memberId}::uuid
          )
          and run.id > ${afterId}::uuid
        order by run.id
        limit ${input.limit}
      `;
    case "subjectControls":
      return sql`
        select control.id::text as id, to_jsonb(control) as data
        from privacy_subject_controls control
        where control.tenant_id = ${input.tenantId}::uuid
          and (
            not ${memberScope}
            or control.membership_id = ${memberId}::uuid
            or control.updated_by_membership_id = ${memberId}::uuid
          )
          and control.id > ${afterId}::uuid
        order by control.id
        limit ${input.limit}
      `;
    case "scheduleRequests":
      return sql`
        select request.id::text as id, to_jsonb(request) as data
        from schedule_requests request
        where request.tenant_id = ${input.tenantId}::uuid
          and (not ${memberScope} or request.pilot_membership_id = ${memberId}::uuid)
          and request.id > ${afterId}::uuid
        order by request.id
        limit ${input.limit}
      `;
    case "flights":
      return sql`
        select flight.id::text as id, to_jsonb(flight) as data
        from flights flight
        where flight.tenant_id = ${input.tenantId}::uuid
          and (not ${memberScope} or flight.pilot_membership_id = ${memberId}::uuid)
          and flight.id > ${afterId}::uuid
        order by flight.id
        limit ${input.limit}
      `;
    case "dispatchReleases":
      return sql`
        select release.id::text as id, to_jsonb(release) as data
        from dispatch_releases release
        where release.tenant_id = ${input.tenantId}::uuid
          and (
            not ${memberScope}
            or release.released_by_membership_id = ${memberId}::uuid
            or exists (
              select 1 from flights flight
              where flight.id = release.flight_id
                and flight.tenant_id = release.tenant_id
                and flight.pilot_membership_id = ${memberId}::uuid
            )
          )
          and release.id > ${afterId}::uuid
        order by release.id
        limit ${input.limit}
      `;
    case "flightOperationalEvents":
      return sql`
        select event.id::text as id, to_jsonb(event) as data
        from flight_operational_events event
        where event.tenant_id = ${input.tenantId}::uuid
          and (
            not ${memberScope}
            or event.actor_membership_id = ${memberId}::uuid
            or exists (
              select 1 from flights flight
              where flight.id = event.flight_id
                and flight.tenant_id = event.tenant_id
                and flight.pilot_membership_id = ${memberId}::uuid
            )
          )
          and event.id > ${afterId}::uuid
        order by event.id
        limit ${input.limit}
      `;
    case "oauthTransactions":
      return sql`
        select transaction.id::text as id,
          (to_jsonb(transaction) - 'code_verifier_enc')
            || jsonb_build_object('encryptedCredentialOmitted', true) as data
        from navigraph_oauth_transactions transaction
        where transaction.tenant_id = ${input.tenantId}::uuid
          and (not ${memberScope} or transaction.membership_id = ${memberId}::uuid)
          and transaction.id > ${afterId}::uuid
        order by transaction.id
        limit ${input.limit}
      `;
    case "simbriefDispatches":
      return sql`
        select dispatch.id::text as id,
          to_jsonb(dispatch) - 'callback_token_mac' as data
        from simbrief_dispatches dispatch
        where dispatch.tenant_id = ${input.tenantId}::uuid
          and (
            not ${memberScope}
            or dispatch.created_by_membership_id = ${memberId}::uuid
            or exists (
              select 1 from flights flight
              where flight.id = dispatch.flight_id
                and flight.tenant_id = dispatch.tenant_id
                and flight.pilot_membership_id = ${memberId}::uuid
            )
          )
          and dispatch.id > ${afterId}::uuid
        order by dispatch.id
        limit ${input.limit}
      `;
    case "acarsMessages":
      return sql`
        select message.id::text as id, to_jsonb(message) as data
        from acars_messages message
        where message.tenant_id = ${input.tenantId}::uuid
          and (
            not ${memberScope}
            or message.created_by_membership_id = ${memberId}::uuid
            or exists (
              select 1 from flights flight
              where flight.id = message.flight_id
                and flight.tenant_id = message.tenant_id
                and flight.pilot_membership_id = ${memberId}::uuid
            )
          )
          and message.id > ${afterId}::uuid
        order by message.id
        limit ${input.limit}
      `;
    case "auditEvents":
      return sql`
        select audit.id::text as id, to_jsonb(audit) as data
        from audit_events audit
        where audit.tenant_id = ${input.tenantId}::uuid
          and (
            not ${memberScope}
            or audit.actor_membership_id = ${memberId}::uuid
            or (audit.entity_type = 'membership' and audit.entity_id = ${memberId}::text)
            or (
              audit.entity_type in ('flight', 'schedule_request')
              and audit.entity_id in (
                select flight.id::text from flights flight
                where flight.tenant_id = ${input.tenantId}::uuid
                  and flight.pilot_membership_id = ${memberId}::uuid
                union all
                select request.id::text from schedule_requests request
                where request.tenant_id = ${input.tenantId}::uuid
                  and request.pilot_membership_id = ${memberId}::uuid
              )
            )
          )
          and audit.id > ${afterId}::uuid
        order by audit.id
        limit ${input.limit}
      `;
    case "privacyRequests":
      return sql`
        select request.id::text as id,
          to_jsonb(request) - 'subject_reference' as data
        from privacy_subject_requests request
        where request.tenant_id = ${input.tenantId}::uuid
          and (
            not ${memberScope}
            or request.subject_membership_id = ${memberId}::uuid
            or request.created_by_membership_id = ${memberId}::uuid
            or request.verified_by_membership_id = ${memberId}::uuid
            or request.approved_by_membership_id = ${memberId}::uuid
          )
          and request.id > ${afterId}::uuid
        order by request.id
        limit ${input.limit}
      `;
    case "legalHolds":
      return sql`
        select hold.id::text as id, to_jsonb(hold) as data
        from privacy_legal_holds hold
        where hold.tenant_id = ${input.tenantId}::uuid
          and (
            not ${memberScope}
            or hold.subject_membership_id = ${memberId}::uuid
            or hold.created_by_membership_id = ${memberId}::uuid
            or hold.approved_by_membership_id = ${memberId}::uuid
            or hold.released_by_membership_id = ${memberId}::uuid
          )
          and hold.id > ${afterId}::uuid
        order by hold.id
        limit ${input.limit}
      `;
    case "externalTasks":
      return sql`
        select task.id::text as id, to_jsonb(task) as data
        from privacy_external_tasks task
        where task.tenant_id = ${input.tenantId}::uuid
          and (
            not ${memberScope}
            or exists (
              select 1 from privacy_subject_requests request
              where request.id = task.request_id
                and request.tenant_id = task.tenant_id
                and request.subject_membership_id = ${memberId}::uuid
            )
            or exists (
              select 1 from privacy_retention_runs run
              where run.id = task.run_id
                and run.tenant_id = task.tenant_id
                and run.requested_by_membership_id = ${memberId}::uuid
            )
            or task.completed_by_membership_id = ${memberId}::uuid
          )
          and task.id > ${afterId}::uuid
        order by task.id
        limit ${input.limit}
      `;
    case "mockAcarsQueue":
      return sql`
        select queue.id::text as id, to_jsonb(queue) as data
        from mock_acars_queue queue
        where queue.tenant_id = ${input.tenantId}::uuid
          and not ${memberScope}
          and queue.id > ${afterId}::uuid
        order by queue.id
        limit ${input.limit}
      `;
  }
}

function retentionCountQuery(input: {
  tenantId: string;
  classKey: Exclude<RetentionClassKey, "logs" | "backups">;
  cutoff: Date;
}) {
  const held = retentionProtectionPredicate(
    input.tenantId,
    sql.raw("subject_id"),
  );
  switch (input.classKey) {
    case "memberships":
      return sql`
        with candidates as (
          select m.id as subject_id
          from memberships m
          where m.tenant_id = ${input.tenantId}::uuid
            and m.status = 'disabled'
            and m.updated_at < ${input.cutoff}
            and m.clerk_user_id not like 'anon:%'
            and not exists (
              select 1 from flights f
              where f.tenant_id = m.tenant_id
                and f.pilot_membership_id = m.id
                and f.status in ('draft', 'offered', 'accepted', 'briefed', 'active')
            )
            and not exists (
              select 1 from schedule_requests sr
              where sr.tenant_id = m.tenant_id
                and sr.pilot_membership_id = m.id
                and sr.status in ('pending', 'in_review', 'partially_fulfilled')
            )
        )
        select
          count(*) filter (where not (${held}))::int as eligible,
          count(*) filter (where ${held})::int as held
        from candidates
      `;
    case "scheduleRequests":
      return sql`
        with candidates as (
          select sr.pilot_membership_id as subject_id
          from schedule_requests sr
          where sr.tenant_id = ${input.tenantId}::uuid
            and sr.status in ('fulfilled', 'rejected', 'cancelled')
            and sr.updated_at < ${input.cutoff}
        )
        select
          count(*) filter (where not (${held}))::int as eligible,
          count(*) filter (where ${held})::int as held
        from candidates
      `;
    case "flights":
      return sql`
        with candidates as (
          select f.pilot_membership_id as subject_id
          from flights f
          where f.tenant_id = ${input.tenantId}::uuid
            and f.status in ('declined', 'completed', 'cancelled')
            and f.updated_at < ${input.cutoff}
        )
        select
          count(*) filter (where not (${held}))::int as eligible,
          count(*) filter (where ${held})::int as held
        from candidates
      `;
    case "simbrief":
      return sql`
        with candidates as (
          select coalesce(sd.created_by_membership_id, f.pilot_membership_id) as subject_id
          from simbrief_dispatches sd
          join flights f on f.id = sd.flight_id and f.tenant_id = sd.tenant_id
          where sd.tenant_id = ${input.tenantId}::uuid
            and sd.created_at < ${input.cutoff}
        )
        select
          count(*) filter (where not (${held}))::int as eligible,
          count(*) filter (where ${held})::int as held
        from candidates
      `;
    case "acars":
      return sql`
        with candidates as (
          select coalesce(am.created_by_membership_id, f.pilot_membership_id) as subject_id
          from acars_messages am
          left join flights f on f.id = am.flight_id and f.tenant_id = am.tenant_id
          where am.tenant_id = ${input.tenantId}::uuid
            and am.created_at < ${input.cutoff}
          union all
          select null::uuid as subject_id
          from mock_acars_queue mq
          where mq.tenant_id = ${input.tenantId}::uuid
            and mq.created_at < ${input.cutoff}
        )
        select
          count(*) filter (where not (${held}))::int as eligible,
          count(*) filter (where ${held})::int as held
        from candidates
      `;
    case "oauth":
      return sql`
        with candidates as (
          select transaction.membership_id as subject_id
          from navigraph_oauth_transactions transaction
          where transaction.tenant_id = ${input.tenantId}::uuid
            and transaction.created_at < ${input.cutoff}
            and transaction.expires_at < now()
        )
        select
          count(*) filter (where not (${held}))::int as eligible,
          count(*) filter (where ${held})::int as held
        from candidates
      `;
    case "audit":
      return sql`
        with candidates as (
          select audit.actor_membership_id as subject_id
          from audit_events audit
          where audit.tenant_id = ${input.tenantId}::uuid
            and audit.created_at < ${input.cutoff}
        )
        select
          count(*) filter (where not (${held}))::int as eligible,
          count(*) filter (where ${held})::int as held
        from candidates
      `;
  }
}

function retentionMutationQuery(input: {
  tenantId: string;
  classKey: Exclude<RetentionClassKey, "logs" | "backups">;
  cutoff: Date;
  limit: number;
}) {
  const noHold = sql`not (${retentionProtectionPredicate(input.tenantId, sql.raw("subject_id"))})`;
  switch (input.classKey) {
    case "memberships":
      return sql`
        with candidates as materialized (
          select m.id, m.id as subject_id
          from memberships m
          where m.tenant_id = ${input.tenantId}::uuid
            and m.status = 'disabled'
            and m.updated_at < ${input.cutoff}
            and m.clerk_user_id not like 'anon:%'
            and not exists (
              select 1 from flights f
              where f.tenant_id = m.tenant_id
                and f.pilot_membership_id = m.id
                and f.status in ('draft', 'offered', 'accepted', 'briefed', 'active')
            )
            and not exists (
              select 1 from schedule_requests sr
              where sr.tenant_id = m.tenant_id
                and sr.pilot_membership_id = m.id
                and sr.status in ('pending', 'in_review', 'partially_fulfilled')
            )
          order by m.updated_at, m.id
        ), eligible as (
          select id from candidates where ${noHold} limit ${input.limit}
        ), affected as (
          update memberships member
          set
            clerk_user_id = 'anon:' || gen_random_uuid()::text,
            role = 'pilot',
            display_name = null,
            pilot_callsign = null,
            simbrief_user_id = null,
            simbrief_verified_at = null,
            navigraph_subject = null,
            navigraph_username = null,
            navigraph_connected_at = null,
            updated_at = now()
          from eligible
          where member.id = eligible.id
          returning member.id
        )
        select count(*)::int as affected from affected
      `;
    case "scheduleRequests":
      return sql`
        with candidates as materialized (
          select sr.id, sr.pilot_membership_id as subject_id
          from schedule_requests sr
          where sr.tenant_id = ${input.tenantId}::uuid
            and sr.status in ('fulfilled', 'rejected', 'cancelled')
            and sr.updated_at < ${input.cutoff}
          order by sr.updated_at, sr.id
        ), eligible as (
          select id from candidates where ${noHold} limit ${input.limit}
        ), affected as (
          delete from schedule_requests request
          using eligible
          where request.id = eligible.id
          returning request.id
        )
        select count(*)::int as affected from affected
      `;
    case "flights":
      return sql`
        with candidates as materialized (
          select f.id, f.pilot_membership_id as subject_id
          from flights f
          where f.tenant_id = ${input.tenantId}::uuid
            and f.status in ('declined', 'completed', 'cancelled')
            and f.updated_at < ${input.cutoff}
          order by f.updated_at, f.id
        ), eligible as (
          select id from candidates where ${noHold} limit ${input.limit}
        ), affected as (
          delete from flights flight
          using eligible
          where flight.id = eligible.id
          returning flight.id
        )
        select count(*)::int as affected from affected
      `;
    case "simbrief":
      return sql`
        with candidates as materialized (
          select sd.id, coalesce(sd.created_by_membership_id, f.pilot_membership_id) as subject_id
          from simbrief_dispatches sd
          join flights f on f.id = sd.flight_id and f.tenant_id = sd.tenant_id
          where sd.tenant_id = ${input.tenantId}::uuid
            and sd.created_at < ${input.cutoff}
          order by sd.created_at, sd.id
        ), eligible as (
          select id from candidates where ${noHold} limit ${input.limit}
        ), affected as (
          delete from simbrief_dispatches dispatch
          using eligible
          where dispatch.id = eligible.id
          returning dispatch.id
        )
        select count(*)::int as affected from affected
      `;
    case "acars":
      return sql`
        with candidates as materialized (
          select 'message'::text as store, am.id, coalesce(am.created_by_membership_id, f.pilot_membership_id) as subject_id, am.created_at
          from acars_messages am
          left join flights f on f.id = am.flight_id and f.tenant_id = am.tenant_id
          where am.tenant_id = ${input.tenantId}::uuid
            and am.created_at < ${input.cutoff}
          union all
          select 'mock_queue', mq.id, null::uuid as subject_id, mq.created_at
          from mock_acars_queue mq
          where mq.tenant_id = ${input.tenantId}::uuid
            and mq.created_at < ${input.cutoff}
        ), eligible as (
          select store, id
          from candidates
          where ${noHold}
          order by created_at, id
          limit ${input.limit}
        ), deleted_messages as (
          delete from acars_messages message
          using eligible
          where eligible.store = 'message' and message.id = eligible.id
          returning message.id
        ), deleted_queue as (
          delete from mock_acars_queue queue
          using eligible
          where eligible.store = 'mock_queue' and queue.id = eligible.id
          returning queue.id
        )
        select (
          (select count(*) from deleted_messages)
          + (select count(*) from deleted_queue)
        )::int as affected
      `;
    case "oauth":
      return sql`
        with candidates as materialized (
          select transaction.id, transaction.membership_id as subject_id
          from navigraph_oauth_transactions transaction
          where transaction.tenant_id = ${input.tenantId}::uuid
            and transaction.created_at < ${input.cutoff}
            and transaction.expires_at < now()
          order by transaction.created_at, transaction.id
        ), eligible as (
          select id from candidates where ${noHold} limit ${input.limit}
        ), affected as (
          delete from navigraph_oauth_transactions transaction
          using eligible
          where transaction.id = eligible.id
          returning transaction.id
        )
        select count(*)::int as affected from affected
      `;
    case "audit":
      return sql`
        with candidates as materialized (
          select audit.id, audit.actor_membership_id as subject_id
          from audit_events audit
          where audit.tenant_id = ${input.tenantId}::uuid
            and audit.created_at < ${input.cutoff}
          order by audit.created_at, audit.id
        ), eligible as (
          select id from candidates where ${noHold} limit ${input.limit}
        ), affected as (
          delete from audit_events audit
          using eligible
          where audit.id = eligible.id
          returning audit.id
        )
        select count(*)::int as affected from affected
      `;
  }
}

function retentionProtectionPredicate(
  tenantId: string,
  subjectIdExpression: ReturnType<typeof sql.raw>,
) {
  return sql`(
    exists (
      select 1
      from privacy_legal_holds hold
      where hold.tenant_id = ${tenantId}::uuid
        and hold.status in ('pending', 'active')
        and (hold.expires_at is null or hold.expires_at > now())
        and (
          hold.subject_membership_id is null
          or hold.subject_membership_id = ${subjectIdExpression}
        )
    )
    or (
      ${subjectIdExpression} is not null
      and exists (
        select 1
        from privacy_subject_controls control
        where control.tenant_id = ${tenantId}::uuid
          and control.membership_id = ${subjectIdExpression}
          and control.restricted_at is not null
      )
    )
  )`;
}

function privacyTenantLock(db: ReturnType<typeof getDb>, tenantId: string) {
  return db.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${tenantId}, 270027::bigint))`,
  );
}

function normalizePolicy(row: PrivacyPolicy): PrivacyPolicy {
  const value = camelRow(row) as unknown as PrivacyPolicy;
  return {
    ...value,
    approvedAt: value.approvedAt ? new Date(value.approvedAt) : null,
    effectiveAt: value.effectiveAt ? new Date(value.effectiveAt) : null,
    createdAt: new Date(value.createdAt),
    updatedAt: new Date(value.updatedAt),
  };
}

function normalizeRun(row: PrivacyRetentionRun): PrivacyRetentionRun {
  const value = camelRow(row) as unknown as PrivacyRetentionRun;
  return {
    ...value,
    asOf: new Date(value.asOf),
    startedAt: value.startedAt ? new Date(value.startedAt) : null,
    completedAt: value.completedAt ? new Date(value.completedAt) : null,
    createdAt: new Date(value.createdAt),
    updatedAt: new Date(value.updatedAt),
  };
}

function normalizeRequest(row: PrivacySubjectRequest): PrivacySubjectRequest {
  const value = camelRow(row) as unknown as PrivacySubjectRequest;
  return {
    ...value,
    verifiedAt: value.verifiedAt ? new Date(value.verifiedAt) : null,
    approvedAt: value.approvedAt ? new Date(value.approvedAt) : null,
    processedAt: value.processedAt ? new Date(value.processedAt) : null,
    createdAt: new Date(value.createdAt),
    updatedAt: new Date(value.updatedAt),
  };
}

function normalizeHold(row: PrivacyLegalHold): PrivacyLegalHold {
  const value = camelRow(row) as unknown as PrivacyLegalHold;
  return {
    ...value,
    expiresAt: value.expiresAt ? new Date(value.expiresAt) : null,
    approvedAt: value.approvedAt ? new Date(value.approvedAt) : null,
    releasedAt: value.releasedAt ? new Date(value.releasedAt) : null,
    createdAt: new Date(value.createdAt),
    updatedAt: new Date(value.updatedAt),
  };
}

function normalizeExternalTask(row: PrivacyExternalTask): PrivacyExternalTask {
  const value = camelRow(row) as unknown as PrivacyExternalTask;
  return {
    ...value,
    completedAt: value.completedAt ? new Date(value.completedAt) : null,
    createdAt: new Date(value.createdAt),
    updatedAt: new Date(value.updatedAt),
  };
}

function camelRow(value: object): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key.replace(/_([a-z])/g, (_match, character: string) =>
        character.toUpperCase(),
      ),
      entry,
    ]),
  );
}
