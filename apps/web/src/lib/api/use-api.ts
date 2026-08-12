"use client";

import { useAuth } from "@clerk/nextjs";
import { useCallback } from "react";
import type { z } from "zod";

import { requestJson } from "@/lib/api/http";

type ApiCaller = <TSchema extends z.ZodType>(
  path: string,
  options: Omit<Parameters<typeof requestJson<TSchema>>[1], "token">,
) => Promise<z.output<TSchema>>;

function useClerkApi(): ApiCaller {
  const { getToken } = useAuth();

  return useCallback(
    async <TSchema extends z.ZodType>(
      path: string,
      options: Omit<Parameters<typeof requestJson<TSchema>>[1], "token">,
    ) => {
      const token = await getToken();
      return requestJson(`/api/v1${path}`, { ...options, token });
    },
    [getToken],
  );
}

function useFixtureApi(): ApiCaller {
  return useCallback(
    <TSchema extends z.ZodType>(
      path: string,
      options: Omit<Parameters<typeof requestJson<TSchema>>[1], "token">,
    ) => requestJson(`/api/v1${path}`, options),
    [],
  );
}

const useApiImplementation =
  process.env.NEXT_PUBLIC_E2E_AUTH_BYPASS === "true" &&
  process.env.NODE_ENV !== "production"
    ? useFixtureApi
    : useClerkApi;

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
