import { Hono, type MiddlewareHandler } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { isClerkAPIResponseError } from "@clerk/backend/errors";
import type { AppVariables } from "../middleware/auth.js";
import {
  getClerkClient,
  requireAuth,
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
import { env } from "../env.js";
import { acarsStationSchema } from "../domain/acars/validation.js";
import { isUniqueViolation } from "../lib/postgres.js";
import { AppError } from "../lib/errors.js";
import { clerkOrgRole } from "../domain/members/roles.js";
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
    if (clerkBypassed()) return c.json({ items: [], totalCount: 0 });
    try {
      const page =
        await getClerkClient().organizations.getOrganizationInvitationList({
          organizationId: auth.clerkOrgId,
          status: ["pending"],
          ...c.req.valid("query"),
        });
      return c.json({
        items: page.data.map(publicInvitation),
        totalCount: page.totalCount,
      });
    } catch (error) {
      throw publicClerkError(error, "Clerk invitations could not be loaded");
    }
  },
);

membersRoutes.post(
  "/members/invitations",
  requireRole("admin"),
  zValidator("json", invitationInputSchema),
  async (c) => {
    const auth = c.get("auth");
    if (clerkBypassed()) {
      throw new AppError(
        "UNPROCESSABLE",
        "Clerk invitations are unavailable in development auth-bypass mode",
      );
    }
    const body = c.req.valid("json");
    let invitation;
    try {
      invitation =
        await getClerkClient().organizations.createOrganizationInvitation({
          organizationId: auth.clerkOrgId,
          inviterUserId: auth.clerkUserId,
          emailAddress: body.emailAddress,
          role: clerkOrgRole(body.role),
          expiresInDays: memberAccessSettings(auth.tenant.settings)
            .invitationExpiryDays,
          redirectUrl: invitationRedirectUrl(auth.tenant.slug),
          publicMetadata: {
            vaDispatchRole: body.role,
            tenantSlug: auth.tenant.slug,
          },
        });
    } catch (error) {
      throw publicClerkError(error, "Clerk could not create the invitation", {
        notFound:
          "Clerk could not find the configured organization or selected tenant role",
        conflict:
          "Clerk already has a pending invitation or organization membership for this email",
        conflictCodes: [
          "organization_invitation_not_unique",
          "already_a_member_in_organization",
        ],
        forbidden:
          "Clerk does not allow this organization invitation. Verify organization invitation support, tenant role configuration, and membership capacity",
        unprocessable:
          "Clerk rejected the invitation. Verify that organization invitations are enabled, the selected tenant role exists, and the invitation return URL is allowed",
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
    if (clerkBypassed()) {
      throw new AppError(
        "UNPROCESSABLE",
        "Clerk invitations are unavailable in development auth-bypass mode",
      );
    }
    let invitation;
    try {
      invitation =
        await getClerkClient().organizations.revokeOrganizationInvitation({
          organizationId: auth.clerkOrgId,
          invitationId: c.req.param("invitationId"),
          requestingUserId: auth.clerkUserId,
        });
    } catch (error) {
      throw publicClerkError(error, "Clerk could not revoke the invitation");
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
    if (!clerkBypassed()) {
      await ensureClerkMembership({
        organizationId: auth.clerkOrgId,
        clerkUserId: membership.clerkUserId,
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
      clerkSynchronized: !clerkBypassed(),
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
      clerkSynchronized: true,
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
    const needsClerkSync =
      nextStatus === "active" &&
      (current.status !== "active" || nextRole !== current.role);
    if (needsClerkSync && !clerkBypassed()) {
      await ensureClerkMembership({
        organizationId: auth.clerkOrgId,
        clerkUserId: current.clerkUserId,
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
        clerkSynchronized: !needsClerkSync || !clerkBypassed(),
      });
    } catch (error) {
      if (needsClerkSync && !clerkBypassed()) {
        try {
          await ensureClerkMembership({
            organizationId: auth.clerkOrgId,
            clerkUserId: current.clerkUserId,
            role: current.role,
          });
        } catch {
          // The application membership remains authoritative and unchanged.
          // A later explicit save or directory sync can repair Clerk drift.
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

    const clerkSynchronized = clerkBypassed()
      ? false
      : await removeClerkMembership({
          organizationId: auth.clerkOrgId,
          clerkUserId: membership.clerkUserId,
        });
    let completionAuditRecorded = false;
    if (clerkSynchronized) {
      try {
        await writeAudit({
          tenantId: auth.tenantId,
          actorMembershipId: auth.membershipId,
          action: "membership.kicked",
          entityType: "membership",
          entityId: membership.id,
          meta: { clerkMembershipRemoved: true },
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
      clerkSynchronized,
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
      note: "Dev bypass — no Clerk org sync",
    });
  }

  const clerkClient = getClerkClient();
  const result = await syncMembersFromDirectory({
    tenantId: auth.tenantId,
    actorMembershipId: auth.membershipId,
    organizationId: auth.clerkOrgId,
    loadPage: (page) =>
      clerkClient.organizations.getOrganizationMembershipList(page),
  });
  return c.json(result);
});

function publicMember(membership: {
  id: string;
  clerkUserId: string;
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
    clerkUserId: membership.clerkUserId,
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

async function ensureClerkMembership(input: {
  organizationId: string;
  clerkUserId: string;
  role: "pilot" | "dispatcher" | "admin";
}): Promise<void> {
  const client = getClerkClient();
  try {
    const existing = await client.organizations.getOrganizationMembershipList({
      organizationId: input.organizationId,
      userId: [input.clerkUserId],
      limit: 1,
    });
    const payload = {
      organizationId: input.organizationId,
      userId: input.clerkUserId,
      role: clerkOrgRole(input.role),
    };
    if (existing.data.length > 0) {
      await client.organizations.updateOrganizationMembership(payload);
    } else {
      await client.organizations.createOrganizationMembership(payload);
    }
  } catch (error) {
    throw publicClerkError(
      error,
      "Clerk could not synchronize the organization membership",
    );
  }
}

async function removeClerkMembership(input: {
  organizationId: string;
  clerkUserId: string;
}): Promise<boolean> {
  const client = getClerkClient();
  try {
    const existing = await client.organizations.getOrganizationMembershipList({
      organizationId: input.organizationId,
      userId: [input.clerkUserId],
      limit: 1,
    });
    if (existing.data.length > 0) {
      await client.organizations.deleteOrganizationMembership({
        organizationId: input.organizationId,
        userId: input.clerkUserId,
      });
    }
    return true;
  } catch {
    return false;
  }
}

function publicInvitation(invitation: {
  id: string;
  emailAddress: string;
  role: string;
  status?: "pending" | "accepted" | "revoked" | "expired";
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
}) {
  return {
    id: invitation.id,
    emailAddress: invitation.emailAddress,
    role: invitation.role,
    status: invitation.status ?? "pending",
    createdAt: new Date(invitation.createdAt).toISOString(),
    updatedAt: new Date(invitation.updatedAt).toISOString(),
    expiresAt: new Date(invitation.expiresAt).toISOString(),
  };
}

function invitationRedirectUrl(slug: string): string {
  const config = env();
  const origin = config.APP_ORIGIN ?? config.CORS_ORIGIN.split(",")[0]?.trim();
  if (!origin) {
    throw new AppError(
      "INTERNAL",
      "APP_ORIGIN or CORS_ORIGIN is required for organization invitations",
      { status: 503 },
    );
  }
  // Clerk appends its organization-invitation ticket and account status to
  // this public page. The embedded SignIn component handles both existing
  // users and the transfer to sign-up for new users; the protected tenant root
  // cannot do that without dropping the ticket.
  return new URL(`/${slug}/sign-in`, origin).toString();
}

function clerkBypassed(): boolean {
  const config = env();
  return config.AUTH_DEV_BYPASS && config.NODE_ENV !== "production";
}

function publicClerkError(
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
  if (isClerkAPIResponseError(error)) {
    if (
      statusMessages.conflict &&
      statusMessages.conflictCodes?.some((code) =>
        error.errors.some((clerkError) => clerkError.code === code),
      )
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
      return new AppError("UPSTREAM", "Clerk rate limit reached; try later", {
        status: 429,
        cause: error,
      });
    }
  }
  return new AppError("UPSTREAM", message, { cause: error });
}
