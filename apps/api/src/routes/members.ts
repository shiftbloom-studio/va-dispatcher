import { Hono, type MiddlewareHandler } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { AppVariables } from "../middleware/auth.js";
import {
  assertRecentPasskey,
  requireAuth,
  requireRecentPasskey,
  requireRole,
} from "../middleware/auth.js";
import {
  findMembershipById,
  listMemberships,
} from "../db/repositories/memberships.js";
import {
  getAdministrativeMemberImpact,
  syncMembersFromDirectory,
  updateMemberAsAdministrator,
} from "../domain/members/service.js";
import { env, resolveAppOrigin } from "../env.js";
import { acarsStationSchema } from "../domain/acars/validation.js";
import { isUniqueViolation } from "../lib/db-errors.js";
import { AppError } from "../lib/errors.js";
import {
  DirectoryError,
  getDirectory,
  type DirectoryInvitation,
} from "../auth/directory.js";
import { memberAccessSettings } from "../domain/tenants/member-access.js";
import { writeAudit } from "../db/repositories/audit.js";

export const membersRoutes = new Hono<{ Variables: AppVariables }>();

const membersQuerySchema = z.object({
  search: z.string().trim().min(1).max(120).optional(),
  role: z.enum(["pilot", "dispatcher", "admin"]).optional(),
  status: z.enum(["active", "invited", "disabled"]).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(100),
});

const memberUpdateSchema = z
  .object({
    role: z.enum(["pilot", "dispatcher", "admin"]).optional(),
    displayName: z.string().trim().min(1).max(120).nullable().optional(),
    pilotCallsign: acarsStationSchema.nullable().optional(),
    status: z.enum(["active", "invited", "disabled"]).optional(),
    reassignToMembershipId: z.string().uuid().optional(),
  })
  .superRefine((value, context) => {
    const changedFields = [
      value.role,
      value.displayName,
      value.pilotCallsign,
      value.status,
    ];
    if (changedFields.every((field) => field === undefined)) {
      context.addIssue({
        code: "custom",
        message: "At least one member field must be supplied",
      });
    }
    const explicitlyBecomesIneligible =
      (value.status !== undefined && value.status !== "active") ||
      (value.role !== undefined && value.role !== "pilot");
    if (value.reassignToMembershipId && !explicitlyBecomesIneligible) {
      context.addIssue({
        code: "custom",
        path: ["reassignToMembershipId"],
        message:
          "A replacement can only be supplied when making a pilot inactive or changing them to a non-pilot role",
      });
    }
  });

const invitationQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const invitationInputSchema = z.object({
  emailAddress: z.string().trim().email().max(320),
  role: z.enum(["pilot", "dispatcher"]),
});

const applicationDecisionSchema = z.object({
  role: z.enum(["pilot", "dispatcher"]).optional(),
  reassignToMembershipId: z.string().uuid().optional(),
});

const kickMemberSchema = z.object({
  reassignToMembershipId: z.string().uuid().optional(),
});

membersRoutes.use("/members", requireAuth);
membersRoutes.use("/members/*", requireAuth);

// Member directory and work-impact responses are tenant-confidential and may
// contain stable identity fields. Never permit shared/browser cache reuse.
const privateMemberResponse: MiddlewareHandler<{
  Variables: AppVariables;
}> = async (c, next) => {
  await next();
  c.header("Cache-Control", "private, no-store");
};
membersRoutes.use("/members", privateMemberResponse);
membersRoutes.use("/members/*", privateMemberResponse);

membersRoutes.get(
  "/members/invitations",
  requireRole("admin"),
  zValidator("query", invitationQuerySchema),
  async (c) => {
    const auth = c.get("auth");
    if (directoryBypassed()) return c.json({ items: [], totalCount: 0 });
    try {
      const page = await getDirectory().listInvitations({
        orgId: auth.authOrgId,
        ...c.req.valid("query"),
      });
      return c.json({
        items: page.data.map(publicInvitation),
        totalCount: page.totalCount,
      });
    } catch (error) {
      throw publicDirectoryError(error, "Invitations could not be loaded");
    }
  },
);

membersRoutes.post(
  "/members/invitations",
  requireRole("admin"),
  zValidator("json", invitationInputSchema),
  async (c) => {
    const auth = c.get("auth");
    if (directoryBypassed()) {
      throw new AppError(
        "UNPROCESSABLE",
        "Invitations are unavailable in development auth-bypass mode",
      );
    }
    const body = c.req.valid("json");
    const redirectUrl = invitationRedirectUrl(auth.tenant.slug);
    let invitation;
    try {
      invitation = await getDirectory().createInvitation({
        orgId: auth.authOrgId,
        inviterUserId: auth.authUserId,
        emailAddress: body.emailAddress,
        role: body.role,
        expiresInDays: memberAccessSettings(auth.tenant.settings)
          .invitationExpiryDays,
        redirectUrl,
        metadata: {
          vaDispatchRole: body.role,
          tenantSlug: auth.tenant.slug,
        },
      });
    } catch (error) {
      throw publicDirectoryError(error, "The invitation could not be created", {
        notFound:
          "The identity provider could not find the organization or selected tenant role",
        conflict:
          "This email already has a pending invitation or organization membership",
        conflictCodes: [
          "organization_invitation_not_unique",
          "already_a_member_in_organization",
        ],
        forbidden:
          "The identity provider does not allow this invitation. Verify the tenant role configuration and membership capacity",
        unprocessable:
          "The identity provider rejected the invitation. Verify that the selected tenant role exists and the invitation return URL is allowed",
      });
    }
    let auditRecorded = true;
    try {
      await writeAudit({
        tenantId: auth.tenantId,
        actorMembershipId: auth.membershipId,
        action: "membership.invitation_created",
        entityType: "organization_invitation",
        entityId: invitation.id,
        meta: {
          role: body.role,
          expiresAt: new Date(invitation.expiresAt).toISOString(),
        },
      });
    } catch {
      auditRecorded = false;
    }
    return c.json({ invitation: publicInvitation(invitation), auditRecorded });
  },
);

membersRoutes.delete(
  "/members/invitations/:invitationId",
  requireRole("admin"),
  async (c) => {
    const auth = c.get("auth");
    if (directoryBypassed()) {
      throw new AppError(
        "UNPROCESSABLE",
        "Invitations are unavailable in development auth-bypass mode",
      );
    }
    let invitation;
    try {
      invitation = await getDirectory().revokeInvitation({
        orgId: auth.authOrgId,
        invitationId: c.req.param("invitationId"),
        requestingUserId: auth.authUserId,
      });
    } catch (error) {
      throw publicDirectoryError(error, "The invitation could not be revoked");
    }
    let auditRecorded = true;
    try {
      await writeAudit({
        tenantId: auth.tenantId,
        actorMembershipId: auth.membershipId,
        action: "membership.invitation_revoked",
        entityType: "organization_invitation",
        entityId: invitation.id,
        meta: { role: invitation.role },
      });
    } catch {
      auditRecorded = false;
    }
    return c.json({ invitation: publicInvitation(invitation), auditRecorded });
  },
);

membersRoutes.post(
  "/members/:id/application/approve",
  requireRole("admin"),
  zValidator("json", applicationDecisionSchema),
  async (c) => {
    const auth = c.get("auth");
    const membership = await requireApplication(
      auth.tenantId,
      c.req.param("id"),
    );
    const body = c.req.valid("json");
    const role =
      body.role ?? (membership.role === "admin" ? "pilot" : membership.role);
    if (!directoryBypassed()) {
      await ensureDirectoryMembership({
        organizationId: auth.authOrgId,
        authUserId: membership.authUserId,
        role,
      });
    }
    const result = await updateMemberAsAdministrator({
      tenantId: auth.tenantId,
      actorMembershipId: auth.membershipId,
      membershipId: membership.id,
      patch: {
        role,
        status: "active",
        reassignToMembershipId: body.reassignToMembershipId,
      },
      auditAction: "membership.application_approved",
    });
    return c.json({
      ...publicMember(result.membership),
      reassignedFlightCount: result.reassignedFlightCount,
      reassignedScheduleRequestCount: result.reassignedScheduleRequestCount,
      directorySynchronized: !directoryBypassed(),
    });
  },
);

membersRoutes.post(
  "/members/:id/application/reject",
  requireRole("admin"),
  async (c) => {
    const auth = c.get("auth");
    const membership = await requireApplication(
      auth.tenantId,
      c.req.param("id"),
    );
    const result = await updateMemberAsAdministrator({
      tenantId: auth.tenantId,
      actorMembershipId: auth.membershipId,
      membershipId: membership.id,
      patch: { status: "disabled" },
      auditAction: "membership.application_rejected",
    });
    return c.json({
      ...publicMember(result.membership),
      reassignedFlightCount: result.reassignedFlightCount,
      reassignedScheduleRequestCount: result.reassignedScheduleRequestCount,
      directorySynchronized: true,
    });
  },
);

membersRoutes.get(
  "/members",
  requireRole("dispatcher"),
  zValidator("query", membersQuerySchema),
  async (c) => {
    const auth = c.get("auth");
    const query = c.req.valid("query");
    const page = await listMemberships({
      tenantId: auth.tenantId,
      ...query,
    });
    return c.json({
      items: page.items.map(publicMember),
      nextCursor: page.nextCursor,
    });
  },
);

membersRoutes.get("/members/:id/impact", requireRole("admin"), async (c) => {
  const auth = c.get("auth");
  const impact = await getAdministrativeMemberImpact({
    tenantId: auth.tenantId,
    membershipId: c.req.param("id"),
  });
  return c.json(impact);
});

membersRoutes.patch(
  "/members/:id",
  requireRole("admin"),
  zValidator("json", memberUpdateSchema),
  async (c) => {
    const auth = c.get("auth");
    const id = c.req.param("id");
    const patch = c.req.valid("json");
    // Profile edits stay quick; changing someone's access needs a passkey.
    if (patch.role !== undefined || patch.status !== undefined) {
      assertRecentPasskey(auth);
    }
    if (patch.reassignToMembershipId === id) {
      throw new AppError("BAD_REQUEST", "A member cannot replace themselves");
    }
    const current = await findMembershipById(auth.tenantId, id);
    if (!current) throw new AppError("NOT_FOUND", "Member not found");
    if (current.status === "invited") {
      throw new AppError(
        "CONFLICT",
        "Approve or reject pending applications through the application review action",
      );
    }
    if (patch.status === "invited") {
      throw new AppError(
        "UNPROCESSABLE",
        "Pending application status can only be created by the applicant",
      );
    }
    const nextRole = patch.role ?? current.role;
    const nextStatus = patch.status ?? current.status;
    const needsDirectorySync =
      nextStatus === "active" &&
      (current.status !== "active" || nextRole !== current.role);
    if (needsDirectorySync && !directoryBypassed()) {
      await ensureDirectoryMembership({
        organizationId: auth.authOrgId,
        authUserId: current.authUserId,
        role: nextRole,
      });
    }
    try {
      const result = await updateMemberAsAdministrator({
        tenantId: auth.tenantId,
        actorMembershipId: auth.membershipId,
        membershipId: id,
        patch,
      });
      return c.json({
        ...publicMember(result.membership),
        reassignedFlightCount: result.reassignedFlightCount,
        reassignedScheduleRequestCount: result.reassignedScheduleRequestCount,
        directorySynchronized: !needsDirectorySync || !directoryBypassed(),
      });
    } catch (error) {
      if (needsDirectorySync && !directoryBypassed()) {
        try {
          await ensureDirectoryMembership({
            organizationId: auth.authOrgId,
            authUserId: current.authUserId,
            role: current.role,
          });
        } catch {
          // The application membership remains authoritative and unchanged.
          // A later explicit save or directory sync can repair provider drift.
        }
      }
      if (isUniqueViolation(error)) {
        throw new AppError(
          "CONFLICT",
          "This ACARS callsign is already assigned to another member",
        );
      }
      throw error;
    }
  },
);

membersRoutes.delete(
  "/members/:id",
  requireRole("admin"),
  requireRecentPasskey,
  zValidator("json", kickMemberSchema),
  async (c) => {
    const auth = c.get("auth");
    const id = c.req.param("id");
    const body = c.req.valid("json");
    if (body.reassignToMembershipId === id) {
      throw new AppError("BAD_REQUEST", "A member cannot replace themselves");
    }
    const current = await findMembershipById(auth.tenantId, id);
    if (!current) throw new AppError("NOT_FOUND", "Member not found");

    let membership = current;
    let reassignedFlightCount = 0;
    let reassignedScheduleRequestCount = 0;
    if (current.status !== "disabled") {
      const result = await updateMemberAsAdministrator({
        tenantId: auth.tenantId,
        actorMembershipId: auth.membershipId,
        membershipId: id,
        patch: {
          status: "disabled",
          reassignToMembershipId: body.reassignToMembershipId,
        },
        auditAction: "membership.kick_requested",
      });
      membership = result.membership;
      reassignedFlightCount = result.reassignedFlightCount;
      reassignedScheduleRequestCount = result.reassignedScheduleRequestCount;
    }

    const directorySynchronized = directoryBypassed()
      ? false
      : await removeDirectoryMembership({
          organizationId: auth.authOrgId,
          authUserId: membership.authUserId,
        });
    let completionAuditRecorded = false;
    if (directorySynchronized) {
      try {
        await writeAudit({
          tenantId: auth.tenantId,
          actorMembershipId: auth.membershipId,
          action: "membership.kicked",
          entityType: "membership",
          entityId: membership.id,
          meta: { directoryMembershipRemoved: true },
        });
        completionAuditRecorded = true;
      } catch {
        // The atomic local disable audit remains the durable security record.
      }
    }
    return c.json({
      ...publicMember(membership),
      reassignedFlightCount,
      reassignedScheduleRequestCount,
      directorySynchronized,
      completionAuditRecorded,
    });
  },
);

membersRoutes.post("/members/sync", requireRole("admin"), async (c) => {
  const auth = c.get("auth");
  const config = env();

  if (config.AUTH_DEV_BYPASS && config.NODE_ENV !== "production") {
    return c.json({
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
      note: "Dev bypass - no directory sync",
    });
  }

  const directory = getDirectory();
  const result = await syncMembersFromDirectory({
    tenantId: auth.tenantId,
    actorMembershipId: auth.membershipId,
    organizationId: auth.authOrgId,
    loadPage: (page) => directory.listMemberships(page),
  });
  return c.json(result);
});

function publicMember(membership: {
  id: string;
  authUserId: string;
  role: "pilot" | "dispatcher" | "admin";
  displayName: string | null;
  pilotCallsign: string | null;
  status: "active" | "invited" | "disabled";
  createdAt: Date;
  updatedAt: Date;
  openFlightCount?: number;
  activeFlightCount?: number;
  openScheduleRequestCount?: number;
  terminalRequestLinkedFlightCount?: number;
}) {
  return {
    id: membership.id,
    authUserId: membership.authUserId,
    role: membership.role,
    requestedRole: membership.status === "invited" ? membership.role : null,
    displayName: membership.displayName,
    pilotCallsign: membership.pilotCallsign,
    status: membership.status,
    createdAt: membership.createdAt,
    updatedAt: membership.updatedAt,
    ...(membership.openFlightCount === undefined
      ? {}
      : {
          openFlightCount: membership.openFlightCount,
          activeFlightCount: membership.activeFlightCount,
          openScheduleRequestCount: membership.openScheduleRequestCount,
          terminalRequestLinkedFlightCount:
            membership.terminalRequestLinkedFlightCount,
        }),
  };
}

async function requireApplication(tenantId: string, membershipId: string) {
  const membership = await findMembershipById(tenantId, membershipId);
  if (!membership) throw new AppError("NOT_FOUND", "Application not found");
  if (membership.status !== "invited") {
    throw new AppError("CONFLICT", "This application is no longer pending");
  }
  return membership;
}

async function ensureDirectoryMembership(input: {
  organizationId: string;
  authUserId: string;
  role: "pilot" | "dispatcher" | "admin";
}): Promise<void> {
  try {
    await getDirectory().setMembershipRole({
      orgId: input.organizationId,
      userId: input.authUserId,
      role: input.role,
    });
  } catch (error) {
    throw publicDirectoryError(
      error,
      "The identity provider could not synchronize the organization membership",
    );
  }
}

async function removeDirectoryMembership(input: {
  organizationId: string;
  authUserId: string;
}): Promise<boolean> {
  try {
    await getDirectory().removeMembership({
      orgId: input.organizationId,
      userId: input.authUserId,
    });
    return true;
  } catch {
    return false;
  }
}

function publicInvitation(invitation: DirectoryInvitation) {
  return {
    id: invitation.id,
    emailAddress: invitation.emailAddress,
    role: invitation.role,
    status: invitation.status,
    createdAt: new Date(invitation.createdAt).toISOString(),
    updatedAt: new Date(invitation.updatedAt).toISOString(),
    expiresAt: new Date(invitation.expiresAt).toISOString(),
  };
}

function invitationRedirectUrl(slug: string): string {
  const origin = resolveAppOrigin();
  if (!origin) {
    throw new AppError(
      "INTERNAL",
      "A public application origin is required for organization invitations",
      { status: 503 },
    );
  }
  // After accepting in stem, the person lands here. A fresh sign-in picks up
  // the new organization role at once; stem's own session makes it quick.
  const url = new URL("/auth/login", origin);
  url.searchParams.set("returnTo", `/${slug}`);
  return url.toString();
}

function directoryBypassed(): boolean {
  const config = env();
  return config.AUTH_DEV_BYPASS && config.NODE_ENV !== "production";
}

function publicDirectoryError(
  error: unknown,
  message: string,
  statusMessages: {
    notFound?: string;
    conflict?: string;
    conflictCodes?: readonly string[];
    forbidden?: string;
    unprocessable?: string;
  } = {},
): AppError {
  if (error instanceof DirectoryError) {
    if (
      statusMessages.conflict &&
      statusMessages.conflictCodes?.some((code) => error.code === code)
    ) {
      return new AppError("CONFLICT", statusMessages.conflict, {
        cause: error,
      });
    }
    if (error.status === 404) {
      return new AppError("NOT_FOUND", statusMessages.notFound ?? message, {
        cause: error,
      });
    }
    if (error.status === 409) {
      return new AppError("CONFLICT", statusMessages.conflict ?? message, {
        cause: error,
      });
    }
    if (error.status === 403 && statusMessages.forbidden) {
      return new AppError("UNPROCESSABLE", statusMessages.forbidden, {
        cause: error,
      });
    }
    if (error.status === 400 || error.status === 422) {
      return new AppError(
        "UNPROCESSABLE",
        statusMessages.unprocessable ?? message,
        { cause: error },
      );
    }
    if (error.status === 429) {
      return new AppError(
        "UPSTREAM",
        "Identity provider rate limit reached; try later",
        {
          status: 429,
          cause: error,
        },
      );
    }
  }
  return new AppError("UPSTREAM", message, { cause: error });
}
