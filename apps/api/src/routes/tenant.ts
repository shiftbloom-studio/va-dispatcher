import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { AppVariables } from "../middleware/auth.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { findTenantById, updateTenant } from "../db/repositories/tenants.js";
import { AppError } from "../lib/errors.js";
import { decryptSecret, encryptSecret } from "../lib/crypto.js";
import { env } from "../env.js";
import { writeAudit } from "../db/repositories/audit.js";
import { activeAcarsProviderName } from "../acars/factory.js";
import { HoppieAcarsProvider } from "../acars/hoppie-provider.js";
import {
  acarsStationSchema,
  hoppieLogonSchema,
} from "../domain/acars/validation.js";
import { publicProviderError } from "../domain/acars/service.js";
import type { Tenant } from "../db/schema.js";

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
    acarsProvider: activeAcarsProviderName(),
    hoppiePollingEnabled:
      activeAcarsProviderName() === "hoppie" && Boolean(tenant.hoppieLogonEnc),
    hoppieLastTestedAt: hoppieLastTestedAt(tenant.settings),
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
      hoppieStation: acarsStationSchema,
      hoppieLogon: hoppieLogonSchema.optional(),
    }),
  ),
  async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    const tenant = await requireTenant(auth.tenantId);
    const logon =
      body.hoppieLogon ??
      (tenant.hoppieLogonEnc
        ? decryptSecret(tenant.hoppieLogonEnc, env().TENANT_SECRETS_KEY)
        : null);
    if (!logon) {
      throw new AppError(
        "UNPROCESSABLE",
        "Enter the Virtual Airline's Hoppie logon code",
      );
    }

    await testHoppie(logon, body.hoppieStation);
    const testedAt = new Date().toISOString();
    const patch: {
      hoppieStation: string;
      hoppieLogonEnc?: string;
      settings: Record<string, unknown>;
    } = {
      hoppieStation: body.hoppieStation,
      settings: withHoppieLastTestedAt(tenant.settings, testedAt),
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
      meta: {
        hoppieStation: patch.hoppieStation,
        logonChanged: Boolean(body.hoppieLogon),
        testedAt,
      },
    });
    return c.json(acarsConfigResponse(updated));
  },
);

tenantRoutes.post(
  "/tenant/acars-config/test",
  requireRole("admin"),
  async (c) => {
    const auth = c.get("auth");
    const tenant = await requireTenant(auth.tenantId);
    if (!tenant.hoppieLogonEnc || !tenant.hoppieStation) {
      throw new AppError(
        "UNPROCESSABLE",
        "Configure a Hoppie ground station before testing it",
      );
    }

    const logon = decryptSecret(
      tenant.hoppieLogonEnc,
      env().TENANT_SECRETS_KEY,
    );
    await testHoppie(logon, tenant.hoppieStation);
    const testedAt = new Date().toISOString();
    const updated = await updateTenant(auth.tenantId, {
      settings: withHoppieLastTestedAt(tenant.settings, testedAt),
    });
    if (!updated) throw new AppError("NOT_FOUND", "Tenant not found");

    await writeAudit({
      tenantId: auth.tenantId,
      actorMembershipId: auth.membershipId,
      action: "tenant.acars_config_test",
      entityType: "tenant",
      entityId: auth.tenantId,
      meta: { hoppieStation: tenant.hoppieStation, testedAt },
    });

    return c.json(acarsConfigResponse(updated));
  },
);

tenantRoutes.delete("/tenant/acars-config", requireRole("admin"), async (c) => {
  const auth = c.get("auth");
  const tenant = await requireTenant(auth.tenantId);
  const updated = await updateTenant(auth.tenantId, {
    hoppieLogonEnc: null,
    settings: withoutHoppieLastTestedAt(tenant.settings),
  });
  if (!updated) throw new AppError("NOT_FOUND", "Tenant not found");

  await writeAudit({
    tenantId: auth.tenantId,
    actorMembershipId: auth.membershipId,
    action: "tenant.acars_config_clear",
    entityType: "tenant",
    entityId: auth.tenantId,
    meta: { hoppieStation: tenant.hoppieStation },
  });

  return c.json(acarsConfigResponse(updated));
});

async function requireTenant(tenantId: string): Promise<Tenant> {
  const tenant = await findTenantById(tenantId);
  if (!tenant) throw new AppError("NOT_FOUND", "Tenant not found");
  return tenant;
}

async function testHoppie(logon: string, station: string): Promise<void> {
  const provider = new HoppieAcarsProvider({ logon });
  try {
    await provider.ping({ station });
  } catch (error) {
    throw publicProviderError(error);
  }
}

function acarsConfigResponse(tenant: Tenant) {
  return {
    hoppieStation: tenant.hoppieStation,
    hasHoppieLogon: Boolean(tenant.hoppieLogonEnc),
    acarsProvider: activeAcarsProviderName(),
    hoppiePollingEnabled:
      activeAcarsProviderName() === "hoppie" && Boolean(tenant.hoppieLogonEnc),
    hoppieLastTestedAt: hoppieLastTestedAt(tenant.settings),
  };
}

function hoppieLastTestedAt(settings: Record<string, unknown>): string | null {
  const acars = settings.acars;
  if (!acars || typeof acars !== "object" || Array.isArray(acars)) return null;
  const value = (acars as Record<string, unknown>).hoppieLastTestedAt;
  return typeof value === "string" ? value : null;
}

function withHoppieLastTestedAt(
  settings: Record<string, unknown>,
  testedAt: string,
): Record<string, unknown> {
  const current =
    settings.acars &&
    typeof settings.acars === "object" &&
    !Array.isArray(settings.acars)
      ? (settings.acars as Record<string, unknown>)
      : {};
  return {
    ...settings,
    acars: { ...current, hoppieLastTestedAt: testedAt },
  };
}

function withoutHoppieLastTestedAt(
  settings: Record<string, unknown>,
): Record<string, unknown> {
  const current =
    settings.acars &&
    typeof settings.acars === "object" &&
    !Array.isArray(settings.acars)
      ? (settings.acars as Record<string, unknown>)
      : {};
  const { hoppieLastTestedAt: _removed, ...remaining } = current;
  return { ...settings, acars: remaining };
}
