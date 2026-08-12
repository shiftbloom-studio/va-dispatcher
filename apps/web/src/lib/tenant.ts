export type TenantConfig = {
  slug: string;
  name: string;
  shortName: string;
  accent: string;
  logo: {
    src: string;
    alt: string;
  };
};

export const DEFAULT_TENANT_SLUG = "vsas";

const tenants: Record<string, TenantConfig> = {
  [DEFAULT_TENANT_SLUG]: {
    slug: DEFAULT_TENANT_SLUG,
    name: "Virtual SAS",
    shortName: "vSAS",
    accent: "#e64646",
    logo: {
      src: "/tenants/vsas/logo.jpg",
      alt: "Virtual SAS logo",
    },
  },
};

export function getTenantConfig(slug: string): TenantConfig | null {
  return tenants[slug.toLowerCase()] ?? null;
}
