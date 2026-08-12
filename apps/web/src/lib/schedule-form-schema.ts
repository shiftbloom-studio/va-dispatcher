import { z } from "zod";

import { utcInputToIso } from "@/lib/utc";

const intervalSchema = z.object({
  startAt: z.string().min(1, "Start is required."),
  endAt: z.string().min(1, "End is required."),
});

export const scheduleRequestFormSchema = z
  .object({
    title: z.string().trim().max(120, "Use at most 120 characters.").optional(),
    notes: z
      .string()
      .trim()
      .max(2_000, "Use at most 2,000 characters.")
      .optional(),
    desiredFlightCount: z
      .number()
      .int("Use a whole number.")
      .min(1, "Request at least one flight.")
      .max(50, "Request at most 50 flights."),
    availability: z
      .array(intervalSchema)
      .min(1, "Add at least one availability interval."),
  })
  .superRefine((value, context) => {
    const parsed: Array<{ start: number; end: number; index: number }> = [];

    value.availability.forEach((interval, index) => {
      try {
        const startAt = utcInputToIso(interval.startAt);
        const endAt = utcInputToIso(interval.endAt);
        const start = Date.parse(startAt);
        const end = Date.parse(endAt);

        if (end <= start) {
          context.addIssue({
            code: "custom",
            message: "End must be after start.",
            path: ["availability", index, "endAt"],
          });
        } else {
          parsed.push({ start, end, index });
        }
      } catch {
        context.addIssue({
          code: "custom",
          message: "Enter valid UTC dates and times.",
          path: ["availability", index, "startAt"],
        });
      }
    });

    parsed
      .sort((left, right) => left.start - right.start)
      .forEach((interval, index, intervals) => {
        const previous = intervals[index - 1];
        if (previous && interval.start < previous.end) {
          context.addIssue({
            code: "custom",
            message: "Availability intervals cannot overlap.",
            path: ["availability", interval.index, "startAt"],
          });
        }
      });
  });

export type ScheduleRequestFormValues = z.infer<
  typeof scheduleRequestFormSchema
>;
