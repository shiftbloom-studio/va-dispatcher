import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadEnv, resetEnvCache } from "../../env.js";
import { DEFAULT_RETENTION_POLICY, emptyRetentionReport } from "./policy.js";

const mocks = vi.hoisted(() => ({
  anonymizePrivacySubject: vi.fn(),
  approveLegalHold: vi.fn(),
  approvePrivacyPolicy: vi.fn(),
  approvePrivacySubjectRequest: vi.fn(),
  claimRetentionRun: vi.fn(),
  completeExternalTask: vi.fn(),
  completePrivacyRequest: vi.fn(),
  correctMembershipForPrivacy: vi.fn(),
  createExternalRequestTasks: vi.fn(),
  createExternalRunTask: vi.fn(),
  createLegalHold: vi.fn(),
  createPrivacyPolicy: vi.fn(),
  createPrivacySubjectRequest: vi.fn(),
  createRetentionRun: vi.fn(),
  erasePrivacySubject: vi.fn(),
  executeRetentionClass: vi.fn(),
  failRetentionRun: vi.fn(),
  findBlockingLegalHold: vi.fn(),
  findActivePrivacyPolicy: vi.fn(),
  findCompletedDryRun: vi.fn(),
  findMembershipById: vi.fn(),
  findPrivacyPolicy: vi.fn(),
  findPrivacySubjectRequest: vi.fn(),
  findRetentionRun: vi.fn(),
  findSubjectControl: vi.fn(),
  inspectRetentionClass: vi.fn(),
  listExternalRequestTasks: vi.fn(),
  listPrivacyExportStoreRecords: vi.fn(),
  markPrivacyRequestBlocked: vi.fn(),
  retryBlockedPrivacyRequest: vi.fn(),
  updateRetentionRunProgress: vi.fn(),
  upsertSubjectObjection: vi.fn(),
  upsertSubjectRestriction: vi.fn(),
  verifyPrivacySubjectRequest: vi.fn(),
  writeAudit: vi.fn(),
}));

vi.mock("../../db/repositories/privacy.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../db/repositories/privacy.js")
  >("../../db/repositories/privacy.js");
  return { ...actual, ...mocks };
});

vi.mock("../../db/repositories/memberships.js", () => ({
  findMembershipById: mocks.findMembershipById,
}));

vi.mock("../../db/repositories/audit.js", () => ({
  writeAudit: mocks.writeAudit,
}));

import {
  assertOptionalProcessingAllowed,
  exportPrivacyRequestPage,
  processRetentionRun,
  processSubjectRequest,
  queueRetentionRun,
  retrySubjectRequest,
  verifySubjectRequest,
} from "./service.js";

const TENANT = "27000000-0000-4000-8000-000000000001";
const ADMIN = "27000000-0000-4000-8000-000000000011";
const SUBJECT = "27000000-0000-4000-8000-000000000021";
const POLICY = "27000000-0000-4000-8000-000000000031";
const RUN = "27000000-0000-4000-8000-000000000041";
const REQUEST = "27000000-0000-4000-8000-000000000051";
const NOW = new Date("2026-08-12T12:00:00.000Z");
const TENANT_SECRETS_KEY = Buffer.alloc(32, 9).toString("base64");

function activePolicy() {
  return {
    id: POLICY,
    tenantId: TENANT,
    version: 1,
    status: "active" as const,
    config: DEFAULT_RETENTION_POLICY,
    createdByMembershipId: ADMIN,
    approvedByMembershipId: "27000000-0000-4000-8000-000000000012",
    approvedAt: NOW,
    effectiveAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function retentionRun(
  patch: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: RUN,
    tenantId: TENANT,
    policyId: POLICY,
    mode: "dry_run",
    status: "queued",
    asOf: NOW,
    dryRunId: null,
    idempotencyKey: "privacy-run-2026-08",
    cursor: { classIndex: 0 },
    report: emptyRetentionReport(NOW),
    requestedByMembershipId: ADMIN,
    startedAt: null,
    completedAt: null,
    lastError: null,
    attemptCount: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...patch,
  };
}

function exportRequest(patch: Record<string, unknown> = {}) {
  return {
    id: REQUEST,
    tenantId: TENANT,
    scope: "member" as const,
    subjectMembershipId: SUBJECT,
    subjectReference: "opaque",
    kind: "export" as const,
    status: "approved" as const,
    payload: {},
    result: {},
    createdByMembershipId: ADMIN,
    verifiedByMembershipId: ADMIN,
    verifiedAt: NOW,
    approvedByMembershipId: null,
    approvedAt: null,
    processedAt: null,
    lastError: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...patch,
  };
}

describe("privacy lifecycle service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetEnvCache();
    loadEnv({ NODE_ENV: "test", TENANT_SECRETS_KEY });
    mocks.findActivePrivacyPolicy.mockResolvedValue(activePolicy());
    mocks.findPrivacyPolicy.mockResolvedValue(activePolicy());
    mocks.createRetentionRun.mockImplementation(async (input) => ({
      run: retentionRun({
        mode: input.mode,
        asOf: input.asOf,
        dryRunId: input.dryRunId ?? null,
        idempotencyKey: input.idempotencyKey,
        report: input.report,
      }),
      created: true,
    }));
    mocks.writeAudit.mockResolvedValue(undefined);
    mocks.inspectRetentionClass.mockResolvedValue({
      eligible: 3,
      affected: 0,
      held: 1,
      hasMore: false,
    });
    mocks.updateRetentionRunProgress.mockImplementation(async (input) =>
      retentionRun({
        cursor: input.cursor,
        report: input.report,
        status: input.completed ? "completed" : "queued",
      }),
    );
    mocks.failRetentionRun.mockResolvedValue(undefined);
    mocks.listExternalRequestTasks.mockResolvedValue([]);
    mocks.findMembershipById.mockResolvedValue({
      id: SUBJECT,
      tenantId: TENANT,
      role: "pilot",
      status: "disabled",
    });
  });

  it("requires a completed same-policy dry run and explicit confirmation", async () => {
    await expect(
      queueRetentionRun({
        tenantId: TENANT,
        actorMembershipId: ADMIN,
        mode: "execute",
        idempotencyKey: "privacy-execute-2026-08",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    mocks.findCompletedDryRun.mockResolvedValue(
      retentionRun({ mode: "dry_run", status: "completed" }),
    );
    await expect(
      queueRetentionRun({
        tenantId: TENANT,
        actorMembershipId: ADMIN,
        mode: "execute",
        idempotencyKey: "privacy-execute-2026-08",
        dryRunId: RUN,
        confirmation: "EXECUTE APPROVED RETENTION",
      }),
    ).resolves.toMatchObject({ mode: "execute", dryRunId: RUN });
  });

  it("rejects idempotency-key reuse for a different run shape", async () => {
    mocks.createRetentionRun.mockResolvedValue({
      run: retentionRun({ mode: "execute" }),
      created: false,
    });
    await expect(
      queueRetentionRun({
        tenantId: TENANT,
        actorMembershipId: ADMIN,
        mode: "dry_run",
        idempotencyKey: "privacy-run-2026-08",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("checkpoints one dry-run class per invocation with hold counts", async () => {
    mocks.claimRetentionRun.mockResolvedValue(retentionRun());
    const result = await processRetentionRun(TENANT, RUN);
    expect(mocks.inspectRetentionClass).toHaveBeenCalledWith({
      tenantId: TENANT,
      classKey: "memberships",
      cutoff: new Date("2024-08-12T12:00:00.000Z"),
    });
    expect(mocks.updateRetentionRunProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: { classIndex: 1 },
        report: expect.objectContaining({
          classes: expect.objectContaining({
            memberships: expect.objectContaining({ eligible: 3, held: 1 }),
          }),
        }),
      }),
    );
    expect(result).toMatchObject({ status: "queued" });
  });

  it("marks the claimed checkpoint failed without advancing on a batch error", async () => {
    mocks.claimRetentionRun.mockResolvedValue(
      retentionRun({ mode: "execute" }),
    );
    mocks.executeRetentionClass.mockRejectedValue(
      new Error("synthetic batch failure"),
    );
    await expect(processRetentionRun(TENANT, RUN)).rejects.toThrow(
      "synthetic batch failure",
    );
    expect(mocks.updateRetentionRunProgress).not.toHaveBeenCalled();
    expect(mocks.failRetentionRun).toHaveBeenCalledWith({
      tenantId: TENANT,
      runId: RUN,
      message: "Retention checkpoint failed; inspect correlated server logs",
    });
  });

  it("blocks destructive subject processing under an active legal hold", async () => {
    mocks.findPrivacySubjectRequest.mockResolvedValue(
      exportRequest({
        kind: "erasure",
        status: "approved",
        approvedByMembershipId: "27000000-0000-4000-8000-000000000012",
      }),
    );
    mocks.findBlockingLegalHold.mockResolvedValue({ id: "hold-a" });
    mocks.markPrivacyRequestBlocked.mockResolvedValue({});

    await expect(
      processSubjectRequest({
        tenantId: TENANT,
        actorMembershipId: ADMIN,
        requestId: REQUEST,
        confirmation: "ERASE VERIFIED SUBJECT DATA",
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      details: { legalHoldId: "hold-a" },
    });
    expect(mocks.erasePrivacySubject).not.toHaveBeenCalled();
  });

  it("retries a blocked destructive request only after its hold is gone", async () => {
    mocks.findPrivacySubjectRequest.mockResolvedValue(
      exportRequest({
        kind: "erasure",
        status: "blocked",
        approvedByMembershipId: "27000000-0000-4000-8000-000000000012",
      }),
    );
    mocks.findBlockingLegalHold.mockResolvedValue({ id: "hold-a" });
    await expect(
      retrySubjectRequest({
        tenantId: TENANT,
        actorMembershipId: ADMIN,
        requestId: REQUEST,
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      details: { legalHoldId: "hold-a" },
    });

    mocks.findBlockingLegalHold.mockResolvedValue(null);
    mocks.retryBlockedPrivacyRequest.mockResolvedValue(
      exportRequest({ kind: "erasure", status: "approved" }),
    );
    await expect(
      retrySubjectRequest({
        tenantId: TENANT,
        actorMembershipId: ADMIN,
        requestId: REQUEST,
      }),
    ).resolves.toMatchObject({ status: "approved" });
  });

  it("corrects local identity data and waits for the requested Clerk follow-up", async () => {
    mocks.findPrivacySubjectRequest.mockResolvedValue(
      exportRequest({
        kind: "correction",
        payload: {
          displayName: "Corrected Pilot",
          clerkCorrectionRequested: true,
        },
      }),
    );
    mocks.correctMembershipForPrivacy.mockResolvedValue(true);
    mocks.listExternalRequestTasks.mockResolvedValue([
      { provider: "clerk", status: "pending" },
    ]);
    mocks.completePrivacyRequest.mockResolvedValue(
      exportRequest({ kind: "correction", status: "awaiting_external" }),
    );

    await expect(
      processSubjectRequest({
        tenantId: TENANT,
        actorMembershipId: ADMIN,
        requestId: REQUEST,
      }),
    ).resolves.toMatchObject({
      request: { status: "awaiting_external" },
    });
    expect(mocks.correctMembershipForPrivacy).toHaveBeenCalledWith({
      tenantId: TENANT,
      membershipId: SUBJECT,
      displayName: "Corrected Pilot",
      pilotCallsign: undefined,
    });
    expect(mocks.createExternalRequestTasks).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: REQUEST,
        tasks: [
          expect.objectContaining({
            provider: "clerk",
            action: "correct_identity_record",
          }),
        ],
      }),
    );
    expect(mocks.completePrivacyRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "awaiting_external",
        scrubPayload: true,
      }),
    );
  });

  it("persists restriction and objection controls before scrubbing reasons", async () => {
    mocks.findPrivacySubjectRequest.mockResolvedValue(
      exportRequest({
        kind: "restriction",
        payload: { reason: "verified restriction" },
      }),
    );
    mocks.completePrivacyRequest.mockResolvedValue(
      exportRequest({ kind: "restriction", status: "completed" }),
    );
    await processSubjectRequest({
      tenantId: TENANT,
      actorMembershipId: ADMIN,
      requestId: REQUEST,
    });
    expect(mocks.upsertSubjectRestriction).toHaveBeenCalledWith({
      tenantId: TENANT,
      membershipId: SUBJECT,
      actorMembershipId: ADMIN,
      reason: "verified restriction",
    });

    mocks.findPrivacySubjectRequest.mockResolvedValue(
      exportRequest({
        kind: "objection",
        payload: {
          scopes: ["simbrief_navigraph", "acars"],
          reason: "verified objection",
        },
      }),
    );
    await processSubjectRequest({
      tenantId: TENANT,
      actorMembershipId: ADMIN,
      requestId: REQUEST,
    });
    expect(mocks.upsertSubjectObjection).toHaveBeenCalledWith({
      tenantId: TENANT,
      membershipId: SUBJECT,
      actorMembershipId: ADMIN,
      scopes: ["simbrief_navigraph", "acars"],
    });
    expect(mocks.completePrivacyRequest).toHaveBeenLastCalledWith(
      expect.objectContaining({ scrubPayload: true }),
    );
  });

  it("exports every inventoried local store including provider payloads", async () => {
    mocks.findPrivacySubjectRequest.mockResolvedValue(exportRequest());
    mocks.listExternalRequestTasks.mockResolvedValue([
      { provider: "clerk", status: "pending" },
    ]);
    mocks.listPrivacyExportStoreRecords.mockImplementation(
      async ({ store }) => [
        {
          id: "27000000-0000-4000-8000-000000000099",
          data:
            store === "simbriefDispatches"
              ? { ofp: { general: { route: "NORKU" } } }
              : store === "acarsMessages"
                ? { body: "synthetic free text", hoppie_raw: { packet: "x" } }
                : { store },
        },
      ],
    );
    mocks.completePrivacyRequest.mockResolvedValue(
      exportRequest({
        status: "completed",
      }),
    );

    const exported = await exportPrivacyRequestPage({
      tenantId: TENANT,
      actorMembershipId: ADMIN,
      requestId: REQUEST,
      limit: 100,
    });
    expect(exported.nextCursor).toBeNull();
    expect(exported.items).toHaveLength(exported.manifest.stores.length);
    expect(exported.items).toContainEqual(
      expect.objectContaining({
        store: "simbriefDispatches",
        data: { ofp: { general: { route: "NORKU" } } },
      }),
    );
    expect(exported.items).toContainEqual(
      expect.objectContaining({
        store: "acarsMessages",
        data: {
          body: "synthetic free text",
          hoppie_raw: { packet: "x" },
        },
      }),
    );
    expect(mocks.completePrivacyRequest).toHaveBeenCalled();
    expect(mocks.completePrivacyRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "awaiting_external",
        result: expect.objectContaining({ externalTasksRemaining: 1 }),
      }),
    );
    expect(mocks.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "privacy.export_page_accessed" }),
    );
  });

  it("authenticates bounded export cursors and binds them to one request", async () => {
    const firstId = "27000000-0000-4000-8000-000000000091";
    const secondId = "27000000-0000-4000-8000-000000000092";
    mocks.findPrivacySubjectRequest.mockResolvedValue(exportRequest());
    mocks.listPrivacyExportStoreRecords.mockImplementation(
      async ({ store, afterId }) => {
        if (store !== "tenant") return [];
        if (!afterId) {
          return [
            { id: firstId, data: { displayName: "Synthetic VA" } },
            { id: secondId, data: { displayName: "Synthetic VA" } },
          ];
        }
        return afterId === firstId
          ? [{ id: secondId, data: { displayName: "Synthetic VA" } }]
          : [];
      },
    );

    const firstPage = await exportPrivacyRequestPage({
      tenantId: TENANT,
      actorMembershipId: ADMIN,
      requestId: REQUEST,
      limit: 1,
    });
    expect(firstPage.items.map((item) => item.id)).toEqual([firstId]);
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    expect(firstPage.nextCursor).not.toContain(REQUEST);

    const secondPage = await exportPrivacyRequestPage({
      tenantId: TENANT,
      actorMembershipId: ADMIN,
      requestId: REQUEST,
      cursor: firstPage.nextCursor!,
      limit: 1,
    });
    expect(secondPage.items.map((item) => item.id)).toEqual([secondId]);

    const lastCharacter = firstPage.nextCursor!.at(-1)!;
    const tamperedCursor = `${firstPage.nextCursor!.slice(0, -1)}${lastCharacter === "A" ? "B" : "A"}`;
    await expect(
      exportPrivacyRequestPage({
        tenantId: TENANT,
        actorMembershipId: ADMIN,
        requestId: REQUEST,
        cursor: tamperedCursor,
        limit: 1,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const otherRequestId = "27000000-0000-4000-8000-000000000052";
    mocks.findPrivacySubjectRequest.mockResolvedValue(
      exportRequest({ id: otherRequestId }),
    );
    await expect(
      exportPrivacyRequestPage({
        tenantId: TENANT,
        actorMembershipId: ADMIN,
        requestId: otherRequestId,
        cursor: firstPage.nextCursor!,
        limit: 1,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("creates provider follow-ups when an export is verified", async () => {
    mocks.verifyPrivacySubjectRequest.mockResolvedValue(exportRequest());
    await verifySubjectRequest({
      tenantId: TENANT,
      actorMembershipId: ADMIN,
      requestId: REQUEST,
    });
    expect(mocks.createExternalRequestTasks).toHaveBeenCalledWith({
      tenantId: TENANT,
      requestId: REQUEST,
      tasks: expect.arrayContaining([
        expect.objectContaining({ provider: "clerk" }),
        expect.objectContaining({ provider: "vercel" }),
        expect.objectContaining({ provider: "neon" }),
        expect.objectContaining({ provider: "backup" }),
        expect.objectContaining({ provider: "hoppie" }),
        expect.objectContaining({ provider: "navigraph" }),
      ]),
    });
  });

  it("enforces restriction and purpose-specific objections", async () => {
    mocks.findSubjectControl.mockResolvedValue({
      restrictedAt: null,
      objectionScopes: ["simbrief_navigraph"],
    });
    await expect(
      assertOptionalProcessingAllowed({
        tenantId: TENANT,
        membershipId: SUBJECT,
        purpose: "simbrief_navigraph",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      assertOptionalProcessingAllowed({
        tenantId: TENANT,
        membershipId: SUBJECT,
        purpose: "acars",
      }),
    ).resolves.toBeUndefined();
  });
});
