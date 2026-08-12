import { checkBotId } from "botid/server";
import type { MiddlewareHandler } from "hono";

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
