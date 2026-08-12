import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { AppVariables } from "../middleware/auth.js";
import {
  getClerkClient,
  requireAuth,
  requireRole,
} from "../middleware/auth.js";
import {
  listMemberships,
  updateMembership,
  upsertMembership,
} from "../db/repositories/memberships.js";
import { mapClerkOrgRole } from "../domain/members/roles.js";
import { AppError } from "../lib/errors.js";
import { env } from "../env.js";
import { acarsStationSchema } from "../domain/acars/validation.js";
import { isUniqueViolation } from "../lib/postgres.js";

export const membersRoutes = new Hono<{ Variables: AppVariables }>();

membersRoutes.use("*", requireAuth);

membersRoutes.get("/members", requireRole("dispatcher"), async (c) => {
  const auth = c.get("auth");
  const memberships = await listMemberships(auth.tenantId);
  return c.json({
    items: memberships.map((membership) => ({
      id: membership.id,
      clerkUserId: membership.clerkUserId,
      role: membership.role,
      displayName: membership.displayName,
      pilotCallsign: membership.pilotCallsign,
      status: membership.status,
      createdAt: membership.createdAt,
    })),
  });
});

membersRoutes.patch(
  "/members/:id",
  requireRole("admin"),
  zValidator(
    "json",
    z.object({
      role: z.enum(["pilot", "dispatcher", "admin"]).optional(),
      displayName: z.string().min(1).max(120).nullable().optional(),
      pilotCallsign: acarsStationSchema.nullable().optional(),
      status: z.enum(["active", "invited", "disabled"]).optional(),
    }),
  ),
  async (c) => {
    const auth = c.get("auth");
    const id = c.req.param("id");
    const body = c.req.valid("json");
    let updated: Awaited<ReturnType<typeof updateMembership>>;
    try {
      updated = await updateMembership(auth.tenantId, id, body);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError(
          "CONFLICT",
          "This ACARS callsign is already assigned to another member",
        );
      }
      throw error;
    }
    if (!updated) throw new AppError("NOT_FOUND", "Member not found");
    return c.json({
      id: updated.id,
      role: updated.role,
      displayName: updated.displayName,
      pilotCallsign: updated.pilotCallsign,
      status: updated.status,
    });
  },
);

membersRoutes.post("/members/sync", requireRole("dispatcher"), async (c) => {
  const auth = c.get("auth");
  const config = env();

  if (config.AUTH_DEV_BYPASS && config.NODE_ENV !== "production") {
    return c.json({
      synced: 0,
      note: "Dev bypass — no Clerk org sync",
    });
  }

  const clerkClient = getClerkClient();
  const organizationMemberships =
    await clerkClient.organizations.getOrganizationMembershipList({
      organizationId: auth.clerkOrgId,
      limit: 100,
    });

  let syncedCount = 0;
  for (const organizationMembership of organizationMemberships.data) {
    const userId = organizationMembership.publicUserData?.userId;
    if (!userId) continue;
    const role = mapClerkOrgRole(organizationMembership.role);
    const displayName =
      [
        organizationMembership.publicUserData?.firstName,
        organizationMembership.publicUserData?.lastName,
      ]
        .filter(Boolean)
        .join(" ") ||
      organizationMembership.publicUserData?.identifier ||
      null;
    await upsertMembership({
      tenantId: auth.tenantId,
      clerkUserId: userId,
      role,
      displayName,
    });
    syncedCount += 1;
  }

  return c.json({ synced: syncedCount });
});
