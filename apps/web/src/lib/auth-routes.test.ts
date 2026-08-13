import { describe, expect, it } from "vitest";

import { getTenantAuthRoutes } from "./auth-routes";

describe("tenant auth routes", () => {
  it("keeps sign-in, sign-up, and session tasks inside the tenant shell", () => {
    expect(getTenantAuthRoutes("vsas")).toEqual({
      home: "/vsas",
      join: "/vsas/join",
      signIn: "/vsas/sign-in",
      signUp: "/vsas/sign-up",
      taskUrls: {
        "choose-organization": "/vsas/tasks/choose-organization",
        "reset-password": "/vsas/tasks/reset-password",
        "setup-mfa": "/vsas/tasks/setup-mfa",
      },
    });
  });
});
