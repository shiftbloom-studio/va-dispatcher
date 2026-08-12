import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { AppVariables } from "../middleware/auth.js";
import { requireAuth } from "../middleware/auth.js";
import {
  findMembership,
  findMembershipByCallsign,
  updateMembership,
} from "../db/repositories/memberships.js";
import { findTenantById } from "../db/repositories/tenants.js";
import { acarsStationSchema } from "../domain/acars/validation.js";
import { AppError } from "../lib/errors.js";
import { writeAudit } from "../db/repositories/audit.js";
import { isUniqueViolation } from "../lib/postgres.js";

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

meRoutes.patch(
  "/me",
  zValidator(
    "json",
    z
      .object({
        displayName: z.string().trim().min(1).max(120).nullable().optional(),
        pilotCallsign: acarsStationSchema.nullable().optional(),
      })
      .refine(
        (value) =>
          value.displayName !== undefined || value.pilotCallsign !== undefined,
        { message: "Provide at least one profile field" },
      ),
  ),
  async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");

    if (body.pilotCallsign) {
      const existing = await findMembershipByCallsign(
        auth.tenantId,
        body.pilotCallsign,
      );
      if (existing && existing.id !== auth.membershipId) {
        throw new AppError(
          "CONFLICT",
          "This ACARS callsign is already assigned to another member",
        );
      }
    }

    let membership: Awaited<ReturnType<typeof updateMembership>>;
    try {
      membership = await updateMembership(
        auth.tenantId,
        auth.membershipId,
        body,
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError(
          "CONFLICT",
          "This ACARS callsign is already assigned to another member",
        );
      }
      throw error;
    }
    if (!membership) throw new AppError("NOT_FOUND", "Membership not found");

    await writeAudit({
      tenantId: auth.tenantId,
      actorMembershipId: auth.membershipId,
      action: "membership.self_update",
      entityType: "membership",
      entityId: auth.membershipId,
      meta: { fields: Object.keys(body) },
    });

    return c.json({
      membership: {
        id: membership.id,
        role: membership.role,
        displayName: membership.displayName,
        pilotCallsign: membership.pilotCallsign,
        status: membership.status,
      },
    });
  },
);
