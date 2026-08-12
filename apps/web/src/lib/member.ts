import type { Member } from "@/lib/api/schemas";

export function memberLabel(member: Member | null | undefined): string {
  if (!member) return "Unassigned pilot";
  const callsign = member.pilotCallsign ? ` · ${member.pilotCallsign}` : "";
  return `${member.displayName || "Unnamed member"}${callsign}`;
}
