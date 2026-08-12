import { createMiddleware } from "hono/factory";
import { createClerkClient, verifyToken } from "@clerk/backend";
import { env } from "../env.js";
import { AppError } from "../lib/errors.js";
import {
  findMembership,
  upsertMembership,
} from "../db/repositories/memberships.js";
import {
  findTenantByClerkOrgId,
  upsertTenantBySlug,
} from "../db/repositories/tenants.js";
import { mapClerkOrgRole } from "../domain/members/roles.js";
import type { MemberRole } from "../db/schema.js";
import { hasDatabase } from "../db/client.js";

export type AuthContext = {
  clerkUserId: string;
  tenantId: string;
  membershipId: string;
  role: MemberRole;
  clerkOrgId: string;
};

export type AppVariables = {
  auth: AuthContext;
};

function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

/**
 * Authenticate + resolve tenant membership.
 *
 * Production: Clerk JWT with org claim.
 * Dev bypass: AUTH_DEV_BYPASS=true and headers:
 *   X-Dev-User-Id, X-Dev-Org-Id, X-Dev-Role (optional)
 */
export const requireAuth = createMiddleware<{ Variables: AppVariables }>(
  async (c, next) => {
    if (!hasDatabase()) {
      throw new AppError(
        "INTERNAL",
        "DATABASE_URL is required for authenticated routes",
        { status: 503 },
      );
    }

    const e = env();

    if (e.AUTH_DEV_BYPASS && e.NODE_ENV !== "production") {
      const clerkUserId = c.req.header("X-Dev-User-Id") ?? "user_dev";
      const clerkOrgId =
        c.req.header("X-Dev-Org-Id") ?? e.VSAS_CLERK_ORG_ID ?? "org_vsas_dev";
      const role = mapClerkOrgRole(c.req.header("X-Dev-Role") ?? "admin");

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
        displayName: "Dev User",
      });

      c.set("auth", {
        clerkUserId,
        tenantId: tenant.id,
        membershipId: membership.id,
        role: membership.role,
        clerkOrgId,
      });
      await next();
      return;
    }

    if (!e.CLERK_SECRET_KEY) {
      throw new AppError(
        "INTERNAL",
        "CLERK_SECRET_KEY is not configured",
        { status: 503 },
      );
    }

    const token = bearerToken(c.req.header("Authorization"));
    if (!token) {
      throw new AppError("UNAUTHORIZED", "Missing bearer token");
    }

    let payload: {
      sub?: string;
      org_id?: string;
      o?: { id?: string; rol?: string };
      org_role?: string;
    };
    try {
      payload = (await verifyToken(token, {
        secretKey: e.CLERK_SECRET_KEY,
      })) as typeof payload;
    } catch (err) {
      throw new AppError("UNAUTHORIZED", "Invalid token", { cause: err });
    }

    const clerkUserId = payload.sub;
    const clerkOrgId = payload.org_id ?? payload.o?.id;
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
    if (!tenant && clerkOrgId === e.VSAS_CLERK_ORG_ID) {
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
    if (!membership) {
      // Auto-provision pilot membership on first login
      membership = await upsertMembership({
        tenantId: tenant.id,
        clerkUserId,
        role: mapClerkOrgRole(payload.org_role ?? payload.o?.rol),
      });
    }

    if (membership.status !== "active") {
      throw new AppError("FORBIDDEN", "Membership is not active");
    }

    c.set("auth", {
      clerkUserId,
      tenantId: tenant.id,
      membershipId: membership.id,
      role: membership.role,
      clerkOrgId,
    });

    await next();
  },
);

export function requireRole(minRole: MemberRole) {
  return createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
    const auth = c.get("auth");
    const rank = { pilot: 1, dispatcher: 2, admin: 3 } as const;
    if (rank[auth.role] < rank[minRole]) {
      throw new AppError("FORBIDDEN", `Requires ${minRole} or higher`);
    }
    await next();
  });
}

export function getClerkClient() {
  const key = env().CLERK_SECRET_KEY;
  if (!key) {
    throw new AppError("INTERNAL", "CLERK_SECRET_KEY is not configured", {
      status: 503,
    });
  }
  return createClerkClient({ secretKey: key });
}
