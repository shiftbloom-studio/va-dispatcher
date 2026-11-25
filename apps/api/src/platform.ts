import type { D1Database, Fetcher, R2Bucket } from "@cloudflare/workers-types";
import { bindDatabase } from "./db/client.js";

/** Cloudflare bindings declared in wrangler.jsonc. */
export interface WorkerBindings {
  DB: D1Database;
  TENANT_LOGOS?: R2Bucket;
  /**
   * Service binding to the identity provider's Worker (stem). Requests to the
   * issuer origin go through it, so they skip the zone's bot protection,
   * which challenges Worker-to-Worker calls over the public hostname.
   */
  IDENTITY?: Fetcher;
}

let logoBucket: R2Bucket | null = null;
let identityBinding: Fetcher | null = null;

/**
 * Registers the Worker bindings for this isolate. Called on every fetch and
 * scheduled event; bindings are stable for the isolate's lifetime.
 */
export function bindPlatform(bindings: WorkerBindings): void {
  bindDatabase(bindings.DB);
  if (bindings.TENANT_LOGOS) logoBucket = bindings.TENANT_LOGOS;
  identityBinding = bindings.IDENTITY ?? null;
}

/** Test helper */
export function setIdentityBindingForTests(binding: Fetcher | null): void {
  identityBinding = binding;
}

function requestUrl(input: string | URL | Request): URL {
  if (input instanceof URL) return input;
  return new URL(typeof input === "string" ? input : input.url);
}

/**
 * fetch() for identity provider calls (discovery, JWKS, tokens, directory).
 * Uses the IDENTITY service binding for URLs on the issuer's origin when it
 * is bound, and the public network otherwise.
 */
export function identityFetch(
  issuer: string,
): (input: string | URL | Request, init?: RequestInit) => Promise<Response> {
  return (input, init) => {
    const binding = identityBinding;
    if (binding && requestUrl(input).origin === new URL(issuer).origin) {
      return binding.fetch(
        new Request(input, init) as never,
      ) as unknown as Promise<Response>;
    }
    return fetch(input, init);
  };
}

/** R2 bucket holding tenant logos, or null when storage is not configured. */
export function getLogoBucket(): R2Bucket | null {
  return logoBucket;
}

/** Test helper */
export function setLogoBucketForTests(bucket: R2Bucket | null): void {
  logoBucket = bucket;
}
