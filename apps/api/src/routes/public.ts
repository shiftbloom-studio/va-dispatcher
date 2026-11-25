import { Hono } from "hono";
import { findTenantBySlug } from "../db/repositories/tenants.js";
import { serializeBrand } from "../domain/tenants/brand.js";
import { memberAccessSettings } from "../domain/tenants/member-access.js";
import { AppError } from "../lib/errors.js";
import { getLogoBucket } from "../platform.js";
import { tenantLogoKey } from "../domain/tenants/logo-storage.js";

export const publicRoutes = new Hono();

/** Public, deliberately narrow identity used before sign-in. */
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

/** Streams an organization logo from R2. Keys are random and immutable. */
publicRoutes.get("/public/tenant-logos/:slug/:file", async (c) => {
  const key = tenantLogoKey(`${c.req.param("slug")}/${c.req.param("file")}`);
  const bucket = getLogoBucket();
  const object = key && bucket ? await bucket.get(key) : null;
  if (!object) throw new AppError("NOT_FOUND", "Logo not found");
  const headers = new Headers();
  headers.set(
    "content-type",
    object.httpMetadata?.contentType ?? "application/octet-stream",
  );
  headers.set("cache-control", "public, max-age=31536000, immutable");
  headers.set("etag", object.httpEtag);
  headers.set("x-content-type-options", "nosniff");
  headers.set("content-security-policy", "default-src 'none'; sandbox");
  return new Response(object.body as unknown as ReadableStream, { headers });
});
