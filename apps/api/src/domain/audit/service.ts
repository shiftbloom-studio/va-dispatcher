import {
  listAuditEvents,
  type AuditEventFilters,
  type AuditEventListItem,
} from "../../db/repositories/audit.js";
import type { PageResult } from "../../lib/pagination.js";

const REDACTED = "[REDACTED]";
const MAX_META_DEPTH = 8;
const MAX_OBJECT_KEYS = 100;
const MAX_ARRAY_ITEMS = 100;
const MAX_STRING_LENGTH = 500;
const SENSITIVE_EXACT_KEYS = new Set([
  "body",
  "callbackcode",
  "codeverifier",
  "hoppieraw",
  "logon",
  "message",
  "navigraphsubject",
  "ofp",
  "packet",
  "pkceverifier",
  "providerpayload",
  "rawproviderresponse",
  "requestpayload",
  "responsepayload",
  "simbriefuserid",
]);

export async function queryAuditEvents(input: {
  tenantId: string;
  filters: AuditEventFilters;
  cursor?: string;
  limit: number;
}): Promise<PageResult<AuditEventListItem>> {
  const page = await listAuditEvents(input);
  return {
    ...page,
    items: page.items.map((event) => ({
      ...event,
      meta: redactAuditMeta(event.meta) as Record<string, unknown>,
    })),
  };
}

export function redactAuditMeta(value: unknown, depth = 0): unknown {
  if (depth >= MAX_META_DEPTH) return "[MAX_DEPTH]";
  if (typeof value === "string") {
    return value.length <= MAX_STRING_LENGTH
      ? value
      : `${value.slice(0, MAX_STRING_LENGTH)}…`;
  }
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => redactAuditMeta(item, depth + 1));
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value).slice(0, MAX_OBJECT_KEYS)) {
    const normalized = key.replaceAll(/[^a-z0-9]/gi, "").toLowerCase();
    if (
      SENSITIVE_EXACT_KEYS.has(normalized) ||
      normalized.includes("secret") ||
      normalized.includes("token") ||
      normalized.includes("password") ||
      normalized.includes("credential") ||
      normalized.includes("authorization") ||
      normalized.includes("callbacktoken") ||
      normalized.includes("cookie")
    ) {
      sanitized[key] = REDACTED;
    } else {
      sanitized[key] = redactAuditMeta(nested, depth + 1);
    }
  }
  return sanitized;
}
