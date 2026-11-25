import { describe, expect, it } from "vitest";

import { getTenantAuthRoutes } from "./auth-routes";

describe("tenant auth routes", () => {
  it("keeps sign-in, sign-up, and joining inside the tenant shell", () => {
    expect(getTenantAuthRoutes("vsas")).toEqual({
      home: "/vsas",
      join: "/vsas/join",
      signIn: "/vsas/sign-in",
      signUp: "/vsas/sign-up",
    });
  });
});
