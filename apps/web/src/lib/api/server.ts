import "server-only";

import { unstable_cache } from "next/cache";
import type { z } from "zod";

import { requestJson } from "@/lib/api/http";
import { apiServiceFetch } from "@/lib/api/service-binding";

/** Placeholder origin for service-binding requests; the host is not resolved. */
const SERVICE_BINDING_ORIGIN = "https://api.internal";

async function apiTransport(): Promise<{
  origin: string;
  fetcher?: typeof fetch;
}> {
  const configured = process.env.API_INTERNAL_URL ?? process.env.API_ORIGIN;
  if (configured) return { origin: configured };
  const fetcher = await apiServiceFetch();
  if (fetcher) return { origin: SERVICE_BINDING_ORIGIN, fetcher };
  return { origin: "http://127.0.0.1:3001" };
}

export async function serverApi<TSchema extends z.ZodType>(
  path: string,
  token: string,
  schema: TSchema,
  headers?: HeadersInit,
): Promise<z.output<TSchema>> {
  const { origin, fetcher } = await apiTransport();
  return requestJson(`${origin}/api/v1${path}`, {
    schema,
    token,
    headers,
    fetcher,
  });
}

/** Revalidation window and tag for public, signed-out tenant data. */
export const PUBLIC_API_REVALIDATE_SECONDS = 60;
export const PUBLIC_API_CACHE_TAG = "public-api";

/**
 * Public, unauthenticated reads. Responses are identical for every visitor,
 * so they are kept in the shared data cache (Workers KV in production) and
 * refreshed every minute. Never route per-user requests through here.
 */
export function serverPublicApi<TSchema extends z.ZodType>(
  path: string,
  schema: TSchema,
): Promise<z.output<TSchema>> {
  const load = unstable_cache(
    async () => {
      const { origin, fetcher } = await apiTransport();
      return requestJson(`${origin}/api/v1${path}`, { schema, fetcher });
    },
    ["public-api", path],
    {
      revalidate: PUBLIC_API_REVALIDATE_SECONDS,
      tags: [PUBLIC_API_CACHE_TAG, `${PUBLIC_API_CACHE_TAG}:${path}`],
    },
  );
  return load();
}
