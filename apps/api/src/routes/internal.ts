import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { env } from "../env.js";
import { AppError } from "../lib/errors.js";
import { pollAllTenants } from "../domain/acars/service.js";
import { upsertTenantBySlug } from "../db/repositories/tenants.js";
import { upsertMembership } from "../db/repositories/memberships.js";
import { hasDatabase } from "../db/client.js";
import { isMockAcarsEnabled } from "../acars/factory.js";
import { runPrivacyLifecycleCron } from "../domain/privacy/service.js";

export const internalRoutes = new Hono();

function assertCronAuth(authHeader: string | undefined) {
  const secret = env().CRON_SECRET;
  if (!authHeader || authHeader !== `Bearer ${secret}`) {
    throw new AppError("UNAUTHORIZED", "Invalid cron secret");
  }
}

internalRoutes.on(["GET", "POST"], "/internal/cron/acars-poll", async (c) => {
  assertCronAuth(c.req.header("authorization"));
  // The local test adapter never needs a background poll or a database wakeup.
  if (isMockAcarsEnabled()) {
    return c.json({
      ok: true,
      tenants: 0,
      messages: 0,
      skipped: "deployment-level Hoppie polling is disabled",
    });
  }
  if (!hasDatabase()) {
    return c.json({ ok: false, error: "no database" }, 503);
  }
  const pollResult = await pollAllTenants();
  return c.json({ ok: true, ...pollResult });
});

internalRoutes.on(
  ["GET", "POST"],
  "/internal/cron/privacy-lifecycle",
  zValidator(
    "query",
    z.object({
      maxRuns: z.coerce.number().int().min(1).max(25).default(10),
    }),
  ),
  async (c) => {
    assertCronAuth(c.req.header("authorization"));
    if (!hasDatabase()) {
      return c.json({ ok: false, error: "no database" }, 503);
    }
    const result = await runPrivacyLifecycleCron({
      maxRuns: c.req.valid("query").maxRuns,
    });
    return c.json({ ok: true, ...result });
  },
);

internalRoutes.post(
  "/internal/seed/vsas",
  zValidator(
    "json",
    z
      .object({
        clerkOrgId: z.string().optional(),
        adminClerkUserId: z.string().optional(),
        hoppieStation: z.string().optional(),
      })
      .optional(),
  ),
  async (c) => {
    // Allow seed with cron secret or when AUTH_DEV_BYPASS
    const config = env();
    const authorizationHeader = c.req.header("authorization");
    const isSeedAuthorized =
      authorizationHeader === `Bearer ${config.CRON_SECRET}` ||
      (config.AUTH_DEV_BYPASS && config.NODE_ENV !== "production");
    if (!isSeedAuthorized) {
      throw new AppError("UNAUTHORIZED", "Seed not authorized");
    }
    if (!hasDatabase()) {
      throw new AppError("INTERNAL", "DATABASE_URL required", { status: 503 });
    }

    const body = c.req.valid("json") ?? {};
    const clerkOrgId =
      body.clerkOrgId ?? config.VSAS_CLERK_ORG_ID ?? "org_vsas_dev";

    const tenant = await upsertTenantBySlug({
      slug: "vsas",
      name: "vSAS",
      clerkOrgId,
      hoppieStation: (body.hoppieStation ?? "VSAS").toUpperCase(),
    });

    let adminMembership = null;
    if (body.adminClerkUserId) {
      adminMembership = await upsertMembership({
        tenantId: tenant.id,
        clerkUserId: body.adminClerkUserId,
        role: "admin",
        displayName: "vSAS Admin",
        pilotCallsign: null,
      });
    }

    return c.json({
      ok: true,
      tenant: {
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        clerkOrgId: tenant.clerkOrgId,
        hoppieStation: tenant.hoppieStation,
      },
      adminMembershipId: adminMembership?.id ?? null,
    });
  },
);
