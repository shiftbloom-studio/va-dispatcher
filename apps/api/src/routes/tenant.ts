import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { AppVariables } from "../middleware/auth.js";
import {
  getClerkClient,
  requireAuth,
  requireRole,
} from "../middleware/auth.js";
import { findTenantById, updateTenant } from "../db/repositories/tenants.js";
import { AppError } from "../lib/errors.js";
import { decryptSecret, encryptSecret } from "../lib/crypto.js";
import { env } from "../env.js";
import { writeAudit } from "../db/repositories/audit.js";
import { activeAcarsProviderName } from "../acars/factory.js";
import { HoppieAcarsProvider } from "../acars/hoppie-provider.js";
import { del, put } from "@vercel/blob";
import {
  acarsStationSchema,
  hoppieLogonSchema,
} from "../domain/acars/validation.js";
import { publicProviderError } from "../domain/acars/service.js";
import type { Tenant } from "../db/schema.js";
import { serializeBrand } from "../domain/tenants/brand.js";
import {
  TENANT_LOGO_MAX_BYTES,
  validateTenantLogo,
} from "../domain/tenants/logo.js";
import {
  memberAccessSettings,
  withMemberAccessSettings,
} from "../domain/tenants/member-access.js";

export const tenantRoutes = new Hono<{ Variables: AppVariables }>();

const memberAccessSchema = z
  .object({
    applicationsEnabled: z.boolean(),
    pilotApplicationsEnabled: z.boolean(),
    dispatcherApplicationsEnabled: z.boolean(),
    invitationExpiryDays: z.number().int().min(1).max(30),
  })
  .superRefine((value, context) => {
    if (
      value.applicationsEnabled &&
      !value.pilotApplicationsEnabled &&
      !value.dispatcherApplicationsEnabled
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Enable pilot or dispatcher applications before opening applications",
      });
    }
  });

tenantRoutes.use("/tenant", requireAuth);
tenantRoutes.use("/tenant/*", requireAuth);

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
    brand: serializeBrand(tenant),
    settings: tenant.settings,
    memberAccess: memberAccessSettings(tenant.settings),
  });
});

tenantRoutes.patch(
  "/tenant",
  requireRole("admin"),
  zValidator(
    "json",
    z
      .object({
        name: z.string().trim().min(1).max(120).optional(),
        settings: z.record(z.string(), z.unknown()).optional(),
        memberAccess: memberAccessSchema.optional(),
      })
      .superRefine((value, context) => {
        if (
          value.settings &&
          Object.prototype.hasOwnProperty.call(value.settings, "memberAccess")
        ) {
          context.addIssue({
            code: "custom",
            path: ["settings", "memberAccess"],
            message: "Update membership access through the memberAccess field",
          });
        }
      })
      .refine((value) => Object.keys(value).length > 0, {
        message: "At least one tenant field must be supplied",
      }),
  ),
  async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    const current = await requireTenant(auth.tenantId);
    const config = env();
    let clerkSynchronized = true;
    const clerkNameChanged = Boolean(body.name && body.name !== current.name);
    if (clerkNameChanged) {
      if (config.AUTH_DEV_BYPASS && config.NODE_ENV !== "production") {
        clerkSynchronized = false;
      } else {
        try {
          await getClerkClient().organizations.updateOrganization(
            auth.clerkOrgId,
            { name: body.name },
          );
        } catch (error) {
          throw new AppError(
            "UPSTREAM",
            "Clerk could not update the organization name; no local settings were changed",
            { cause: error },
          );
        }
      }
    }
    const baseSettings = { ...current.settings, ...(body.settings ?? {}) };
    const settings = body.memberAccess
      ? withMemberAccessSettings(baseSettings, body.memberAccess)
      : body.settings
        ? baseSettings
        : undefined;
    let updated: Tenant | null;
    try {
      updated = await updateTenant(auth.tenantId, {
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(settings === undefined ? {} : { settings }),
      });
    } catch (error) {
      if (clerkNameChanged && clerkSynchronized) {
        try {
          await getClerkClient().organizations.updateOrganization(
            auth.clerkOrgId,
            { name: current.name },
          );
        } catch {
          // Preserve the original database error. The next explicit save can
          // converge the provider name, and no local authority was changed.
        }
      }
      throw error;
    }
    if (!updated) {
      if (clerkNameChanged && clerkSynchronized) {
        try {
          await getClerkClient().organizations.updateOrganization(
            auth.clerkOrgId,
            { name: current.name },
          );
        } catch {
          // The tenant vanished locally; do not mask that primary condition.
        }
      }
      throw new AppError("NOT_FOUND", "Tenant not found");
    }
    await writeAudit({
      tenantId: auth.tenantId,
      actorMembershipId: auth.membershipId,
      action: "tenant.patch",
      entityType: "tenant",
      entityId: auth.tenantId,
      meta: { fields: Object.keys(body), clerkSynchronized },
    });
    return c.json({
      id: updated.id,
      slug: updated.slug,
      name: updated.name,
      settings: updated.settings,
      memberAccess: memberAccessSettings(updated.settings),
      clerkSynchronized,
    });
  },
);

tenantRoutes.patch(
  "/tenant/brand",
  requireRole("admin"),
  zValidator(
    "json",
    z.object({
      seedColor: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/, "Use a six-digit hex color")
        .transform((value) => value.toLowerCase()),
      presence: z.enum(["restrained", "balanced", "high"]),
    }),
  ),
  async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    const updated = await updateTenant(auth.tenantId, {
      brandSeedColor: body.seedColor,
      brandPresence: body.presence,
    });
    if (!updated) throw new AppError("NOT_FOUND", "Tenant not found");
    await writeAudit({
      tenantId: auth.tenantId,
      actorMembershipId: auth.membershipId,
      action: "tenant.brand_update",
      entityType: "tenant",
      entityId: auth.tenantId,
      meta: { seedColor: body.seedColor, presence: body.presence },
    });
    return c.json({ brand: serializeBrand(updated) });
  },
);

tenantRoutes.post("/tenant/brand/logo", requireRole("admin"), async (c) => {
  const auth = c.get("auth");
  const tenant = await requireTenant(auth.tenantId);
  const token = env().BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new AppError(
      "UNPROCESSABLE",
      "Organization logo storage is not configured",
    );
  }

  const form = await c.req.raw.formData();
  const candidate = form.get("logo");
  if (!(candidate instanceof File)) {
    throw new AppError("UNPROCESSABLE", "Choose a logo image to upload");
  }
  const extension = await validateTenantLogo(candidate);
  const pathname = `tenant-logos/${tenant.slug}/${crypto.randomUUID()}.${extension}`;

  let uploaded: Awaited<ReturnType<typeof put>>;
  try {
    uploaded = await put(pathname, candidate, {
      access: "public",
      addRandomSuffix: false,
      contentType: candidate.type,
      maximumSizeInBytes: TENANT_LOGO_MAX_BYTES,
      token,
    });
  } catch (error) {
    throw new AppError("UPSTREAM", "The logo could not be stored", {
      cause: error,
    });
  }

  const updated = await updateTenant(auth.tenantId, {
    brandLogoUrl: uploaded.url,
    brandLogoPathname: uploaded.pathname,
  });
  if (!updated) {
    await safeDeleteBlob(uploaded.pathname, token);
    throw new AppError("NOT_FOUND", "Tenant not found");
  }

  await writeAudit({
    tenantId: auth.tenantId,
    actorMembershipId: auth.membershipId,
    action: "tenant.brand_logo_upload",
    entityType: "tenant",
    entityId: auth.tenantId,
    meta: { pathname: uploaded.pathname, bytes: candidate.size },
  });
  if (tenant.brandLogoPathname) {
    await safeDeleteBlob(tenant.brandLogoPathname, token);
  }
  return c.json({ brand: serializeBrand(updated) }, 201);
});

tenantRoutes.delete("/tenant/brand/logo", requireRole("admin"), async (c) => {
  const auth = c.get("auth");
  const tenant = await requireTenant(auth.tenantId);
  const updated = await updateTenant(auth.tenantId, {
    brandLogoUrl: null,
    brandLogoPathname: null,
  });
  if (!updated) throw new AppError("NOT_FOUND", "Tenant not found");

  await writeAudit({
    tenantId: auth.tenantId,
    actorMembershipId: auth.membershipId,
    action: "tenant.brand_logo_clear",
    entityType: "tenant",
    entityId: auth.tenantId,
    meta: {},
  });
  const token = env().BLOB_READ_WRITE_TOKEN;
  if (tenant.brandLogoPathname && token) {
    await safeDeleteBlob(tenant.brandLogoPathname, token);
  }
  return c.json({ brand: serializeBrand(updated) });
});

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
  const lastTestedAt = (acars as Record<string, unknown>).hoppieLastTestedAt;
  return typeof lastTestedAt === "string" ? lastTestedAt : null;
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

async function safeDeleteBlob(pathname: string, token: string): Promise<void> {
  try {
    await del(pathname, { token });
  } catch (error) {
    console.error(`Failed to remove replaced tenant logo ${pathname}`, error);
  }
}
