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
  findTenantBySlug,
  upsertTenantBySlug,
} from "../db/repositories/tenants.js";
import { mapOrgRole, roleAtLeast } from "../domain/members/roles.js";
import type { MemberRole, Membership, Tenant } from "../db/schema.js";
import { hasDatabase } from "../db/client.js";
import { verifyAccessToken, type SignIn } from "../auth/token.js";

/** Request header naming the tenant (Virtual Airline slug) a call is about. */
export const TENANT_SLUG_HEADER = "X-Tenant-Slug";

export type AuthContext = {
  authUserId: string;
  tenantId: string;
  membershipId: string;
  role: MemberRole;
  authOrgId: string;
  tenant: Tenant;
  membership: Membership;
  /** Sign-in strength from the access token. Missing means unknown. */
  signIn?: SignIn;
};

export type AuthUserContext = {
  authUserId: string;
  /** Verified profile claims from the access token, when present. */
  email: string | null;
  emailVerified: boolean;
  name: string | null;
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
        email: null,
        emailVerified: false,
        name: context.req.header("X-Dev-Display-Name") ?? null,
      });
      await next();
      return;
    }

    const token = bearerToken(context.req.header("Authorization"));
    if (!token) throw new AppError("UNAUTHORIZED", "Missing bearer token");
    const identity = await verifyAccessToken(token);
    context.set("authUser", {
      authUserId: identity.userId,
      email: identity.email,
      emailVerified: identity.emailVerified,
      name: identity.name,
    });
    await next();
  },
);

/**
 * Authenticate + resolve tenant membership.
 *
 * Production: identity-provider access token with an `orgs` claim. The
 * tenant comes from the X-Tenant-Slug header. Without it, the token's
 * organizations that are registered as tenants decide: the only one, else
 * the primary team when it is one of them.
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
          "Tenant not found for org - seed vSAS first",
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
        // The development bypass has no real sign-in to check.
        signIn: { method: "passkey", at: Math.floor(Date.now() / 1000) },
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
    const tenant = await resolveTenant(
      context.req.header(TENANT_SLUG_HEADER),
      identity.orgs,
      identity.primaryOrg,
      config.VSAS_AUTH_ORG_ID,
    );
    const authOrgId = tenant.authOrgId;

    let membership = await findMembership(tenant.id, authUserId);
    const orgRole = mapOrgRole(identity.orgs[authOrgId]);
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
      signIn: identity.signIn,
    });

    await next();
  },
);

/**
 * Pick the tenant a request is about and check the caller belongs to its
 * identity organization. Access tokens carry every organization of this app
 * the user is in, so membership is a lookup in that map.
 */
async function resolveTenant(
  slugHeader: string | undefined,
  orgs: Record<string, string>,
  primaryOrg: string | null,
  vsasOrgId: string | undefined,
): Promise<Tenant> {
  // The configured identity organization is the source of truth for the
  // initial vSAS tenant. This also repairs a stale org ID after the database
  // or the provider has been reprovisioned without a secret seed call.
  let vsas: Tenant | null = null;
  if (vsasOrgId && orgs[vsasOrgId]) {
    vsas =
      (await findTenantByAuthOrgId(vsasOrgId)) ??
      (await upsertTenantBySlug({
        slug: "vsas",
        name: "vSAS",
        authOrgId: vsasOrgId,
      }));
  }

  const slug = slugHeader?.trim().toLowerCase();
  if (slug) {
    const tenant = vsas?.slug === slug ? vsas : await findTenantBySlug(slug);
    if (!tenant) throw new AppError("NOT_FOUND", "Virtual Airline not found");
    if (!orgs[tenant.authOrgId]) {
      throw new AppError(
        "FORBIDDEN",
        "You are not a member of this Virtual Airline",
      );
    }
    return tenant;
  }

  const orgIds = Object.keys(orgs);
  if (orgIds.length === 0) {
    throw new AppError("FORBIDDEN", "Join a Virtual Airline first");
  }
  // A token can also carry teams that are not airlines here, such as a
  // stem-wide team. Only organizations registered as tenants count.
  const tenants: Tenant[] = [];
  for (const orgId of orgIds) {
    const tenant =
      vsas?.authOrgId === orgId ? vsas : await findTenantByAuthOrgId(orgId);
    if (tenant) tenants.push(tenant);
  }
  if (tenants.length === 1) return tenants[0]!;
  if (tenants.length === 0) {
    throw new AppError(
      "FORBIDDEN",
      "This organization is not registered as a VA tenant",
    );
  }
  const primary = tenants.find((tenant) => tenant.authOrgId === primaryOrg);
  if (primary) return primary;
  throw new AppError(
    "FORBIDDEN",
    `You belong to several Virtual Airlines. Send the ${TENANT_SLUG_HEADER} header to pick one.`,
    { details: { tenants: tenants.map((tenant) => tenant.slug) } },
  );
}

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

/**
 * For sensitive admin actions: the caller must have signed in to stem with a
 * passkey within AUTH_STEP_UP_SECONDS. An email code never passes, so access
 * to someone's inbox alone cannot change roles, credentials or personal data.
 *
 * `details.stepUp.reason` tells the web app what to do:
 * - "stale": the sign-in is too old. Send the person through stem again
 *   (prompt=login), then they retry the action.
 * - "passkey": they just signed in, but not with a passkey. Signing in again
 *   would not help; they need to add a passkey on their stem account first.
 */
export function assertRecentPasskey(auth: AuthContext): void {
  const maxAge = env().AUTH_STEP_UP_SECONDS;
  if (maxAge === 0) return;
  const { signIn } = auth;
  const now = Math.floor(Date.now() / 1000);
  const fresh =
    typeof signIn?.at === "number" &&
    signIn.at <= now + 60 &&
    now - signIn.at <= maxAge;
  if (fresh && signIn?.method === "passkey") return;
  throw new AppError(
    "STEP_UP_REQUIRED",
    fresh
      ? "This action needs a passkey. Add one on your stem account page, then try again."
      : "Confirm it's you with your passkey to continue.",
    { details: { stepUp: { reason: fresh ? "passkey" : "stale", maxAge } } },
  );
}

/** Route middleware form of {@link assertRecentPasskey}. */
export const requireRecentPasskey = createMiddleware<{
  Variables: AppVariables;
}>(async (context, next) => {
  assertRecentPasskey(context.get("auth"));
  await next();
});
