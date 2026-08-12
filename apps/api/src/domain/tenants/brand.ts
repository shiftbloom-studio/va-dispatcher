import type { Tenant } from "../../db/schema.js";

export const DEFAULT_BRAND_SEED = "#e64646";

export function normalizeBrandSeed(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(normalized)) {
    throw new Error("Brand color must be a six-digit hex color");
  }
  return normalized;
}

export function serializeBrand(tenant: Tenant) {
  return {
    seedColor: tenant.brandSeedColor,
    presence: tenant.brandPresence,
    logoUrl: tenant.brandLogoUrl,
  };
}
