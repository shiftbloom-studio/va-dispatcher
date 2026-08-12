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

const tenants: Record<string, TenantConfig> = {
  vsas: {
    slug: "vsas",
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
