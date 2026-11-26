"use client";

import { useParams } from "next/navigation";
import { useCallback } from "react";
import type { z } from "zod";

import { ApiError, requestJson } from "@/lib/api/http";
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

/**
 * Sensitive admin actions need a recent passkey sign-in. When the sign-in is
 * too old the API answers STEP_UP_REQUIRED with reason "stale": send the
 * person through stem again and bring them back here to retry. Reason
 * "passkey" (they just signed in with an email code) is shown as an error,
 * because signing in again would loop.
 */
export function stepUpLocation(
  error: unknown,
  current: { pathname: string; search: string },
): string | null {
  if (!(error instanceof ApiError) || error.code !== "STEP_UP_REQUIRED") {
    return null;
  }
  const reason = (error.details as { stepUp?: { reason?: unknown } } | null)
    ?.stepUp?.reason;
  if (reason !== "stale") return null;
  const params = new URLSearchParams({
    step_up: "1",
    returnTo: `${current.pathname}${current.search}`,
  });
  return `/auth/login?${params.toString()}`;
}

const STEP_UP_STORAGE_KEY = "va-step-up-at";

/** One step-up per two minutes, so a provider problem cannot loop. */
function recentStepUp(): boolean {
  try {
    const at = Number(sessionStorage.getItem(STEP_UP_STORAGE_KEY));
    return Number.isFinite(at) && Date.now() - at < 120_000;
  } catch {
    return false;
  }
}

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
      try {
        return await requestJson(`/api/v1${path}`, {
          ...options,
          headers,
          token,
        });
      } catch (error) {
        const location = stepUpLocation(error, window.location);
        if (location && !recentStepUp()) {
          try {
            sessionStorage.setItem(STEP_UP_STORAGE_KEY, String(Date.now()));
          } catch {
            // Storage blocked: the redirect still works, just without the guard.
          }
          window.location.assign(location);
        }
        throw error;
      }
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
