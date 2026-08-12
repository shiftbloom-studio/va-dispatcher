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

export const membersRoutes = new Hono<{ Variables: AppVariables }>();

membersRoutes.use("*", requireAuth);

membersRoutes.get("/members", requireRole("dispatcher"), async (c) => {
  const auth = c.get("auth");
  const rows = await listMemberships(auth.tenantId);
  return c.json({
    items: rows.map((m) => ({
      id: m.id,
      clerkUserId: m.clerkUserId,
      role: m.role,
      displayName: m.displayName,
      pilotCallsign: m.pilotCallsign,
      status: m.status,
      createdAt: m.createdAt,
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
      pilotCallsign: z
        .string()
        .min(1)
        .max(20)
        .transform((s) => s.toUpperCase())
        .nullable()
        .optional(),
      status: z.enum(["active", "invited", "disabled"]).optional(),
    }),
  ),
  async (c) => {
    const auth = c.get("auth");
    const id = c.req.param("id");
    const body = c.req.valid("json");
    const updated = await updateMembership(auth.tenantId, id, body);
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
  const e = env();

  if (e.AUTH_DEV_BYPASS && e.NODE_ENV !== "production") {
    return c.json({
      synced: 0,
      note: "Dev bypass — no Clerk org sync",
    });
  }

  const clerk = getClerkClient();
  const membershipList = await clerk.organizations.getOrganizationMembershipList({
    organizationId: auth.clerkOrgId,
    limit: 100,
  });

  let synced = 0;
  for (const m of membershipList.data) {
    const userId = m.publicUserData?.userId;
    if (!userId) continue;
    const role = mapClerkOrgRole(m.role);
    const displayName =
      [m.publicUserData?.firstName, m.publicUserData?.lastName]
        .filter(Boolean)
        .join(" ") || m.publicUserData?.identifier || null;
    await upsertMembership({
      tenantId: auth.tenantId,
      clerkUserId: userId,
      role,
      displayName,
    });
    synced += 1;
  }

  return c.json({ synced });
});
