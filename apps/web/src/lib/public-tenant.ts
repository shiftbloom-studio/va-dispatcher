import "server-only";

import { cache } from "react";

import { ApiError } from "@/lib/api/http";
import { publicTenantSchema } from "@/lib/api/schemas";
import { serverPublicApi } from "@/lib/api/server";
import {
  getTenantConfig,
  tenantConfigFromDetail,
  type TenantConfig,
} from "@/lib/tenant";

export const getPublicTenantConfig = cache(
  async (slug: string): Promise<TenantConfig | null> => {
    const fallback = getTenantConfig(slug);
    try {
      const tenant = await serverPublicApi(
        `/public/tenants/${encodeURIComponent(slug)}`,
        publicTenantSchema,
      );
      return tenantConfigFromDetail(tenant, fallback);
    } catch (error) {
      if (fallback) return fallback;
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  },
);
