import type { FlightStatus } from "../../db/schema.js";
import { AppError } from "../../lib/errors.js";

const ALLOWED: Record<FlightStatus, readonly FlightStatus[]> = {
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
  from: FlightStatus,
  to: FlightStatus,
): boolean {
  return ALLOWED[from].includes(to);
}

export function assertFlightTransition(
  from: FlightStatus,
  to: FlightStatus,
): void {
  if (!canTransition(from, to)) {
    throw new AppError(
      "INVALID_TRANSITION",
      `Cannot transition flight from ${from} to ${to}`,
      { details: { from, to, allowed: ALLOWED[from] } },
    );
  }
}

/** Pilot may cancel own flight until it becomes active. */
export function pilotMayCancel(status: FlightStatus): boolean {
  return status === "offered" || status === "accepted" || status === "briefed";
}
