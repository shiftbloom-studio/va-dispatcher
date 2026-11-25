import { Hono, type MiddlewareHandler } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

import {
  cancelMembershipApplicationWithAudit,
  findMembership,
  submitMembershipApplicationWithAudit,
} from "../db/repositories/memberships.js";
import { findTenantBySlug } from "../db/repositories/tenants.js";
import {
  memberAccessSettings,
  memberRoleApplicationsEnabled,
} from "../domain/tenants/member-access.js";
import { env } from "../env.js";
import {
  requireUser,
  type AppVariables,
  type AuthUserContext,
} from "../middleware/auth.js";
import { AppError } from "../lib/errors.js";
import type { Membership } from "../db/schema.js";

export const membershipApplicationRoutes = new Hono<{
  Variables: AppVariables;
}>();

const tenantSlugSchema = z.string().trim().toLowerCase().min(1).max(80);
const applicationQuerySchema = z.object({ tenantSlug: tenantSlugSchema });
const applicationInputSchema = z.object({
  tenantSlug: tenantSlugSchema,
  requestedRole: z.enum(["pilot", "dispatcher"]),
});

membershipApplicationRoutes.use("/membership-application", requireUser);

const privateApplicationResponse: MiddlewareHandler<{
  Variables: AppVariables;
}> = async (c, next) => {
  await next();
  c.header("Cache-Control", "private, no-store");
};
membershipApplicationRoutes.use(
  "/membership-application",
  privateApplicationResponse,
);

membershipApplicationRoutes.get(
  "/membership-application",
  zValidator("query", applicationQuerySchema),
  async (c) => {
    const { authUserId } = c.get("authUser");
    const tenant = await requireTenant(c.req.valid("query").tenantSlug);
    const membership = await findMembership(tenant.id, authUserId);
    return c.json(applicationResponse(tenant.settings, membership));
  },
);

membershipApplicationRoutes.post(
  "/membership-application",
  zValidator("json", applicationInputSchema),
  async (c) => {
    const authUser = c.get("authUser");
    const { authUserId } = authUser;
    const body = c.req.valid("json");
    const tenant = await requireTenant(body.tenantSlug);
    const access = memberAccessSettings(tenant.settings);
    if (!memberRoleApplicationsEnabled(access, body.requestedRole)) {
      throw new AppError(
        "FORBIDDEN",
        `${body.requestedRole === "pilot" ? "Pilot" : "Dispatcher"} applications are not open for this Virtual Airline`,
      );
    }

    const existing = await findMembership(tenant.id, authUserId);
    if (existing?.status === "active") {
      return c.json(applicationResponse(tenant.settings, existing));
    }

    const displayName = verifiedDisplayName(authUser);
    const result = await submitMembershipApplicationWithAudit({
      tenantId: tenant.id,
      authUserId,
      requestedRole: body.requestedRole,
      displayName,
    });
    return c.json({
      ...applicationResponse(tenant.settings, result.membership),
      submitted: result.submitted,
    });
  },
);

membershipApplicationRoutes.delete(
  "/membership-application",
  zValidator("query", applicationQuerySchema),
  async (c) => {
    const { authUserId } = c.get("authUser");
    const tenant = await requireTenant(c.req.valid("query").tenantSlug);
    const cancelled = await cancelMembershipApplicationWithAudit({
      tenantId: tenant.id,
      authUserId,
    });
    if (!cancelled) {
      throw new AppError(
        "CONFLICT",
        "There is no pending application to cancel",
      );
    }
    return c.json(applicationResponse(tenant.settings, cancelled));
  },
);

async function requireTenant(slug: string) {
  const tenant = await findTenantBySlug(slug);
  if (!tenant) throw new AppError("NOT_FOUND", "Virtual Airline not found");
  return tenant;
}

/**
 * Applicants are not organization members yet, so the identity directory
 * cannot describe them. The verified access token carries the profile.
 */
function verifiedDisplayName(user: AuthUserContext): string | null {
  const config = env();
  if (config.AUTH_DEV_BYPASS && config.NODE_ENV !== "production") {
    return "Dev Applicant";
  }
  if (!user.email || !user.emailVerified) {
    throw new AppError(
      "UNPROCESSABLE",
      "Verify your primary email address before applying",
    );
  }
  return user.name?.trim() || user.email;
}

function applicationResponse(
  settings: Record<string, unknown>,
  membership: Membership | null,
) {
  const access = memberAccessSettings(settings);
  return {
    applicationsEnabled: access.applicationsEnabled,
    allowedRoles: [
      ...(memberRoleApplicationsEnabled(access, "pilot")
        ? (["pilot"] as const)
        : []),
      ...(memberRoleApplicationsEnabled(access, "dispatcher")
        ? (["dispatcher"] as const)
        : []),
    ],
    application: membership
      ? {
          state:
            membership.status === "active"
              ? ("active" as const)
              : membership.status === "invited"
                ? ("pending" as const)
                : ("closed" as const),
          requestedRole:
            membership.role === "dispatcher"
              ? ("dispatcher" as const)
              : ("pilot" as const),
          displayName: membership.displayName,
          submittedAt: membership.createdAt,
          updatedAt: membership.updatedAt,
        }
      : null,
  };
}
