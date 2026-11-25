import { createMiddleware } from "hono/factory";
import { env } from "../env.js";
import { AppError } from "../lib/errors.js";
import {
  findMembership,
  provisionMembershipWithAudit,
  recoverMembershipAsTenantAdmin,
  upsertMembership,
} from "../db/repositories/memberships.js";
import {
  findTenantByAuthOrgId,
  upsertTenantBySlug,
} from "../db/repositories/tenants.js";
import { mapOrgRole, roleAtLeast } from "../domain/members/roles.js";
import type { MemberRole, Membership, Tenant } from "../db/schema.js";
import { hasDatabase } from "../db/client.js";
import { verifyAccessToken } from "../auth/token.js";

export type AuthContext = {
  authUserId: string;
  tenantId: string;
  membershipId: string;
  role: MemberRole;
  authOrgId: string;
  tenant: Tenant;
  membership: Membership;
};

export type AuthUserContext = {
  authUserId: string;
};

export type AppVariables = {
  auth: AuthContext;
  authUser: AuthUserContext;
};

function bearerToken(authorizationHeader: string | undefined): string | null {
  if (!authorizationHeader) return null;
  const [scheme, token] = authorizationHeader.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

/** Authenticate a user without requiring an active organization. */
export const requireUser = createMiddleware<{ Variables: AppVariables }>(
  async (context, next) => {
    if (!hasDatabase()) {
      throw new AppError(
        "INTERNAL",
        "The database binding is required for authenticated routes",
        { status: 503 },
      );
    }

    const config = env();
    if (config.AUTH_DEV_BYPASS && config.NODE_ENV !== "production") {
      context.set("authUser", {
        authUserId: context.req.header("X-Dev-User-Id") ?? "user_dev",
      });
      await next();
      return;
    }

    const token = bearerToken(context.req.header("Authorization"));
    if (!token) throw new AppError("UNAUTHORIZED", "Missing bearer token");
    const identity = await verifyAccessToken(token);
    context.set("authUser", { authUserId: identity.userId });
    await next();
  },
);

/**
 * Authenticate + resolve tenant membership.
 *
 * Production: identity-provider access token with an org claim.
 * Dev bypass: AUTH_DEV_BYPASS=true and headers:
 *   X-Dev-User-Id, X-Dev-Org-Id, X-Dev-Role, X-Dev-Display-Name (optional)
 */
export const requireAuth = createMiddleware<{ Variables: AppVariables }>(
  async (context, next) => {
    if (!hasDatabase()) {
      throw new AppError(
        "INTERNAL",
        "The database binding is required for authenticated routes",
        { status: 503 },
      );
    }

    const config = env();

    if (config.AUTH_DEV_BYPASS && config.NODE_ENV !== "production") {
      const authUserId = context.req.header("X-Dev-User-Id") ?? "user_dev";
      const authOrgId =
        context.req.header("X-Dev-Org-Id") ??
        config.VSAS_AUTH_ORG_ID ??
        "org_vsas_dev";
      const role = mapOrgRole(context.req.header("X-Dev-Role") ?? "admin");
      const displayName =
        context.req.header("X-Dev-Display-Name") ?? "Dev User";

      const tenant = await findTenantByAuthOrgId(authOrgId);
      if (!tenant) {
        throw new AppError(
          "FORBIDDEN",
          "Tenant not found for org — seed vSAS first",
          { details: { authOrgId } },
        );
      }

      const membership = await upsertMembership({
        tenantId: tenant.id,
        authUserId,
        role,
        displayName,
      });

      context.set("auth", {
        authUserId,
        tenantId: tenant.id,
        membershipId: membership.id,
        role: membership.role,
        authOrgId,
        tenant,
        membership,
      });
      await next();
      return;
    }

    const token = bearerToken(context.req.header("Authorization"));
    if (!token) {
      throw new AppError("UNAUTHORIZED", "Missing bearer token");
    }

    const identity = await verifyAccessToken(token);
    const authUserId = identity.userId;
    const authOrgId = identity.orgId;
    if (!authOrgId) {
      throw new AppError(
        "FORBIDDEN",
        "Active organization required — select your Virtual Airline",
      );
    }

    let tenant = await findTenantByAuthOrgId(authOrgId);
    if (!tenant && authOrgId === config.VSAS_AUTH_ORG_ID) {
      // The configured identity organization is the source of truth for the
      // initial vSAS tenant. This also repairs a stale org ID after the database
      // or the provider has been reprovisioned without a secret seed call.
      tenant = await upsertTenantBySlug({
        slug: "vsas",
        name: "vSAS",
        authOrgId,
      });
    }
    if (!tenant) {
      throw new AppError(
        "FORBIDDEN",
        "This organization is not registered as a VA tenant",
      );
    }

    let membership = await findMembership(tenant.id, authUserId);
    const orgRole = mapOrgRole(identity.orgRole);
    if (!membership) {
      // Pilot and dispatcher authority can be provisioned from an org role
      // that tenant administration assigned. Admin still requires the narrow
      // no-active-admin recovery path below.
      membership = await provisionMembershipWithAudit({
        tenantId: tenant.id,
        authUserId,
        role: orgRole === "dispatcher" ? "dispatcher" : "pilot",
      });
    }

    // Explicit break-glass recovery: a verified organization admin may
    // repair their own local membership only when no active app admin exists.
    // Normal role changes continue through the audited admin control plane.
    if (
      orgRole === "admin" &&
      (membership.role !== "admin" || membership.status !== "active")
    ) {
      const recovered = await recoverMembershipAsTenantAdmin({
        tenantId: tenant.id,
        membershipId: membership.id,
      });
      if (recovered) membership = recovered;
    }

    if (membership.status !== "active") {
      throw new AppError("FORBIDDEN", "Membership is not active");
    }

    context.set("auth", {
      authUserId,
      tenantId: tenant.id,
      membershipId: membership.id,
      role: membership.role,
      authOrgId,
      tenant,
      membership,
    });

    await next();
  },
);

export function requireRole(requiredRole: MemberRole) {
  return createMiddleware<{ Variables: AppVariables }>(
    async (context, next) => {
      const auth = context.get("auth");
      if (!roleAtLeast(auth.role, requiredRole)) {
        throw new AppError("FORBIDDEN", `Requires ${requiredRole} or higher`);
      }
      await next();
    },
  );
}
