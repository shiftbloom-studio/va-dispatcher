import { z } from "zod";

const utcInputPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export type AvailabilityInterval = {
  startAt: string;
  endAt: string;
};

export function utcInputToIso(value: string): string {
  if (!utcInputPattern.test(value)) {
    throw new Error("Enter a valid UTC date and time.");
  }

  const date = new Date(`${value}:00.000Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 16) !== value
  ) {
    throw new Error("Enter a valid UTC date and time.");
  }

  return date.toISOString();
}

export function isoToUtcInput(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 16);
}

export function formatUtc(
  value: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Invalid time";

  return (
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "UTC",
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      ...options,
    }).format(date) + "Z"
  );
}

const availabilitySchema = z.object({
  availability: z.array(
    z.object({
      startAt: z.string(),
      endAt: z.string(),
    }),
  ),
});

export function availabilityFromPreferences(
  value: unknown,
): AvailabilityInterval[] {
  const parsedPreferences = availabilitySchema.safeParse(value);
  return parsedPreferences.success ? parsedPreferences.data.availability : [];
}
