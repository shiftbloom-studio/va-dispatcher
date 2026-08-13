import { describe, expect, it } from "vitest";

import {
  DEFAULT_MEMBER_ACCESS_SETTINGS,
  memberAccessSettings,
  memberRoleApplicationsEnabled,
  withMemberAccessSettings,
} from "./member-access.js";

describe("tenant member access settings", () => {
  it("uses a complete safe default for existing tenants", () => {
    expect(memberAccessSettings({})).toEqual(DEFAULT_MEMBER_ACCESS_SETTINGS);
  });

  it("preserves valid choices while defaulting malformed stored values", () => {
    expect(
      memberAccessSettings({
        memberAccess: {
          applicationsEnabled: "yes",
          pilotApplicationsEnabled: false,
          dispatcherApplicationsEnabled: true,
          invitationExpiryDays: 365,
        },
      }),
    ).toEqual({
      applicationsEnabled: true,
      pilotApplicationsEnabled: false,
      dispatcherApplicationsEnabled: true,
      invitationExpiryDays: 30,
    });
  });

  it("stores member access without overwriting unrelated tenant settings", () => {
    expect(
      withMemberAccessSettings(
        { units: "metric", nested: { retained: true } },
        {
          applicationsEnabled: false,
          pilotApplicationsEnabled: true,
          dispatcherApplicationsEnabled: false,
          invitationExpiryDays: 14,
        },
      ),
    ).toEqual({
      units: "metric",
      nested: { retained: true },
      memberAccess: {
        applicationsEnabled: false,
        pilotApplicationsEnabled: true,
        dispatcherApplicationsEnabled: false,
        invitationExpiryDays: 14,
      },
    });
  });

  it("requires the global switch and role switch to allow applications", () => {
    const access = {
      applicationsEnabled: true,
      pilotApplicationsEnabled: false,
      dispatcherApplicationsEnabled: true,
      invitationExpiryDays: 30,
    };
    expect(memberRoleApplicationsEnabled(access, "pilot")).toBe(false);
    expect(memberRoleApplicationsEnabled(access, "dispatcher")).toBe(true);
    expect(
      memberRoleApplicationsEnabled(
        { ...access, applicationsEnabled: false },
        "dispatcher",
      ),
    ).toBe(false);
  });
});
