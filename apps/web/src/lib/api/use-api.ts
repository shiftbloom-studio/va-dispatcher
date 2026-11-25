"use client";

import { useParams } from "next/navigation";
import { useCallback } from "react";
import type { z } from "zod";

import { requestJson } from "@/lib/api/http";
import { getAccessToken } from "@/lib/auth/client-token";
import {
  E2E_IDENTITY_COOKIE,
  E2E_IDENTITY_HEADER,
  e2eFixtureEnabled,
  normalizeE2eIdentity,
} from "@/lib/e2e-fixture";

type ApiCaller = <TSchema extends z.ZodType>(
  path: string,
  options: Omit<Parameters<typeof requestJson<TSchema>>[1], "token">,
) => Promise<z.output<TSchema>>;

/** Header naming the Virtual Airline a call is about; the API checks it. */
export const TENANT_SLUG_HEADER = "X-Tenant-Slug";

function useSessionApi(): ApiCaller {
  const params = useParams<{ slug?: string }>();
  const slug = typeof params?.slug === "string" ? params.slug : null;

  return useCallback(
    async <TSchema extends z.ZodType>(
      path: string,
      options: Omit<Parameters<typeof requestJson<TSchema>>[1], "token">,
    ) => {
      const token = (await getAccessToken()) ?? undefined;
      const headers = new Headers(options.headers);
      if (slug) headers.set(TENANT_SLUG_HEADER, slug);
      return requestJson(`/api/v1${path}`, { ...options, headers, token });
    },
    [slug],
  );
}

function useFixtureApi(): ApiCaller {
  return useCallback(
    <TSchema extends z.ZodType>(
      path: string,
      options: Omit<Parameters<typeof requestJson<TSchema>>[1], "token">,
    ) => {
      const identity = normalizeE2eIdentity(
        document.cookie
          .split("; ")
          .find(
            (entry) =>
              entry.startsWith(`${E2E_IDENTITY_COOKIE}=`) ||
              entry.startsWith("e2e-role="),
          )
          ?.split("=", 2)[1],
      );
      const headers = new Headers(options.headers);
      headers.set(E2E_IDENTITY_HEADER, identity);
      return requestJson(`/api/v1${path}`, { ...options, headers });
    },
    [],
  );
}

const useApiImplementation = e2eFixtureEnabled()
  ? useFixtureApi
  : useSessionApi;

export function useApi(): ApiCaller {
  return useApiImplementation();
}

export async function getHealth<TSchema extends z.ZodType>(
  schema: TSchema,
): Promise<z.output<TSchema>> {
  return requestJson("/api/health", { schema });
}

export function jsonBody(
  value: unknown,
): Pick<RequestInit, "body" | "headers"> {
  return {
    body: JSON.stringify(value),
    headers: { "Content-Type": "application/json" },
  };
}
