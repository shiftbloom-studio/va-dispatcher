import type {
  FlightStatus,
  Role,
  ScheduleRequestStatus,
} from "@/lib/api/schemas";

export type FlightAction =
  | "accept"
  | "decline"
  | "cancel"
  | "offer"
  | "brief"
  | "activate"
  | "complete"
  | "edit";

export function flightActions(
  role: Role,
  status: FlightStatus,
): FlightAction[] {
  if (role === "pilot") {
    if (status === "offered") return ["accept", "decline"];
    if (status === "accepted" || status === "briefed") return ["cancel"];
    return [];
  }

  switch (status) {
    case "draft":
      return ["edit", "offer", "cancel"];
    case "offered":
      return ["edit", "cancel"];
    case "accepted":
      return ["edit", "brief", "cancel"];
    case "briefed":
      return ["edit", "activate", "cancel"];
    case "active":
      return ["edit", "complete", "cancel"];
    default:
      return [];
  }
}

export function canCancelScheduleRequest(
  status: ScheduleRequestStatus,
): boolean {
  return (
    status === "pending" ||
    status === "in_review" ||
    status === "partially_fulfilled"
  );
}

export function statusLabel(status: string): string {
  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function statusTone(
  status: string,
): "neutral" | "info" | "success" | "warning" | "danger" {
  if (["completed", "fulfilled", "accepted"].includes(status)) return "success";
  if (["offered", "briefed", "in_review", "active"].includes(status))
    return "info";
  if (["pending", "partially_fulfilled", "draft"].includes(status))
    return "warning";
  if (["cancelled", "declined", "rejected"].includes(status)) return "danger";
  return "neutral";
}
