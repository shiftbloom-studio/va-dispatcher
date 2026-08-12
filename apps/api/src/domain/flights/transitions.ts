import type { FlightStatus } from "../../db/schema.js";
import { AppError } from "../../lib/errors.js";

const ALLOWED_TRANSITIONS: Record<FlightStatus, readonly FlightStatus[]> = {
  draft: ["offered", "cancelled"],
  offered: ["accepted", "declined", "cancelled"],
  accepted: ["briefed", "cancelled"],
  declined: [],
  briefed: ["active", "cancelled"],
  active: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export function canTransition(
  currentStatus: FlightStatus,
  nextStatus: FlightStatus,
): boolean {
  return ALLOWED_TRANSITIONS[currentStatus].includes(nextStatus);
}

export function assertFlightTransition(
  currentStatus: FlightStatus,
  nextStatus: FlightStatus,
): void {
  if (!canTransition(currentStatus, nextStatus)) {
    throw new AppError(
      "INVALID_TRANSITION",
      `Cannot transition flight from ${currentStatus} to ${nextStatus}`,
      {
        details: {
          from: currentStatus,
          to: nextStatus,
          allowed: ALLOWED_TRANSITIONS[currentStatus],
        },
      },
    );
  }
}

/** Pilot may cancel own flight until it becomes active. */
export function pilotMayCancel(status: FlightStatus): boolean {
  return status === "offered" || status === "accepted" || status === "briefed";
}
