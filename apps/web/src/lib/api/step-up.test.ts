import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api/http";
import { stepUpLocation } from "@/lib/api/use-api";

const here = { pathname: "/vsas/admin/members", search: "?tab=roles" };

function stepUpError(reason: string) {
  return new ApiError({
    status: 403,
    code: "STEP_UP_REQUIRED",
    message: "Confirm it's you with your passkey to continue.",
    details: { stepUp: { reason, maxAge: 600 } },
  });
}

describe("stepUpLocation", () => {
  it("sends a stale sign-in through stem and back to the same page", () => {
    const location = new URL(
      stepUpLocation(stepUpError("stale"), here)!,
      "https://va.example.test",
    );
    expect(location.pathname).toBe("/auth/login");
    expect(location.searchParams.get("step_up")).toBe("1");
    expect(location.searchParams.get("returnTo")).toBe(
      "/vsas/admin/members?tab=roles",
    );
  });

  it("does not loop when the person has no passkey", () => {
    expect(stepUpLocation(stepUpError("passkey"), here)).toBeNull();
  });

  it("ignores other errors", () => {
    expect(
      stepUpLocation(
        new ApiError({ status: 403, code: "FORBIDDEN", message: "No" }),
        here,
      ),
    ).toBeNull();
    expect(stepUpLocation(new Error("offline"), here)).toBeNull();
  });
});
