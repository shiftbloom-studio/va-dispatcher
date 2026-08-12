import { z } from "zod";

import { utcInputToIso } from "@/lib/utc";

export const flightFormSchema = z
  .object({
    pilotMembershipId: z.string(),
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
    dispatcherNotes: z.string().trim().max(2_000).optional(),
    status: z.enum(["draft", "offered"]),
  })
  .superRefine((value, context) => {
    if (value.status === "offered" && !value.pilotMembershipId) {
      context.addIssue({
        code: "custom",
        message: "Choose a pilot before offering the flight.",
        path: ["pilotMembershipId"],
      });
    }

    try {
      if (
        Date.parse(utcInputToIso(value.eta)) <=
        Date.parse(utcInputToIso(value.etd))
      ) {
        context.addIssue({
          code: "custom",
          message: "ETA must be after ETD.",
          path: ["eta"],
        });
      }
    } catch {
      context.addIssue({
        code: "custom",
        message: "Enter valid UTC dates and times.",
        path: ["etd"],
      });
    }
  });

export type FlightFormValues = z.infer<typeof flightFormSchema>;

export const flightEditFormSchema = z
  .object({
    pilotMembershipId: z.string(),
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
    dispatcherNotes: z.string().trim().max(2_000).optional(),
  })
  .superRefine((value, context) => {
    try {
      if (
        Date.parse(utcInputToIso(value.eta)) <=
        Date.parse(utcInputToIso(value.etd))
      ) {
        context.addIssue({
          code: "custom",
          message: "ETA must be after ETD.",
          path: ["eta"],
        });
      }
    } catch {
      context.addIssue({
        code: "custom",
        message: "Enter valid UTC dates and times.",
        path: ["etd"],
      });
    }
  });

export type FlightEditFormValues = z.infer<typeof flightEditFormSchema>;
