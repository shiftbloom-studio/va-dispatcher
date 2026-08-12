import { z } from "zod";

import { utcInputToIso } from "@/lib/utc";

const offerRowSchema = z.object({
  flightNumber: z
    .string()
    .trim()
    .min(2, "Use at least two characters.")
    .max(12),
  depIcao: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{4}$/, "Enter a four-letter ICAO code."),
  arrIcao: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{4}$/, "Enter a four-letter ICAO code."),
  etd: z.string().min(1, "ETD is required."),
  eta: z.string().min(1, "ETA is required."),
  aircraftType: z.string().trim().max(20).optional(),
});

export type OfferRow = z.infer<typeof offerRowSchema>;
export type OfferBuilderValues = { flights: OfferRow[] };

export function offerBuilderSchema(count: number) {
  return z
    .object({
      flights: z
        .array(offerRowSchema)
        .length(count, `Create exactly ${count} flight rows.`),
    })
    .superRefine((value, context) => {
      value.flights.forEach((flight, index) => {
        try {
          if (
            Date.parse(utcInputToIso(flight.eta)) <=
            Date.parse(utcInputToIso(flight.etd))
          ) {
            context.addIssue({
              code: "custom",
              message: "ETA must be after ETD.",
              path: ["flights", index, "eta"],
            });
          }
        } catch {
          context.addIssue({
            code: "custom",
            message: "Enter valid UTC dates and times.",
            path: ["flights", index, "etd"],
          });
        }
      });
    });
}
