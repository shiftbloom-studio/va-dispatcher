import type { ScheduleRequestStatus } from "../../db/schema.js";
import { AppError } from "../../lib/errors.js";

const ALLOWED: Record<ScheduleRequestStatus, readonly ScheduleRequestStatus[]> =
  {
    pending: ["in_review", "cancelled", "rejected"],
    in_review: [
      "fulfilled",
      "partially_fulfilled",
      "rejected",
      "cancelled",
    ],
    fulfilled: [],
    partially_fulfilled: ["fulfilled", "cancelled"],
    rejected: [],
    cancelled: [],
  };

export function canTransitionScheduleRequest(
  from: ScheduleRequestStatus,
  to: ScheduleRequestStatus,
): boolean {
  return ALLOWED[from].includes(to);
}

export function assertScheduleRequestTransition(
  from: ScheduleRequestStatus,
  to: ScheduleRequestStatus,
): void {
  if (!canTransitionScheduleRequest(from, to)) {
    throw new AppError(
      "INVALID_TRANSITION",
      `Cannot transition schedule request from ${from} to ${to}`,
      { details: { from, to, allowed: ALLOWED[from] } },
    );
  }
}
