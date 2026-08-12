import { z } from "zod";
import { writeAudit } from "../../db/repositories/audit.js";
import { findMembershipById } from "../../db/repositories/memberships.js";
import * as privacyRepo from "../../db/repositories/privacy.js";
import type {
  PrivacyExternalTask,
  PrivacyLegalHold,
  PrivacyPolicy,
  PrivacyRetentionRun,
  PrivacySubjectRequest,
} from "../../db/schema.js";
import { env } from "../../env.js";
import { decryptOpaqueToken, encryptOpaqueToken } from "../../lib/crypto.js";
import { AppError } from "../../lib/errors.js";
import { redactAuditMeta } from "../audit/service.js";
import {
  cutoffFor,
  emptyRetentionReport,
  objectionScopeSchema,
  privacyCorrectionSchema,
  privacyObjectionSchema,
  privacyRestrictionSchema,
  RETENTION_CLASS_KEYS,
  retentionPolicyConfigSchema,
  retentionReportSchema,
  type ObjectionScope,
  type RetentionPolicyConfig,
  type RetentionReport,
} from "./policy.js";

const RETENTION_EXECUTION_CONFIRMATION = "EXECUTE APPROVED RETENTION";
const SUBJECT_DESTRUCTION_CONFIRMATION = "ERASE VERIFIED SUBJECT DATA";
const exportCursorSchema = z
  .object({
    requestId: z.string().uuid(),
    storeIndex: z.number().int().min(0),
    afterId: z.string().uuid().optional(),
  })
  .strict();

export const privacyRequestPayloadSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("export"),
      scope: z.enum(["member", "tenant"]),
      subjectMembershipId: z.string().uuid().nullable().optional(),
      payload: z.object({}).strict().default({}),
    })
    .strict(),
  z
    .object({
      kind: z.literal("correction"),
      scope: z.literal("member"),
      subjectMembershipId: z.string().uuid(),
      payload: privacyCorrectionSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("restriction"),
      scope: z.literal("member"),
      subjectMembershipId: z.string().uuid(),
      payload: privacyRestrictionSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("objection"),
      scope: z.literal("member"),
      subjectMembershipId: z.string().uuid(),
      payload: privacyObjectionSchema,
    })
    .strict(),
  z
    .object({
      kind: z.enum(["anonymization", "erasure"]),
      scope: z.literal("member"),
      subjectMembershipId: z.string().uuid(),
      payload: z
        .object({ reason: z.string().trim().min(1).max(1_000) })
        .strict(),
    })
    .strict(),
]);

export async function createPolicy(input: {
  tenantId: string;
  actorMembershipId: string;
  config: unknown;
}): Promise<PrivacyPolicy> {
  const config = retentionPolicyConfigSchema.parse(input.config);
  return privacyRepo.createPrivacyPolicy({ ...input, config });
}

export async function getActivePolicy(
  tenantId: string,
): Promise<PrivacyPolicy | null> {
  return privacyRepo.findActivePrivacyPolicy(tenantId);
}

export async function approvePolicy(input: {
  tenantId: string;
  actorMembershipId: string;
  policyId: string;
}): Promise<PrivacyPolicy> {
  const existing = await privacyRepo.findPrivacyPolicy(
    input.tenantId,
    input.policyId,
  );
  if (!existing) throw new AppError("NOT_FOUND", "Privacy policy not found");
  if (existing.createdByMembershipId === input.actorMembershipId) {
    throw new AppError(
      "CONFLICT",
      "A different active administrator must approve this retention policy",
    );
  }
  const activated = await privacyRepo.approvePrivacyPolicy(input);
  if (!activated) {
    throw new AppError(
      "CONFLICT",
      "The policy is no longer an approvable draft",
    );
  }
  return activated;
}

export async function queueRetentionRun(input: {
  tenantId: string;
  actorMembershipId: string;
  mode: "dry_run" | "execute";
  idempotencyKey: string;
  dryRunId?: string;
  confirmation?: string;
  now?: Date;
}): Promise<PrivacyRetentionRun> {
  const policy = await privacyRepo.findActivePrivacyPolicy(input.tenantId);
  if (!policy) {
    throw new AppError(
      "CONFLICT",
      "A dual-approved active retention policy is required",
    );
  }
  const config = retentionPolicyConfigSchema.parse(policy.config);
  let asOf = input.now ?? new Date();
  let report = emptyRetentionReport(asOf);
  let dryRunId: string | undefined;
  if (input.mode === "execute") {
    if (input.confirmation !== RETENTION_EXECUTION_CONFIRMATION) {
      throw new AppError(
        "BAD_REQUEST",
        `Set confirmation to ${RETENTION_EXECUTION_CONFIRMATION}`,
      );
    }
    if (!input.dryRunId) {
      throw new AppError(
        "BAD_REQUEST",
        "A completed dry-run report is required before execution",
      );
    }
    const dryRun = await privacyRepo.findCompletedDryRun(
      input.tenantId,
      input.dryRunId,
    );
    if (!dryRun || dryRun.policyId !== policy.id) {
      throw new AppError(
        "CONFLICT",
        "The dry run does not belong to the active policy",
      );
    }
    asOf = dryRun.asOf;
    report = retentionReportSchema.parse(dryRun.report);
    report = {
      ...report,
      classes: Object.fromEntries(
        Object.entries(report.classes).map(([key, value]) => [
          key,
          { ...value, affected: 0 },
        ]),
      ),
    };
    dryRunId = dryRun.id;
  }
  const result = await privacyRepo.createRetentionRun({
    tenantId: input.tenantId,
    policyId: policy.id,
    mode: input.mode,
    asOf,
    dryRunId,
    idempotencyKey: input.idempotencyKey,
    actorMembershipId: input.actorMembershipId,
    report,
  });
  assertIdempotentRunMatches(result.run, {
    policyId: policy.id,
    mode: input.mode,
    dryRunId,
  });
  return result.run;
}

export async function retryRun(input: {
  tenantId: string;
  actorMembershipId: string;
  runId: string;
}): Promise<PrivacyRetentionRun> {
  const run = await privacyRepo.retryRetentionRun(input);
  if (!run) {
    throw new AppError(
      "CONFLICT",
      "Only a failed retention run can be retried",
    );
  }
  return run;
}

export async function getRetentionRun(
  tenantId: string,
  runId: string,
): Promise<{
  run: PrivacyRetentionRun;
  externalTasks: PrivacyExternalTask[];
}> {
  const run = await privacyRepo.findRetentionRun(tenantId, runId);
  if (!run) throw new AppError("NOT_FOUND", "Retention run not found");
  return {
    run,
    externalTasks: await privacyRepo.listExternalRunTasks(tenantId, runId),
  };
}

export async function processRetentionRun(
  tenantId: string,
  runId: string,
): Promise<PrivacyRetentionRun | null> {
  const claimed = await privacyRepo.claimRetentionRun({ tenantId, runId });
  if (!claimed) return null;
  try {
    const policy = await privacyRepo.findPrivacyPolicy(
      claimed.tenantId,
      claimed.policyId,
    );
    if (!policy || policy.status !== "active") {
      throw new AppError("CONFLICT", "Retention policy is no longer active");
    }
    const config = retentionPolicyConfigSchema.parse(policy.config);
    const report = retentionReportSchema.parse(claimed.report);
    const cursor = z
      .object({ classIndex: z.number().int().min(0).default(0) })
      .parse(claimed.cursor);
    const classKey = RETENTION_CLASS_KEYS[cursor.classIndex];
    if (!classKey) {
      return privacyRepo.updateRetentionRunProgress({
        tenantId: claimed.tenantId,
        runId: claimed.id,
        cursor,
        report,
        completed: true,
      });
    }

    const cutoff = cutoffFor(
      claimed.asOf,
      config.classes[classKey].retentionDays,
    );
    let nextIndex = cursor.classIndex + 1;
    if (claimed.mode === "dry_run") {
      const inspected = await privacyRepo.inspectRetentionClass({
        tenantId: claimed.tenantId,
        classKey,
        cutoff,
      });
      report.classes[classKey] = {
        eligible: inspected.eligible,
        affected: 0,
        held: inspected.held,
        externalActionRequired: classKey === "logs" || classKey === "backups",
      };
    } else if (classKey === "logs" || classKey === "backups") {
      await privacyRepo.createExternalRunTask({
        tenantId: claimed.tenantId,
        runId: claimed.id,
        provider: classKey === "logs" ? "vercel" : "backup",
        action:
          classKey === "logs"
            ? `verify_log_expiry_${config.classes.logs.retentionDays}_days`
            : `verify_backup_expiry_${config.classes.backups.retentionDays}_days`,
      });
      report.classes[classKey]!.externalActionRequired = true;
    } else {
      const result = await privacyRepo.executeRetentionClass({
        tenantId: claimed.tenantId,
        classKey,
        cutoff,
        limit: config.batchSize,
      });
      const remaining = await privacyRepo.inspectRetentionClass({
        tenantId: claimed.tenantId,
        classKey,
        cutoff,
      });
      const dryEligible = report.classes[classKey]?.eligible ?? 0;
      report.classes[classKey] = {
        eligible: dryEligible,
        affected: Math.max(0, dryEligible - remaining.eligible),
        held: Math.max(report.classes[classKey]?.held ?? 0, remaining.held),
        externalActionRequired: classKey === "acars",
      };
      if (classKey === "acars") {
        await privacyRepo.createExternalRunTask({
          tenantId: claimed.tenantId,
          runId: claimed.id,
          provider: "hoppie",
          action: "verify_provider_queue_expiry_no_deletion_api",
        });
      }
      if (result.hasMore || remaining.eligible > 0) {
        nextIndex = cursor.classIndex;
      }
    }
    const completed = nextIndex >= RETENTION_CLASS_KEYS.length;
    return privacyRepo.updateRetentionRunProgress({
      tenantId: claimed.tenantId,
      runId: claimed.id,
      cursor: { classIndex: nextIndex },
      report,
      completed,
    });
  } catch (error) {
    await privacyRepo.failRetentionRun({
      tenantId: claimed.tenantId,
      runId: claimed.id,
      message: sanitizedRetentionFailure(error),
    });
    throw error;
  }
}

export async function runPrivacyLifecycleCron(input?: {
  now?: Date;
  maxRuns?: number;
}): Promise<{
  scheduled: number;
  processed: number;
  completed: number;
  failed: number;
}> {
  const now = input?.now ?? new Date();
  const policies = await privacyRepo.listActivePrivacyPolicies();
  let scheduled = 0;
  for (const policy of policies) {
    const config = retentionPolicyConfigSchema.parse(policy.config);
    const since = new Date(now.getTime() - config.intervalHours * 3_600_000);
    const alreadyScheduled = await privacyRepo.retentionRunExistsSince({
      tenantId: policy.tenantId,
      policyId: policy.id,
      since,
    });
    if (!alreadyScheduled) {
      const period = Math.floor(
        now.getTime() / (config.intervalHours * 3_600_000),
      );
      const result = await privacyRepo.createRetentionRun({
        tenantId: policy.tenantId,
        policyId: policy.id,
        mode: "dry_run",
        asOf: now,
        idempotencyKey: `scheduled-dry:${policy.id}:${period}`,
        actorMembershipId: null,
        report: emptyRetentionReport(now),
      });
      if (result.created) scheduled += 1;
    }

    if (config.automaticExecution) {
      const dryRun = await privacyRepo.findLatestPolicyDryRun(
        policy.tenantId,
        policy.id,
      );
      const oldEnough =
        dryRun?.completedAt &&
        dryRun.completedAt.getTime() <=
          now.getTime() - config.minimumDryRunAgeHours * 3_600_000;
      if (dryRun && oldEnough) {
        const report = retentionReportSchema.parse(dryRun.report);
        const result = await privacyRepo.createRetentionRun({
          tenantId: policy.tenantId,
          policyId: policy.id,
          mode: "execute",
          asOf: dryRun.asOf,
          dryRunId: dryRun.id,
          idempotencyKey: `scheduled-execute:${dryRun.id}`,
          actorMembershipId: null,
          report: {
            ...report,
            classes: Object.fromEntries(
              Object.entries(report.classes).map(([key, value]) => [
                key,
                { ...value, affected: 0 },
              ]),
            ),
          },
        });
        if (result.created) scheduled += 1;
      }
    }
  }

  const runs = await privacyRepo.listRunnableRetentionRuns(
    Math.min(input?.maxRuns ?? 10, 25),
  );
  let processed = 0;
  let completed = 0;
  let failed = 0;
  for (const run of runs) {
    try {
      const result = await processRetentionRun(run.tenantId, run.id);
      if (result) {
        processed += 1;
        if (result.status === "completed") completed += 1;
      }
    } catch {
      failed += 1;
    }
  }
  return { scheduled, processed, completed, failed };
}

export async function createSubjectRequest(input: {
  tenantId: string;
  actorMembershipId: string;
  request: z.infer<typeof privacyRequestPayloadSchema>;
}): Promise<PrivacySubjectRequest> {
  if (input.request.scope === "member" && !input.request.subjectMembershipId) {
    throw new AppError(
      "BAD_REQUEST",
      "Member privacy requests require a subject membership",
    );
  }
  if (input.request.scope === "tenant" && input.request.kind !== "export") {
    throw new AppError(
      "BAD_REQUEST",
      "Only verified exports may use tenant scope",
    );
  }
  const created = await privacyRepo.createPrivacySubjectRequest({
    tenantId: input.tenantId,
    actorMembershipId: input.actorMembershipId,
    scope: input.request.scope,
    subjectMembershipId: input.request.subjectMembershipId,
    kind: input.request.kind,
    payload: input.request.payload,
  });
  if (!created) {
    throw new AppError("NOT_FOUND", "Privacy request subject not found");
  }
  return created;
}

export async function verifySubjectRequest(input: {
  tenantId: string;
  actorMembershipId: string;
  requestId: string;
}): Promise<PrivacySubjectRequest> {
  const verified = await privacyRepo.verifyPrivacySubjectRequest(input);
  if (!verified) {
    throw new AppError(
      "CONFLICT",
      "Only an unverified privacy request can be verified",
    );
  }
  if (verified.kind === "export") {
    await ensureExportExternalTasks(verified);
  }
  return verified;
}

export async function getSubjectRequest(
  tenantId: string,
  requestId: string,
): Promise<{
  request: PrivacySubjectRequest;
  externalTasks: PrivacyExternalTask[];
}> {
  const request = await privacyRepo.findPrivacySubjectRequest(
    tenantId,
    requestId,
  );
  if (!request) throw new AppError("NOT_FOUND", "Privacy request not found");
  return {
    request,
    externalTasks: await privacyRepo.listExternalRequestTasks(
      tenantId,
      requestId,
    ),
  };
}

export async function approveSubjectRequest(input: {
  tenantId: string;
  actorMembershipId: string;
  requestId: string;
}): Promise<PrivacySubjectRequest> {
  const request = await privacyRepo.findPrivacySubjectRequest(
    input.tenantId,
    input.requestId,
  );
  if (!request) throw new AppError("NOT_FOUND", "Privacy request not found");
  if (request.createdByMembershipId === input.actorMembershipId) {
    throw new AppError(
      "CONFLICT",
      "A different administrator must approve destructive processing",
    );
  }
  const approved = await privacyRepo.approvePrivacySubjectRequest(input);
  if (!approved) {
    throw new AppError(
      "CONFLICT",
      "Only a verified destructive request can be approved",
    );
  }
  await ensureDestructiveExternalTasks(approved);
  return approved;
}

export async function retrySubjectRequest(input: {
  tenantId: string;
  actorMembershipId: string;
  requestId: string;
}): Promise<PrivacySubjectRequest> {
  const request = await privacyRepo.findPrivacySubjectRequest(
    input.tenantId,
    input.requestId,
  );
  if (!request) throw new AppError("NOT_FOUND", "Privacy request not found");
  if (request.status !== "blocked" || !request.subjectMembershipId) {
    throw new AppError("CONFLICT", "Privacy request is not retryable");
  }
  const hold = await privacyRepo.findBlockingLegalHold({
    tenantId: input.tenantId,
    membershipId: request.subjectMembershipId,
  });
  if (hold) {
    throw new AppError(
      "CONFLICT",
      "Release or expire the blocking legal hold before retrying",
      { details: { legalHoldId: hold.id } },
    );
  }
  const retried = await privacyRepo.retryBlockedPrivacyRequest(input);
  if (!retried) {
    throw new AppError("CONFLICT", "Privacy request changed concurrently");
  }
  return retried;
}

export async function processSubjectRequest(input: {
  tenantId: string;
  actorMembershipId: string;
  requestId: string;
  confirmation?: string;
}): Promise<{
  request: PrivacySubjectRequest;
  externalTasks: PrivacyExternalTask[];
}> {
  const request = await privacyRepo.findPrivacySubjectRequest(
    input.tenantId,
    input.requestId,
  );
  if (!request) throw new AppError("NOT_FOUND", "Privacy request not found");
  if (request.status !== "approved") {
    throw new AppError("CONFLICT", "Privacy request is not approved");
  }
  if (request.scope !== "member" || !request.subjectMembershipId) {
    throw new AppError(
      "UNPROCESSABLE",
      "This request is not an executable member workflow",
    );
  }
  const member = await findMembershipById(
    input.tenantId,
    request.subjectMembershipId,
  );
  if (!member)
    throw new AppError("NOT_FOUND", "Privacy request subject not found");

  let processed: PrivacySubjectRequest | null = null;
  switch (request.kind) {
    case "correction": {
      const correction = privacyCorrectionSchema.parse(request.payload);
      const corrected = await privacyRepo.correctMembershipForPrivacy({
        tenantId: input.tenantId,
        membershipId: member.id,
        displayName: correction.displayName,
        pilotCallsign: correction.pilotCallsign,
      });
      if (!corrected) throw new AppError("NOT_FOUND", "Membership not found");
      if (correction.clerkCorrectionRequested) {
        await privacyRepo.createExternalRequestTasks({
          tenantId: input.tenantId,
          requestId: request.id,
          tasks: [{ provider: "clerk", action: "correct_identity_record" }],
        });
      }
      const tasks = await privacyRepo.listExternalRequestTasks(
        input.tenantId,
        request.id,
      );
      processed = await privacyRepo.completePrivacyRequest({
        tenantId: input.tenantId,
        requestId: request.id,
        actorMembershipId: input.actorMembershipId,
        status: tasks.some((task) => task.status === "pending")
          ? "awaiting_external"
          : "completed",
        result: {
          correctedFields: [
            ...(correction.displayName !== undefined ? ["displayName"] : []),
            ...(correction.pilotCallsign !== undefined
              ? ["pilotCallsign"]
              : []),
          ],
          clerkTaskCreated: correction.clerkCorrectionRequested,
        },
        scrubPayload: true,
      });
      break;
    }
    case "restriction": {
      const restriction = privacyRestrictionSchema.parse(request.payload);
      await privacyRepo.upsertSubjectRestriction({
        tenantId: input.tenantId,
        membershipId: member.id,
        actorMembershipId: input.actorMembershipId,
        reason: restriction.reason,
      });
      processed = await privacyRepo.completePrivacyRequest({
        tenantId: input.tenantId,
        requestId: request.id,
        actorMembershipId: input.actorMembershipId,
        status: "completed",
        result: { optionalProcessingRestricted: true },
        scrubPayload: true,
      });
      break;
    }
    case "objection": {
      const objection = privacyObjectionSchema.parse(request.payload);
      await privacyRepo.upsertSubjectObjection({
        tenantId: input.tenantId,
        membershipId: member.id,
        actorMembershipId: input.actorMembershipId,
        scopes: objection.scopes,
      });
      processed = await privacyRepo.completePrivacyRequest({
        tenantId: input.tenantId,
        requestId: request.id,
        actorMembershipId: input.actorMembershipId,
        status: "completed",
        result: { objectionScopes: objection.scopes },
        scrubPayload: true,
      });
      break;
    }
    case "anonymization":
    case "erasure": {
      if (input.confirmation !== SUBJECT_DESTRUCTION_CONFIRMATION) {
        throw new AppError(
          "BAD_REQUEST",
          `Set confirmation to ${SUBJECT_DESTRUCTION_CONFIRMATION}`,
        );
      }
      if (!request.approvedByMembershipId) {
        throw new AppError(
          "CONFLICT",
          "Destructive processing requires a second administrator",
        );
      }
      const hold = await privacyRepo.findBlockingLegalHold({
        tenantId: input.tenantId,
        membershipId: member.id,
      });
      if (hold) {
        await privacyRepo.markPrivacyRequestBlocked({
          tenantId: input.tenantId,
          requestId: request.id,
          actorMembershipId: input.actorMembershipId,
          reason: `Active legal hold ${hold.id}`,
        });
        throw new AppError(
          "CONFLICT",
          "An active legal hold blocks processing",
          {
            details: { legalHoldId: hold.id },
          },
        );
      }
      if (member.status !== "disabled" || member.role === "admin") {
        throw new AppError(
          "CONFLICT",
          "Disable and offboard a non-admin subject before destructive processing",
        );
      }
      const tasks = await privacyRepo.listExternalRequestTasks(
        input.tenantId,
        request.id,
      );
      const clerkTask = tasks.find((task) => task.provider === "clerk");
      if (
        !clerkTask ||
        !["completed", "not_applicable"].includes(clerkTask.status)
      ) {
        throw new AppError(
          "CONFLICT",
          "Complete the Clerk disable/deletion task before local destruction",
        );
      }
      const remainingTasks = tasks.filter(
        (task) => !["completed", "not_applicable"].includes(task.status),
      );
      const destruction =
        request.kind === "erasure"
          ? await privacyRepo.erasePrivacySubject({
              tenantId: input.tenantId,
              membershipId: member.id,
              requestId: request.id,
              actorMembershipId: input.actorMembershipId,
              finalStatus:
                remainingTasks.length > 0 ? "awaiting_external" : "completed",
              externalTasksRemaining: remainingTasks.length,
            })
          : await privacyRepo.anonymizePrivacySubject({
              tenantId: input.tenantId,
              membershipId: member.id,
              requestId: request.id,
              actorMembershipId: input.actorMembershipId,
              finalStatus:
                remainingTasks.length > 0 ? "awaiting_external" : "completed",
              externalTasksRemaining: remainingTasks.length,
            });
      if (!destruction) {
        throw new AppError(
          "CONFLICT",
          "Open work, a legal hold, or a concurrent change blocks destruction",
        );
      }
      processed = destruction.request;
      break;
    }
    default:
      throw new AppError(
        "UNPROCESSABLE",
        "Export requests are processed through the bounded export endpoint",
      );
  }
  if (!processed) {
    throw new AppError("CONFLICT", "Privacy request changed concurrently");
  }
  return {
    request: processed,
    externalTasks: await privacyRepo.listExternalRequestTasks(
      input.tenantId,
      input.requestId,
    ),
  };
}

export async function exportPrivacyRequestPage(input: {
  tenantId: string;
  actorMembershipId: string;
  requestId: string;
  cursor?: string;
  limit: number;
}): Promise<{
  generatedAt: string;
  requestId: string;
  scope: "member" | "tenant";
  manifest: {
    stores: readonly string[];
    externalSystems: readonly string[];
    omittedSecurityFields: readonly string[];
  };
  items: Array<{ store: string; id: string; data: Record<string, unknown> }>;
  nextCursor: string | null;
}> {
  const request = await privacyRepo.findPrivacySubjectRequest(
    input.tenantId,
    input.requestId,
  );
  if (!request) throw new AppError("NOT_FOUND", "Privacy request not found");
  if (
    request.kind !== "export" ||
    !request.verifiedAt ||
    !["approved", "awaiting_external", "completed"].includes(request.status)
  ) {
    throw new AppError("CONFLICT", "A verified export request is required");
  }
  if (request.scope === "member" && !request.subjectMembershipId) {
    throw new AppError("CONFLICT", "The export subject is no longer available");
  }
  await ensureExportExternalTasks(request);
  const decoded = input.cursor
    ? decodeExportCursor(input.cursor, request.id)
    : { requestId: request.id, storeIndex: 0, afterId: undefined };
  let storeIndex = decoded.storeIndex;
  let afterId = decoded.afterId;
  const items: Array<{
    store: string;
    id: string;
    data: Record<string, unknown>;
  }> = [];
  let nextCursor: string | null = null;

  while (
    items.length < input.limit &&
    storeIndex < privacyRepo.PRIVACY_EXPORT_STORES.length
  ) {
    const store = privacyRepo.PRIVACY_EXPORT_STORES[storeIndex]!;
    const remaining = input.limit - items.length;
    const rows = await privacyRepo.listPrivacyExportStoreRecords({
      tenantId: input.tenantId,
      scope: request.scope,
      membershipId: request.subjectMembershipId,
      store,
      afterId,
      limit: remaining + 1,
    });
    const selected = rows.slice(0, remaining);
    items.push(
      ...selected.map((row) => ({
        store,
        id: row.id,
        data:
          store === "auditEvents" && row.data.meta
            ? { ...row.data, meta: redactAuditMeta(row.data.meta) }
            : row.data,
      })),
    );
    if (rows.length > remaining) {
      nextCursor = encodeExportCursor({
        requestId: request.id,
        storeIndex,
        afterId: selected.at(-1)!.id,
      });
      break;
    }
    storeIndex += 1;
    afterId = undefined;
  }
  if (!nextCursor && storeIndex < privacyRepo.PRIVACY_EXPORT_STORES.length) {
    nextCursor = encodeExportCursor({ requestId: request.id, storeIndex });
  }
  if (!nextCursor && request.status === "approved") {
    const externalTasks = await privacyRepo.listExternalRequestTasks(
      input.tenantId,
      request.id,
    );
    const externalTasksRemaining = externalTasks.filter((task) =>
      ["pending", "failed"].includes(task.status),
    ).length;
    await privacyRepo.completePrivacyRequest({
      tenantId: input.tenantId,
      requestId: request.id,
      actorMembershipId: input.actorMembershipId,
      status: externalTasksRemaining > 0 ? "awaiting_external" : "completed",
      result: {
        localExportCompletedAt: new Date().toISOString(),
        externalTasksRemaining,
      },
    });
  }
  await writeAudit({
    tenantId: input.tenantId,
    actorMembershipId: input.actorMembershipId,
    action: "privacy.export_page_accessed",
    entityType: "privacy_subject_request",
    entityId: request.id,
    meta: {
      scope: request.scope,
      itemCount: items.length,
      stores: [...new Set(items.map((item) => item.store))],
      continuedFromCursor: Boolean(input.cursor),
      hasNextPage: Boolean(nextCursor),
    },
  });
  return {
    generatedAt: new Date().toISOString(),
    requestId: request.id,
    scope: request.scope,
    manifest: {
      stores: privacyRepo.PRIVACY_EXPORT_STORES,
      externalSystems: [
        "Clerk",
        "Vercel logs and security telemetry",
        "Neon backups and point-in-time recovery",
        "Hoppie provider queue",
        "Navigraph and SimBrief",
      ],
      omittedSecurityFields: [
        "tenants.hoppie_logon_enc",
        "navigraph_oauth_transactions.code_verifier_enc",
        "simbrief_dispatches.callback_token_mac",
      ],
    },
    items,
    nextCursor,
  };
}

export async function createHold(input: {
  tenantId: string;
  actorMembershipId: string;
  subjectMembershipId?: string | null;
  scope: string;
  reason: string;
  expiresAt?: Date | null;
}): Promise<PrivacyLegalHold> {
  if (input.subjectMembershipId) {
    const member = await findMembershipById(
      input.tenantId,
      input.subjectMembershipId,
    );
    if (!member)
      throw new AppError("NOT_FOUND", "Legal-hold subject not found");
  }
  const hold = await privacyRepo.createLegalHold(input);
  if (!hold) {
    throw new AppError(
      "CONFLICT",
      "Legal-hold actor or subject changed concurrently",
    );
  }
  return hold;
}

export async function approveHold(input: {
  tenantId: string;
  actorMembershipId: string;
  holdId: string;
}): Promise<PrivacyLegalHold> {
  const hold = await privacyRepo.approveLegalHold(input);
  if (!hold) {
    throw new AppError(
      "CONFLICT",
      "A different administrator must approve a pending legal hold",
    );
  }
  return hold;
}

export async function releaseHold(input: {
  tenantId: string;
  actorMembershipId: string;
  holdId: string;
}): Promise<PrivacyLegalHold> {
  const hold = await privacyRepo.releaseLegalHold(input);
  if (!hold) throw new AppError("CONFLICT", "Legal hold is not active");
  return hold;
}

export async function updateExternalTask(input: {
  tenantId: string;
  actorMembershipId: string;
  taskId: string;
  status: "completed" | "not_applicable" | "failed";
  operatorNote: string;
}): Promise<PrivacyExternalTask> {
  const task = await privacyRepo.completeExternalTask(input);
  if (!task) throw new AppError("CONFLICT", "External task cannot be updated");
  return task;
}

export async function assertOptionalProcessingAllowed(input: {
  tenantId: string;
  membershipId: string;
  purpose: ObjectionScope;
}): Promise<void> {
  const control = await privacyRepo.findSubjectControl(
    input.tenantId,
    input.membershipId,
  );
  if (!control) return;
  const scopes = z.array(objectionScopeSchema).parse(control.objectionScopes);
  if (
    control.restrictedAt ||
    scopes.includes("optional_integrations") ||
    scopes.includes(input.purpose)
  ) {
    throw new AppError(
      "FORBIDDEN",
      "This member's privacy restriction or objection blocks optional processing",
      { details: { purpose: input.purpose } },
    );
  }
}

function assertIdempotentRunMatches(
  run: PrivacyRetentionRun,
  expected: {
    policyId: string;
    mode: "dry_run" | "execute";
    dryRunId?: string;
  },
) {
  if (
    run.policyId !== expected.policyId ||
    run.mode !== expected.mode ||
    (run.dryRunId ?? undefined) !== expected.dryRunId
  ) {
    throw new AppError(
      "CONFLICT",
      "Idempotency key was already used for a different retention run",
    );
  }
}

function sanitizedRetentionFailure(error: unknown): string {
  if (error instanceof AppError) return error.message;
  if (error instanceof z.ZodError) {
    return "Retention policy or checkpoint data failed validation";
  }
  return "Retention checkpoint failed; inspect correlated server logs";
}

async function ensureDestructiveExternalTasks(
  request: PrivacySubjectRequest,
): Promise<void> {
  if (!["anonymization", "erasure"].includes(request.kind)) return;
  await privacyRepo.createExternalRequestTasks({
    tenantId: request.tenantId,
    requestId: request.id,
    tasks: [
      {
        provider: "clerk",
        action: "disable_or_delete_account_before_local_destruction",
      },
      { provider: "vercel", action: "review_subject_log_deletion" },
      { provider: "neon", action: "verify_pitr_expiry" },
      { provider: "backup", action: "verify_backup_expiry" },
      {
        provider: "hoppie",
        action: "document_provider_queue_limit",
        status: "not_applicable",
        operatorNote:
          "Hoppie exposes no subject-erasure API; verify its documented queue expiry.",
      },
      {
        provider: "navigraph",
        action: "assess_navigraph_simbrief_request",
      },
    ],
  });
}

async function ensureExportExternalTasks(
  request: PrivacySubjectRequest,
): Promise<void> {
  if (request.kind !== "export") return;
  await privacyRepo.createExternalRequestTasks({
    tenantId: request.tenantId,
    requestId: request.id,
    tasks: [
      { provider: "clerk", action: "export_verified_identity_record" },
      { provider: "vercel", action: "export_or_assess_subject_logs" },
      { provider: "neon", action: "assess_backup_and_pitr_scope" },
      { provider: "backup", action: "assess_independent_backup_scope" },
      { provider: "hoppie", action: "document_provider_queue_scope" },
      {
        provider: "navigraph",
        action: "export_or_assess_navigraph_simbrief_data",
      },
    ],
  });
}

function encodeExportCursor(value: z.infer<typeof exportCursorSchema>): string {
  return encryptOpaqueToken(
    JSON.stringify(value),
    env().TENANT_SECRETS_KEY,
    "privacy-export-cursor",
  );
}

function decodeExportCursor(
  cursor: string,
  requestId: string,
): z.infer<typeof exportCursorSchema> {
  try {
    const decoded = exportCursorSchema.parse(
      JSON.parse(
        decryptOpaqueToken(
          cursor,
          env().TENANT_SECRETS_KEY,
          "privacy-export-cursor",
        ),
      ),
    );
    if (decoded.requestId !== requestId)
      throw new Error("Cursor scope mismatch");
    return decoded;
  } catch (error) {
    throw new AppError("BAD_REQUEST", "Invalid export cursor", {
      cause: error,
    });
  }
}

export const privacyConfirmations = {
  retentionExecution: RETENTION_EXECUTION_CONFIRMATION,
  subjectDestruction: SUBJECT_DESTRUCTION_CONFIRMATION,
} as const;
