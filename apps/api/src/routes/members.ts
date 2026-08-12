import { Hono, type MiddlewareHandler } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { AppVariables } from "../middleware/auth.js";
import {
  getClerkClient,
  requireAuth,
  requireRole,
} from "../middleware/auth.js";
import { listMemberships } from "../db/repositories/memberships.js";
import {
  getAdministrativeMemberImpact,
  syncMembersFromDirectory,
  updateMemberAsAdministrator,
} from "../domain/members/service.js";
import { env } from "../env.js";
import { acarsStationSchema } from "../domain/acars/validation.js";
import { isUniqueViolation } from "../lib/postgres.js";
import { AppError } from "../lib/errors.js";

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
    if (c.req.valid("json").reassignToMembershipId === id) {
      throw new AppError("BAD_REQUEST", "A member cannot replace themselves");
    }
    try {
      const result = await updateMemberAsAdministrator({
        tenantId: auth.tenantId,
        actorMembershipId: auth.membershipId,
        membershipId: id,
        patch: c.req.valid("json"),
      });
      return c.json({
        ...publicMember(result.membership),
        reassignedFlightCount: result.reassignedFlightCount,
        reassignedScheduleRequestCount: result.reassignedScheduleRequestCount,
      });
    } catch (error) {
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
