import { Hono } from "hono";
import { findTenantBySlug } from "../db/repositories/tenants.js";
import { serializeBrand } from "../domain/tenants/brand.js";
import { memberAccessSettings } from "../domain/tenants/member-access.js";
import { AppError } from "../lib/errors.js";

export const publicRoutes = new Hono();

/** Public, deliberately narrow identity used before Clerk sign-in. */
publicRoutes.get("/public/tenants/:slug", async (c) => {
  const tenant = await findTenantBySlug(c.req.param("slug").toLowerCase());
  if (!tenant) throw new AppError("NOT_FOUND", "Virtual Airline not found");
  return c.json({
    slug: tenant.slug,
    name: tenant.name,
    brand: serializeBrand(tenant),
    memberAccess: memberAccessSettings(tenant.settings),
  });
});
