export type TenantConfig = {
  slug: string;
  name: string;
  shortName: string;
  accent: string;
};

const tenants: Record<string, TenantConfig> = {
  vsas: {
    slug: "vsas",
    name: "Virtual SAS",
    shortName: "vSAS",
    accent: "#e64646",
  },
};

export function getTenantConfig(slug: string): TenantConfig | null {
  return tenants[slug.toLowerCase()] ?? null;
}
