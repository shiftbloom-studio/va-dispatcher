import { env } from "../../env.js";

/** Public route prefix that streams tenant logos out of R2. */
export const TENANT_LOGO_ROUTE = "/api/v1/public/tenant-logos/";
const KEY_PREFIX = "tenant-logos/";
const KEY_PATTERN = /^tenant-logos\/[a-z0-9-]+\/[0-9a-f-]{36}\.(png|jpg|webp)$/;

/**
 * Absolute URL for a stored logo key. The web app and API share one origin
 * (`/api/*` routes to the API Worker), so APP_ORIGIN is preferred and the
 * request origin covers local development.
 */
export function tenantLogoUrl(key: string, requestUrl: string): string {
  const origin = env().APP_ORIGIN ?? new URL(requestUrl).origin;
  return new URL(
    `${TENANT_LOGO_ROUTE}${key.slice(KEY_PREFIX.length)}`,
    origin,
  ).toString();
}

/** Maps a public path suffix back to its R2 key, rejecting anything else. */
export function tenantLogoKey(suffix: string): string | null {
  const key = `${KEY_PREFIX}${suffix}`;
  return KEY_PATTERN.test(key) ? key : null;
}
