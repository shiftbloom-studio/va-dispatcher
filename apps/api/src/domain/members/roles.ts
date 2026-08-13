import type { MemberRole } from "../../db/schema.js";
import { AppError } from "../../lib/errors.js";

const ROLE_RANK: Record<MemberRole, number> = {
  pilot: 1,
  dispatcher: 2,
  admin: 3,
};

export function roleAtLeast(actual: MemberRole, required: MemberRole): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

export function assertRole(actual: MemberRole, required: MemberRole): void {
  if (!roleAtLeast(actual, required)) {
    throw new AppError("FORBIDDEN", `Requires role ${required} or higher`, {
      details: { required, actual },
    });
  }
}

/** Map Clerk organization role keys to app roles. */
export function mapClerkOrgRole(
  clerkRole: string | null | undefined,
): MemberRole {
  if (!clerkRole) return "pilot";
  const normalized = clerkRole.replace(/^org:/, "").toLowerCase();
  if (normalized === "admin" || normalized === "owner") return "admin";
  if (normalized === "dispatcher") return "dispatcher";
  if (normalized === "pilot" || normalized === "member") return "pilot";
  return "pilot";
}

/** Clerk role keys are instance-defined once and assigned per tenant member. */
export function clerkOrgRole(role: MemberRole): `org:${MemberRole}` {
  return `org:${role}`;
}
