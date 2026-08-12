import "server-only";

import type { z } from "zod";

import { requestJson } from "@/lib/api/http";

function apiOrigin(): string {
  return (
    process.env.API_INTERNAL_URL ??
    process.env.API_ORIGIN ??
    "http://127.0.0.1:3001"
  );
}

export function serverApi<TSchema extends z.ZodType>(
  path: string,
  token: string,
  schema: TSchema,
): Promise<z.output<TSchema>> {
  return requestJson(`${apiOrigin()}/api/v1${path}`, { schema, token });
}

export function serverPublicApi<TSchema extends z.ZodType>(
  path: string,
  schema: TSchema,
): Promise<z.output<TSchema>> {
  return requestJson(`${apiOrigin()}/api/v1${path}`, { schema });
}
