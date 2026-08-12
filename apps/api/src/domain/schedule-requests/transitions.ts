import type { ScheduleRequestStatus } from "../../db/schema.js";
import { AppError } from "../../lib/errors.js";

const ALLOWED_TRANSITIONS: Record<
  ScheduleRequestStatus,
  readonly ScheduleRequestStatus[]
> = {
  pending: ["in_review", "cancelled", "rejected"],
  in_review: ["fulfilled", "partially_fulfilled", "rejected", "cancelled"],
  fulfilled: [],
  partially_fulfilled: ["fulfilled", "cancelled"],
  rejected: [],
  cancelled: [],
};

export function canTransitionScheduleRequest(
  currentStatus: ScheduleRequestStatus,
  nextStatus: ScheduleRequestStatus,
): boolean {
  return ALLOWED_TRANSITIONS[currentStatus].includes(nextStatus);
}

export function assertScheduleRequestTransition(
  currentStatus: ScheduleRequestStatus,
  nextStatus: ScheduleRequestStatus,
): void {
  if (!canTransitionScheduleRequest(currentStatus, nextStatus)) {
    throw new AppError(
      "INVALID_TRANSITION",
      `Cannot transition schedule request from ${currentStatus} to ${nextStatus}`,
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
