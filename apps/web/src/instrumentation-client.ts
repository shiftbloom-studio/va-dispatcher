import { initBotId } from "botid/client/core";

const deepAnalysisRoutes = [
  ["/api/v1/acars/messages", "POST"],
  ["/api/v1/flights/bulk", "POST"],
  ["/api/v1/members/sync", "POST"],
  ["/api/v1/tenant/acars-config", "PUT"],
  ["/api/v1/tenant/acars-config/test", "POST"],
] as const;

// Exact Deep Analysis routes must precede the Basic wildcards because BotID
// uses the first matching client rule.
initBotId({
  protect: [
    ...deepAnalysisRoutes.map(([path, method]) => ({
      path,
      method,
      advancedOptions: { checkLevel: "deepAnalysis" as const },
    })),
    ...["POST", "PUT", "PATCH", "DELETE"].map((method) => ({
      path: "/api/v1/*",
      method,
      advancedOptions: { checkLevel: "basic" as const },
    })),
  ],
});
