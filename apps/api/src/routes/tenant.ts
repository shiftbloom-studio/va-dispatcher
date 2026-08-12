import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { AppVariables } from "../middleware/auth.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  findTenantById,
  updateTenant,
} from "../db/repositories/tenants.js";
import { AppError } from "../lib/errors.js";
import { encryptSecret } from "../lib/crypto.js";
import { env } from "../env.js";
import { writeAudit } from "../db/repositories/audit.js";

export const tenantRoutes = new Hono<{ Variables: AppVariables }>();

tenantRoutes.use("*", requireAuth);

tenantRoutes.get("/tenant", async (c) => {
  const auth = c.get("auth");
  const tenant = await findTenantById(auth.tenantId);
  if (!tenant) throw new AppError("NOT_FOUND", "Tenant not found");
  return c.json({
    id: tenant.id,
    slug: tenant.slug,
    name: tenant.name,
    hoppieStation: tenant.hoppieStation,
    hasHoppieLogon: Boolean(tenant.hoppieLogonEnc),
    settings: tenant.settings,
  });
});

tenantRoutes.patch(
  "/tenant",
  requireRole("admin"),
  zValidator(
    "json",
    z.object({
      name: z.string().min(1).max(120).optional(),
      settings: z.record(z.string(), z.unknown()).optional(),
    }),
  ),
  async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    const updated = await updateTenant(auth.tenantId, body);
    if (!updated) throw new AppError("NOT_FOUND", "Tenant not found");
    await writeAudit({
      tenantId: auth.tenantId,
      actorMembershipId: auth.membershipId,
      action: "tenant.patch",
      entityType: "tenant",
      entityId: auth.tenantId,
      meta: { fields: Object.keys(body) },
    });
    return c.json({
      id: updated.id,
      slug: updated.slug,
      name: updated.name,
      settings: updated.settings,
    });
  },
);

tenantRoutes.put(
  "/tenant/acars-config",
  requireRole("admin"),
  zValidator(
    "json",
    z.object({
      hoppieStation: z.string().min(1).max(20),
      hoppieLogon: z.string().min(1).max(64).optional(),
    }),
  ),
  async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    const patch: {
      hoppieStation: string;
      hoppieLogonEnc?: string;
    } = {
      hoppieStation: body.hoppieStation.toUpperCase(),
    };
    if (body.hoppieLogon) {
      patch.hoppieLogonEnc = encryptSecret(
        body.hoppieLogon,
        env().TENANT_SECRETS_KEY,
      );
    }
    const updated = await updateTenant(auth.tenantId, patch);
    if (!updated) throw new AppError("NOT_FOUND", "Tenant not found");
    await writeAudit({
      tenantId: auth.tenantId,
      actorMembershipId: auth.membershipId,
      action: "tenant.acars_config",
      entityType: "tenant",
      entityId: auth.tenantId,
      meta: { hoppieStation: patch.hoppieStation, logonSet: Boolean(body.hoppieLogon) },
    });
    return c.json({
      hoppieStation: updated.hoppieStation,
      hasHoppieLogon: Boolean(updated.hoppieLogonEnc),
    });
  },
);
