import { Hono } from "hono";
import type { AppVariables } from "../middleware/auth.js";
import { requireAuth } from "../middleware/auth.js";
import { findMembership } from "../db/repositories/memberships.js";
import { findTenantById } from "../db/repositories/tenants.js";

export const meRoutes = new Hono<{ Variables: AppVariables }>();

meRoutes.use("*", requireAuth);

meRoutes.get("/me", async (c) => {
  const auth = c.get("auth");
  const [membership, tenant] = await Promise.all([
    findMembership(auth.tenantId, auth.clerkUserId),
    findTenantById(auth.tenantId),
  ]);

  return c.json({
    user: {
      clerkUserId: auth.clerkUserId,
    },
    membership: membership
      ? {
          id: membership.id,
          role: membership.role,
          displayName: membership.displayName,
          pilotCallsign: membership.pilotCallsign,
          status: membership.status,
        }
      : null,
    tenant: tenant
      ? {
          id: tenant.id,
          slug: tenant.slug,
          name: tenant.name,
          hoppieStation: tenant.hoppieStation,
        }
      : null,
  });
});
