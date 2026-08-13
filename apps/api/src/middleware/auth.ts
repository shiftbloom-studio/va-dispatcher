import { createMiddleware } from "hono/factory";
import { createClerkClient, verifyToken } from "@clerk/backend";
import { env } from "../env.js";
import { AppError } from "../lib/errors.js";
import {
  findMembership,
  provisionMembershipWithAudit,
  recoverMembershipAsTenantAdmin,
  upsertMembership,
} from "../db/repositories/memberships.js";
import {
  findTenantByClerkOrgId,
  upsertTenantBySlug,
} from "../db/repositories/tenants.js";
import { mapClerkOrgRole, roleAtLeast } from "../domain/members/roles.js";
import type { MemberRole, Membership, Tenant } from "../db/schema.js";
import { hasDatabase } from "../db/client.js";

export type AuthContext = {
  clerkUserId: string;
  tenantId: string;
  membershipId: string;
  role: MemberRole;
  clerkOrgId: string;
  tenant: Tenant;
  membership: Membership;
};

export type ClerkUserContext = {
  clerkUserId: string;
};

export type AppVariables = {
  auth: AuthContext;
  clerkUser: ClerkUserContext;
};

function bearerToken(authorizationHeader: string | undefined): string | null {
  if (!authorizationHeader) return null;
  const [scheme, token] = authorizationHeader.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

/** Authenticate a Clerk user without requiring an active organization. */
export const requireClerkUser = createMiddleware<{ Variables: AppVariables }>(
  async (context, next) => {
    if (!hasDatabase()) {
      throw new AppError(
        "INTERNAL",
        "DATABASE_URL is required for authenticated routes",
        { status: 503 },
      );
    }

    const config = env();
    if (config.AUTH_DEV_BYPASS && config.NODE_ENV !== "production") {
      context.set("clerkUser", {
        clerkUserId: context.req.header("X-Dev-User-Id") ?? "user_dev",
      });
      await next();
      return;
    }

    if (!config.CLERK_SECRET_KEY) {
      throw new AppError("INTERNAL", "CLERK_SECRET_KEY is not configured", {
        status: 503,
      });
    }
    const token = bearerToken(context.req.header("Authorization"));
    if (!token) throw new AppError("UNAUTHORIZED", "Missing bearer token");

    let payload: { sub?: string };
    try {
      payload = (await verifyToken(token, {
        secretKey: config.CLERK_SECRET_KEY,
      })) as typeof payload;
    } catch (error) {
      throw new AppError("UNAUTHORIZED", "Invalid token", { cause: error });
    }
    if (!payload.sub) {
      throw new AppError("UNAUTHORIZED", "Token missing subject");
    }
    context.set("clerkUser", { clerkUserId: payload.sub });
    await next();
  },
);

/**
 * Authenticate + resolve tenant membership.
 *
 * Production: Clerk JWT with org claim.
 * Dev bypass: AUTH_DEV_BYPASS=true and headers:
 *   X-Dev-User-Id, X-Dev-Org-Id, X-Dev-Role, X-Dev-Display-Name (optional)
 */
export const requireAuth = createMiddleware<{ Variables: AppVariables }>(
  async (context, next) => {
    if (!hasDatabase()) {
      throw new AppError(
        "INTERNAL",
        "DATABASE_URL is required for authenticated routes",
        { status: 503 },
      );
    }

    const config = env();

    if (config.AUTH_DEV_BYPASS && config.NODE_ENV !== "production") {
      const clerkUserId = context.req.header("X-Dev-User-Id") ?? "user_dev";
      const clerkOrgId =
        context.req.header("X-Dev-Org-Id") ??
        config.VSAS_CLERK_ORG_ID ??
        "org_vsas_dev";
      const role = mapClerkOrgRole(context.req.header("X-Dev-Role") ?? "admin");
      const displayName =
        context.req.header("X-Dev-Display-Name") ?? "Dev User";

      const tenant = await findTenantByClerkOrgId(clerkOrgId);
      if (!tenant) {
        throw new AppError(
          "FORBIDDEN",
          "Tenant not found for org — seed vSAS first",
          { details: { clerkOrgId } },
        );
      }

      const membership = await upsertMembership({
        tenantId: tenant.id,
        clerkUserId,
        role,
        displayName,
      });

      context.set("auth", {
        clerkUserId,
        tenantId: tenant.id,
        membershipId: membership.id,
        role: membership.role,
        clerkOrgId,
        tenant,
        membership,
      });
      await next();
      return;
    }

    if (!config.CLERK_SECRET_KEY) {
      throw new AppError("INTERNAL", "CLERK_SECRET_KEY is not configured", {
        status: 503,
      });
    }

    const token = bearerToken(context.req.header("Authorization"));
    if (!token) {
      throw new AppError("UNAUTHORIZED", "Missing bearer token");
    }

    let jwtPayload: {
      sub?: string;
      org_id?: string;
      o?: { id?: string; rol?: string };
      org_role?: string;
    };
    try {
      jwtPayload = (await verifyToken(token, {
        secretKey: config.CLERK_SECRET_KEY,
      })) as typeof jwtPayload;
    } catch (error) {
      throw new AppError("UNAUTHORIZED", "Invalid token", { cause: error });
    }

    const clerkUserId = jwtPayload.sub;
    const clerkOrgId = jwtPayload.org_id ?? jwtPayload.o?.id;
    if (!clerkUserId) {
      throw new AppError("UNAUTHORIZED", "Token missing subject");
    }
    if (!clerkOrgId) {
      throw new AppError(
        "FORBIDDEN",
        "Active organization required — select your Virtual Airline",
      );
    }

    let tenant = await findTenantByClerkOrgId(clerkOrgId);
    if (!tenant && clerkOrgId === config.VSAS_CLERK_ORG_ID) {
      // The configured Clerk organization is the source of truth for the
      // initial vSAS tenant. This also repairs a stale org ID after Neon or
      // Clerk has been reprovisioned without requiring a secret seed call.
      tenant = await upsertTenantBySlug({
        slug: "vsas",
        name: "vSAS",
        clerkOrgId,
      });
    }
    if (!tenant) {
      throw new AppError(
        "FORBIDDEN",
        "This organization is not registered as a VA tenant",
      );
    }

    let membership = await findMembership(tenant.id, clerkUserId);
    const clerkRole = mapClerkOrgRole(jwtPayload.org_role ?? jwtPayload.o?.rol);
    if (!membership) {
      // Pilot and dispatcher authority can be provisioned from a Clerk role
      // that tenant administration assigned. Admin still requires the narrow
      // no-active-admin recovery path below.
      membership = await provisionMembershipWithAudit({
        tenantId: tenant.id,
        clerkUserId,
        role: clerkRole === "dispatcher" ? "dispatcher" : "pilot",
      });
    }

    // Explicit break-glass recovery: a verified Clerk organization admin may
    // repair their own local membership only when no active app admin exists.
    // Normal role changes continue through the audited admin control plane.
    if (
      clerkRole === "admin" &&
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
      clerkUserId,
      tenantId: tenant.id,
      membershipId: membership.id,
      role: membership.role,
      clerkOrgId,
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

export function getClerkClient() {
  const secretKey = env().CLERK_SECRET_KEY;
  if (!secretKey) {
    throw new AppError("INTERNAL", "CLERK_SECRET_KEY is not configured", {
      status: 503,
    });
  }
  return createClerkClient({ secretKey });
}
