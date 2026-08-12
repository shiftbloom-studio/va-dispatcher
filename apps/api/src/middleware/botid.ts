import { checkBotId } from "botid/server";
import type { MiddlewareHandler } from "hono";

import { isE2eFixtureAuthorized } from "../lib/e2e-fixture.js";
import type { AppVariables } from "./auth.js";

export type BotIdCheckLevel = "basic" | "deepAnalysis";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const DEEP_ANALYSIS_ROUTES = new Set([
  "POST /api/v1/acars/messages",
  "POST /api/v1/flights/bulk",
  "POST /api/v1/members/sync",
  "PUT /api/v1/tenant/acars-config",
  "POST /api/v1/tenant/acars-config/test",
]);

function publicApiPath(path: string): string {
  return path.startsWith("/v1/") ? `/api${path}` : path;
}

export function botIdCheckLevel(
  method: string,
  path: string,
): BotIdCheckLevel | null {
  const normalizedPath = publicApiPath(path);
  if (
    !normalizedPath.startsWith("/api/v1/") ||
    normalizedPath.startsWith("/api/v1/internal/") ||
    !MUTATING_METHODS.has(method.toUpperCase())
  ) {
    return null;
  }

  return DEEP_ANALYSIS_ROUTES.has(`${method.toUpperCase()} ${normalizedPath}`)
    ? "deepAnalysis"
    : "basic";
}

export const requireHuman: MiddlewareHandler<{
  Variables: AppVariables;
}> = async (c, next) => {
  const checkLevel = botIdCheckLevel(c.req.method, c.req.path);
  if (!checkLevel) {
    await next();
    return;
  }

  // Integrated E2E uses a dedicated, non-production authority and a browser
  // request through the real API. It must not depend on Vercel's challenge
  // service, but the ordinary dev-auth bypass alone never skips BotID.
  if (isE2eFixtureAuthorized(c.req.header("X-E2E-Fixture-Token"))) {
    await next();
    return;
  }

  const verification = await checkBotId({
    advancedOptions: { checkLevel },
  });
  if (verification.isBot) {
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
