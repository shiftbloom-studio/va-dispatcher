import type { MemberRole } from "../../db/schema.js";

export type MemberAccessSettings = {
  applicationsEnabled: boolean;
  pilotApplicationsEnabled: boolean;
  dispatcherApplicationsEnabled: boolean;
  invitationExpiryDays: number;
};

export const DEFAULT_MEMBER_ACCESS_SETTINGS: MemberAccessSettings = {
  applicationsEnabled: true,
  pilotApplicationsEnabled: true,
  dispatcherApplicationsEnabled: true,
  invitationExpiryDays: 30,
};

export function memberAccessSettings(
  settings: Record<string, unknown>,
): MemberAccessSettings {
  const candidate = isRecord(settings.memberAccess)
    ? settings.memberAccess
    : {};
  return {
    applicationsEnabled: booleanOrDefault(
      candidate.applicationsEnabled,
      DEFAULT_MEMBER_ACCESS_SETTINGS.applicationsEnabled,
    ),
    pilotApplicationsEnabled: booleanOrDefault(
      candidate.pilotApplicationsEnabled,
      DEFAULT_MEMBER_ACCESS_SETTINGS.pilotApplicationsEnabled,
    ),
    dispatcherApplicationsEnabled: booleanOrDefault(
      candidate.dispatcherApplicationsEnabled,
      DEFAULT_MEMBER_ACCESS_SETTINGS.dispatcherApplicationsEnabled,
    ),
    invitationExpiryDays:
      typeof candidate.invitationExpiryDays === "number" &&
      Number.isInteger(candidate.invitationExpiryDays) &&
      candidate.invitationExpiryDays >= 1 &&
      candidate.invitationExpiryDays <= 30
        ? candidate.invitationExpiryDays
        : DEFAULT_MEMBER_ACCESS_SETTINGS.invitationExpiryDays,
  };
}

export function withMemberAccessSettings(
  settings: Record<string, unknown>,
  access: MemberAccessSettings,
): Record<string, unknown> {
  return { ...settings, memberAccess: access };
}

export function memberRoleApplicationsEnabled(
  access: MemberAccessSettings,
  role: Exclude<MemberRole, "admin">,
): boolean {
  return (
    access.applicationsEnabled &&
    (role === "pilot"
      ? access.pilotApplicationsEnabled
      : access.dispatcherApplicationsEnabled)
  );
}

function booleanOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
