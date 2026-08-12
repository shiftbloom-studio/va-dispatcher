import { AppError } from "../../lib/errors.js";

export type AvailabilityInterval = Readonly<{
  startAt: Date;
  endAt: Date;
}>;

const MAX_AVAILABILITY_INTERVALS = 100;

/**
 * Validates and canonicalizes the detailed availability contract stored in
 * schedule_requests.preferences. The overall request window is an envelope;
 * it must exactly match the first start and final end after normalization.
 */
export function normalizeAvailability(input: {
  preferences?: Record<string, unknown>;
  windowStart: Date;
  windowEnd: Date;
}): {
  preferences: Record<string, unknown>;
  intervals: AvailabilityInterval[];
} {
  if (
    !Number.isFinite(input.windowStart.getTime()) ||
    !Number.isFinite(input.windowEnd.getTime()) ||
    input.windowEnd <= input.windowStart
  ) {
    throw new AppError("BAD_REQUEST", "windowEnd must be after windowStart");
  }

  const availability = input.preferences?.availability;
  if (!Array.isArray(availability) || availability.length === 0) {
    throw new AppError(
      "BAD_REQUEST",
      "preferences.availability must contain at least one interval",
    );
  }
  if (availability.length > MAX_AVAILABILITY_INTERVALS) {
    throw new AppError(
      "BAD_REQUEST",
      `preferences.availability cannot contain more than ${MAX_AVAILABILITY_INTERVALS} intervals`,
    );
  }

  const intervals = availability
    .map((value, index) => parseInterval(value, index))
    .sort((left, right) => left.startAt.getTime() - right.startAt.getTime());

  for (let index = 1; index < intervals.length; index += 1) {
    const previous = intervals[index - 1]!;
    const current = intervals[index]!;
    if (current.startAt < previous.endAt) {
      throw new AppError(
        "BAD_REQUEST",
        "Availability intervals cannot overlap",
        { details: { intervalIndex: index } },
      );
    }
  }

  const first = intervals[0]!;
  const last = intervals.at(-1)!;
  if (
    first.startAt.getTime() !== input.windowStart.getTime() ||
    last.endAt.getTime() !== input.windowEnd.getTime()
  ) {
    throw new AppError(
      "BAD_REQUEST",
      "The overall request window must match the normalized availability envelope",
    );
  }

  return {
    preferences: {
      ...(input.preferences ?? {}),
      availability: intervals.map((interval) => ({
        startAt: interval.startAt.toISOString(),
        endAt: interval.endAt.toISOString(),
      })),
    },
    intervals,
  };
}

export function availabilityFromStoredRequest(input: {
  preferences: Record<string, unknown>;
  windowStart: Date;
  windowEnd: Date;
}): AvailabilityInterval[] {
  // Rows created before detailed availability became mandatory used only the
  // envelope. Treat that historical representation as one interval; every new
  // create/edit is normalized by normalizeAvailability above.
  if (input.preferences.availability === undefined) {
    return [{ startAt: input.windowStart, endAt: input.windowEnd }];
  }
  return normalizeAvailability(input).intervals;
}

export function assertFlightInsideAvailability(
  etd: Date,
  eta: Date,
  request: {
    preferences: Record<string, unknown>;
    windowStart: Date;
    windowEnd: Date;
  },
): void {
  if (etd < request.windowStart || eta > request.windowEnd) {
    throw new AppError(
      "UNPROCESSABLE",
      "Flight must be contained within the schedule request window",
    );
  }

  const intervals = availabilityFromStoredRequest(request);
  const contained = intervals.some(
    (interval) => etd >= interval.startAt && eta <= interval.endAt,
  );
  if (!contained) {
    throw new AppError(
      "UNPROCESSABLE",
      "Flight must be contained within one detailed availability interval",
    );
  }
}

function parseInterval(value: unknown, index: number): AvailabilityInterval {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidInterval(index);
  }
  const startValue = Reflect.get(value, "startAt");
  const endValue = Reflect.get(value, "endAt");
  if (typeof startValue !== "string" || typeof endValue !== "string") {
    throw invalidInterval(index);
  }

  const startAt = new Date(startValue);
  const endAt = new Date(endValue);
  if (
    !Number.isFinite(startAt.getTime()) ||
    !Number.isFinite(endAt.getTime()) ||
    endAt <= startAt
  ) {
    throw invalidInterval(index);
  }
  return { startAt, endAt };
}

function invalidInterval(index: number): AppError {
  return new AppError(
    "BAD_REQUEST",
    "Each availability interval requires valid startAt and endAt values with endAt after startAt",
    { details: { intervalIndex: index } },
  );
}
