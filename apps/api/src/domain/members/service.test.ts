import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  administrativelyUpdateMembership: vi.fn(),
  createDirectoryMembershipWithAudit: vi.fn(),
  findMembership: vi.fn(),
  getMemberWorkImpact: vi.fn(),
  writeAudit: vi.fn(),
}));

vi.mock("../../db/repositories/memberships.js", () => ({
  administrativelyUpdateMembership: mocks.administrativelyUpdateMembership,
  createDirectoryMembershipWithAudit: mocks.createDirectoryMembershipWithAudit,
  findMembership: mocks.findMembership,
  getMemberWorkImpact: mocks.getMemberWorkImpact,
}));

vi.mock("../../db/repositories/audit.js", () => ({
  writeAudit: mocks.writeAudit,
}));

import {
  directoryPageLimitExceeded,
  syncMembersFromDirectory,
  updateMemberAsAdministrator,
} from "./service.js";

function directoryMember(index: number) {
  return {
    role: "org:member",
    publicUserData: {
      userId: `user_${index}`,
      firstName: "Pilot",
      lastName: String(index),
      identifier: `pilot${index}@example.invalid`,
    },
  };
}

describe("member administration service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findMembership.mockResolvedValue(null);
    mocks.createDirectoryMembershipWithAudit.mockImplementation(
      async (input) => ({
        id: `membership_${input.clerkUserId}`,
        tenantId: input.tenantId,
        clerkUserId: input.clerkUserId,
        role: input.role,
        displayName: input.displayName,
        pilotCallsign: null,
        simbriefUserId: null,
        simbriefVerifiedAt: null,
        navigraphSubject: null,
        navigraphUsername: null,
        navigraphConnectedAt: null,
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );
    mocks.writeAudit.mockResolvedValue(undefined);
  });

  it("pages and synchronizes Clerk directories larger than 100 members", async () => {
    const allMembers = Array.from({ length: 205 }, (_, index) =>
      directoryMember(index),
    );
    const loadPage = vi.fn(async ({ limit, offset }) => ({
      data: allMembers.slice(offset, offset + limit),
      totalCount: allMembers.length,
    }));

    const result = await syncMembersFromDirectory({
      tenantId: "tenant-1",
      actorMembershipId: "admin-1",
      organizationId: "org-1",
      loadPage,
    });

    expect(result).toMatchObject({
      complete: true,
      summaryAuditRecorded: true,
      pages: 3,
      seen: 205,
      created: 205,
      failed: 0,
    });
    expect(loadPage).toHaveBeenNthCalledWith(1, {
      organizationId: "org-1",
      limit: 100,
      offset: 0,
    });
    expect(loadPage).toHaveBeenNthCalledWith(2, {
      organizationId: "org-1",
      limit: 100,
      offset: 100,
    });
    expect(loadPage).toHaveBeenNthCalledWith(3, {
      organizationId: "org-1",
      limit: 100,
      offset: 200,
    });
  });

  it("reports aggregate audit failure without hiding completed member changes", async () => {
    mocks.writeAudit.mockRejectedValue(new Error("synthetic summary failure"));

    const result = await syncMembersFromDirectory({
      tenantId: "tenant-1",
      actorMembershipId: "admin-1",
      organizationId: "org-1",
      loadPage: async () => ({
        data: [directoryMember(0)],
        totalCount: 1,
      }),
    });

    expect(result).toMatchObject({
      complete: false,
      summaryAuditRecorded: false,
      created: 1,
      failed: 1,
      failures: [{ scope: "page", offset: 1, code: "summary_audit_failed" }],
    });
  });

  it("does not flag an exact page-limit completion as truncated", () => {
    expect(directoryPageLimitExceeded(10_000, 1_000_000, 1_000_000)).toBe(
      false,
    );
    expect(directoryPageLimitExceeded(10_000, 1_000_000, 1_000_001)).toBe(true);
  });

  it("reports the correct global item offset for a page-two partial failure", async () => {
    const allMembers = Array.from({ length: 101 }, (_, index) =>
      directoryMember(index),
    );
    mocks.createDirectoryMembershipWithAudit.mockImplementation(
      async (input) => {
        if (input.clerkUserId === "user_100") throw new Error("synthetic");
        return {
          id: input.clerkUserId,
          tenantId: input.tenantId,
          clerkUserId: input.clerkUserId,
          role: input.role,
          displayName: input.displayName,
          pilotCallsign: null,
          simbriefUserId: null,
          simbriefVerifiedAt: null,
          navigraphSubject: null,
          navigraphUsername: null,
          navigraphConnectedAt: null,
          status: "active",
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      },
    );

    const result = await syncMembersFromDirectory({
      tenantId: "tenant-1",
      actorMembershipId: "admin-1",
      organizationId: "org-1",
      loadPage: async ({ limit, offset }) => ({
        data: allMembers.slice(offset, offset + limit),
        totalCount: allMembers.length,
      }),
    });

    expect(result.complete).toBe(false);
    expect(result.failures).toContainEqual({
      scope: "membership",
      offset: 100,
      code: "membership_failed",
    });
  });

  it("surfaces last-admin and active-flight guards as actionable conflicts", async () => {
    mocks.administrativelyUpdateMembership.mockResolvedValue({
      kind: "blocked",
      reason: "last_active_admin",
      impact: {
        openFlightCount: 0,
        activeFlightCount: 0,
        openScheduleRequestCount: 0,
        terminalRequestLinkedFlightCount: 0,
      },
    });

    await expect(
      updateMemberAsAdministrator({
        tenantId: "tenant-1",
        actorMembershipId: "admin-1",
        membershipId: "admin-1",
        patch: { role: "pilot" },
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      details: { reason: "last_active_admin" },
    });

    mocks.administrativelyUpdateMembership.mockResolvedValue({
      kind: "blocked",
      reason: "active_flight",
      impact: {
        openFlightCount: 0,
        activeFlightCount: 1,
        openScheduleRequestCount: 0,
        terminalRequestLinkedFlightCount: 0,
      },
    });
    await expect(
      updateMemberAsAdministrator({
        tenantId: "tenant-1",
        actorMembershipId: "admin-1",
        membershipId: "pilot-1",
        patch: { status: "disabled", reassignToMembershipId: "pilot-2" },
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      details: { reason: "active_flight" },
    });
  });
});
