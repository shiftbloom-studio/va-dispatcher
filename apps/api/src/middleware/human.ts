import type { MiddlewareHandler } from "hono";

import { isE2eFixtureAuthorized } from "../lib/e2e-fixture.js";
import type { AppVariables } from "./auth.js";

export type BotCheckLevel = "basic" | "strict";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const STRICT_ROUTES = new Set([
  "POST /api/v1/acars/messages",
  "POST /api/v1/flights/bulk",
  "POST /api/v1/members/sync",
  "PUT /api/v1/tenant/acars-config",
  "POST /api/v1/tenant/acars-config/test",
]);

/**
 * Lowest Cloudflare bot score that is still accepted. Score 1 means the
 * request is automated; scores below 30 are likely automated.
 */
const MINIMUM_BOT_SCORE: Record<BotCheckLevel, number> = {
  basic: 2,
  strict: 30,
};

function publicApiPath(path: string): string {
  return path.startsWith("/v1/") ? `/api${path}` : path;
}

export function botCheckLevel(
  method: string,
  path: string,
): BotCheckLevel | null {
  const normalizedPath = publicApiPath(path);
  if (
    !normalizedPath.startsWith("/api/v1/") ||
    normalizedPath.startsWith("/api/v1/internal/") ||
    !MUTATING_METHODS.has(method.toUpperCase())
  ) {
    return null;
  }

  return STRICT_ROUTES.has(`${method.toUpperCase()} ${normalizedPath}`)
    ? "strict"
    : "basic";
}

type BotManagement = { score?: number; verifiedBot?: boolean };

function botManagement(request: Request): BotManagement | null {
  const cf = (request as Request & { cf?: { botManagement?: BotManagement } })
    .cf;
  return cf?.botManagement ?? null;
}

/**
 * Rejects automated browser mutations using the bot score Cloudflare attaches
 * to each request. Zones without Bot Management attach no score; there the
 * zone's bot protection and WAF rules are the outer defence and requests pass.
 * Authenticated routes additionally require a verified user session.
 */
export const requireHuman: MiddlewareHandler<{
  Variables: AppVariables;
}> = async (c, next) => {
  const checkLevel = botCheckLevel(c.req.method, c.req.path);
  if (!checkLevel) {
    await next();
    return;
  }

  // Integrated E2E uses a dedicated, non-production authority. The ordinary
  // dev-auth bypass alone never skips the bot check.
  if (isE2eFixtureAuthorized(c.req.header("X-E2E-Fixture-Token"))) {
    await next();
    return;
  }

  const verdict = botManagement(c.req.raw);
  const score = verdict?.score;
  if (
    typeof score === "number" &&
    !verdict?.verifiedBot &&
    score < MINIMUM_BOT_SCORE[checkLevel]
  ) {
    return c.json(
      {
        error: {
          code: "FORBIDDEN",
          message: "Automated requests are not allowed.",
        },
      },
      403,
    );
  }

  await next();
};
