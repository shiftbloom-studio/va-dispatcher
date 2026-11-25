import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import { bindDatabase } from "./db/client.js";

/** Cloudflare bindings declared in wrangler.jsonc. */
export interface WorkerBindings {
  DB: D1Database;
  TENANT_LOGOS?: R2Bucket;
}

let logoBucket: R2Bucket | null = null;

/**
 * Registers the Worker bindings for this isolate. Called on every fetch and
 * scheduled event; bindings are stable for the isolate's lifetime.
 */
export function bindPlatform(bindings: WorkerBindings): void {
  bindDatabase(bindings.DB);
  if (bindings.TENANT_LOGOS) logoBucket = bindings.TENANT_LOGOS;
}

/** R2 bucket holding tenant logos, or null when storage is not configured. */
export function getLogoBucket(): R2Bucket | null {
  return logoBucket;
}

/** Test helper */
export function setLogoBucketForTests(bucket: R2Bucket | null): void {
  logoBucket = bucket;
}
