import type { TenantBrand, TenantDetail } from "@/lib/api/schemas";
import { DEFAULT_BRAND } from "@/lib/brand";

export type TenantConfig = {
  slug: string;
  name: string;
  shortName: string;
  brand: TenantBrand;
  logo: {
    src: string | null;
    alt: string;
  };
};

export const DEFAULT_TENANT_SLUG = "vsas";

const tenants: Record<string, TenantConfig> = {
  [DEFAULT_TENANT_SLUG]: {
    slug: DEFAULT_TENANT_SLUG,
    name: "Virtual SAS",
    shortName: "vSAS",
    brand: DEFAULT_BRAND,
    logo: {
      src: "/tenants/vsas/logo.jpg",
      alt: "Virtual SAS logo",
    },
  },
};

export function getTenantConfig(slug: string): TenantConfig | null {
  return tenants[slug.toLowerCase()] ?? null;
}

export function tenantConfigFromDetail(
  tenant: Pick<TenantDetail, "slug" | "name" | "brand">,
  fallback?: TenantConfig | null,
): TenantConfig {
  return {
    slug: tenant.slug,
    name: tenant.name,
    shortName: fallback?.shortName ?? tenant.name,
    brand: tenant.brand,
    logo: {
      src: tenant.brand.logoUrl ?? fallback?.logo.src ?? null,
      alt: `${tenant.name} logo`,
    },
  };
}
