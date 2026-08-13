import {
  administrativelyUpdateMembership,
  createDirectoryMembershipWithAudit,
  findMembership,
  getMemberWorkImpact,
  type AdministrativeMemberPatch,
  type MemberWorkImpact,
} from "../../db/repositories/memberships.js";
import { writeAudit } from "../../db/repositories/audit.js";
import type { Membership } from "../../db/schema.js";
import { AppError } from "../../lib/errors.js";
import { mapClerkOrgRole } from "./roles.js";

export type MemberUpdateInput = AdministrativeMemberPatch & {
  reassignToMembershipId?: string;
};

export async function getAdministrativeMemberImpact(input: {
  tenantId: string;
  membershipId: string;
}): Promise<MemberWorkImpact> {
  const impact = await getMemberWorkImpact(input.tenantId, input.membershipId);
  if (!impact) throw new AppError("NOT_FOUND", "Member not found");
  return impact;
}

export async function updateMemberAsAdministrator(input: {
  tenantId: string;
  actorMembershipId: string;
  membershipId: string;
  patch: MemberUpdateInput;
  auditAction?:
    | "member.updated"
    | "membership.application_approved"
    | "membership.application_rejected"
    | "membership.kick_requested";
}): Promise<{
  membership: Membership;
  reassignedFlightCount: number;
  reassignedScheduleRequestCount: number;
}> {
  const { reassignToMembershipId, ...patch } = input.patch;
  const result = await administrativelyUpdateMembership({
    tenantId: input.tenantId,
    actorMembershipId: input.actorMembershipId,
    membershipId: input.membershipId,
    patch,
    reassignToMembershipId,
    auditAction: input.auditAction,
    ...(input.auditAction === "membership.application_approved" ||
    input.auditAction === "membership.application_rejected"
      ? { expectedStatus: "invited" as const }
      : {}),
  });

  if (result.kind === "not_found") {
    if (
      input.auditAction === "membership.application_approved" ||
      input.auditAction === "membership.application_rejected"
    ) {
      throw new AppError(
        "CONFLICT",
        "This membership application is no longer pending",
      );
    }
    throw new AppError("NOT_FOUND", "Member not found");
  }
  if (result.kind === "blocked") {
    throw memberUpdateConflict(result.reason, result.impact);
  }
  return {
    membership: result.membership,
    reassignedFlightCount: result.reassignedFlightCount,
    reassignedScheduleRequestCount: result.reassignedScheduleRequestCount,
  };
}

function memberUpdateConflict(
  reason:
    | "invalid_replacement"
    | "last_active_admin"
    | "active_flight"
    | "terminal_request_link"
    | "reassignment_required",
  impact: MemberWorkImpact,
): AppError {
  const details = { reason, impact };
  switch (reason) {
    case "invalid_replacement":
      return new AppError(
        "CONFLICT",
        "Replacement member must be a different active pilot in this tenant",
        { details },
      );
    case "last_active_admin":
      return new AppError(
        "CONFLICT",
        "Promote another active administrator before changing the last active administrator",
        { details },
      );
    case "active_flight":
      return new AppError(
        "CONFLICT",
        "A member operating an active flight cannot be disabled; complete or cancel the active flight first",
        { details },
      );
    case "terminal_request_link":
      return new AppError(
        "CONFLICT",
        "An open flight is linked to terminal schedule-request history; cancel or detach that flight through an explicit audited workflow before changing this member",
        { details },
      );
    default:
      return new AppError(
        "CONFLICT",
        "Outstanding offers and schedule requests require an explicit active replacement member",
        { details },
      );
  }
}

export type DirectoryMembership = {
  role: string;
  publicUserData?: {
    userId?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    identifier?: string | null;
  } | null;
};

export type DirectoryPage = {
  data: DirectoryMembership[];
  totalCount: number;
};

export type DirectoryPageLoader = (input: {
  organizationId: string;
  limit: number;
  offset: number;
}) => Promise<DirectoryPage>;

export type DirectorySyncResult = {
  complete: boolean;
  summaryAuditRecorded: boolean;
  pages: number;
  seen: number;
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  failed: number;
  failures: Array<{
    scope: "page" | "membership";
    offset: number;
    code: string;
  }>;
};

const DIRECTORY_PAGE_SIZE = 100;
const MAX_REPORTED_FAILURES = 25;
const MAX_DIRECTORY_PAGES = 10_000;

/** Page the complete Clerk directory and converge each local member safely. */
export async function syncMembersFromDirectory(input: {
  tenantId: string;
  actorMembershipId: string;
  organizationId: string;
  loadPage: DirectoryPageLoader;
}): Promise<DirectorySyncResult> {
  const result: DirectorySyncResult = {
    complete: true,
    summaryAuditRecorded: false,
    pages: 0,
    seen: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    failed: 0,
    failures: [],
  };
  let offset = 0;
  let lastKnownTotalCount = 0;

  while (result.pages < MAX_DIRECTORY_PAGES) {
    let page: DirectoryPage;
    try {
      page = await input.loadPage({
        organizationId: input.organizationId,
        limit: DIRECTORY_PAGE_SIZE,
        offset,
      });
    } catch {
      result.complete = false;
      result.failed += 1;
      recordSyncFailure(result, { scope: "page", offset, code: "page_failed" });
      break;
    }

    result.pages += 1;
    lastKnownTotalCount = page.totalCount;
    if (page.data.length === 0) {
      if (offset < page.totalCount) {
        result.complete = false;
        result.failed += 1;
        recordSyncFailure(result, {
          scope: "page",
          offset,
          code: "pagination_stalled",
        });
      }
      break;
    }

    for (const [pageIndex, directoryMembership] of page.data.entries()) {
      const itemOffset = offset + pageIndex;
      result.seen += 1;
      const clerkUserId = directoryMembership.publicUserData?.userId;
      if (!clerkUserId) {
        result.skipped += 1;
        continue;
      }

      const role = mapClerkOrgRole(directoryMembership.role);
      const displayName = directoryDisplayName(directoryMembership);
      try {
        let existing = await findMembership(input.tenantId, clerkUserId);
        if (!existing) {
          const created = await createDirectoryMembershipWithAudit({
            tenantId: input.tenantId,
            actorMembershipId: input.actorMembershipId,
            clerkUserId,
            role,
            displayName,
          });
          if (created) {
            result.created += 1;
            continue;
          }
          // A concurrent sync may have won the unique insert. Re-read and
          // converge it through the same guarded update path.
          existing = await findMembership(input.tenantId, clerkUserId);
          if (!existing) throw new Error("Directory member disappeared");
        }

        const nextDisplayName = displayName ?? existing.displayName;
        if (
          existing.role === role &&
          existing.displayName === nextDisplayName
        ) {
          result.unchanged += 1;
          continue;
        }
        const updated = await administrativelyUpdateMembership({
          tenantId: input.tenantId,
          membershipId: existing.id,
          actorMembershipId: input.actorMembershipId,
          patch: { role, displayName: nextDisplayName },
          auditAction: "member.directory_synced",
        });
        if (updated.kind !== "updated") {
          result.complete = false;
          result.failed += 1;
          recordSyncFailure(result, {
            scope: "membership",
            offset: itemOffset,
            code:
              updated.kind === "blocked"
                ? updated.reason
                : "membership_disappeared",
          });
          continue;
        }
        result.updated += 1;
      } catch {
        result.complete = false;
        result.failed += 1;
        recordSyncFailure(result, {
          scope: "membership",
          offset: itemOffset,
          code: "membership_failed",
        });
      }
    }

    offset += page.data.length;
    if (offset >= page.totalCount) break;
  }

  if (directoryPageLimitExceeded(result.pages, offset, lastKnownTotalCount)) {
    result.complete = false;
    result.failed += 1;
    recordSyncFailure(result, {
      scope: "page",
      offset,
      code: "page_limit_exceeded",
    });
  }

  try {
    await writeAudit({
      tenantId: input.tenantId,
      actorMembershipId: input.actorMembershipId,
      action: "members.directory_sync",
      entityType: "tenant",
      entityId: input.tenantId,
      meta: {
        complete: result.complete,
        pages: result.pages,
        seen: result.seen,
        created: result.created,
        updated: result.updated,
        unchanged: result.unchanged,
        skipped: result.skipped,
        failed: result.failed,
      },
    });
    result.summaryAuditRecorded = true;
  } catch {
    // Per-member mutations are already atomically audited. A summary failure
    // must remain visible without converting a completed sync into an opaque
    // 500 or incorrectly claiming the prior mutations rolled back.
    result.complete = false;
    result.failed += 1;
    recordSyncFailure(result, {
      scope: "page",
      offset,
      code: "summary_audit_failed",
    });
  }
  return result;
}

export function directoryPageLimitExceeded(
  pages: number,
  offset: number,
  totalCount: number,
): boolean {
  return pages >= MAX_DIRECTORY_PAGES && offset < totalCount;
}

function directoryDisplayName(membership: DirectoryMembership): string | null {
  const name = [
    membership.publicUserData?.firstName,
    membership.publicUserData?.lastName,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
  return name || membership.publicUserData?.identifier?.trim() || null;
}

function recordSyncFailure(
  result: DirectorySyncResult,
  failure: DirectorySyncResult["failures"][number],
): void {
  if (result.failures.length < MAX_REPORTED_FAILURES) {
    result.failures.push(failure);
  }
}
