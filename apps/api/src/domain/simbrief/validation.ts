import { z } from "zod";

const upper = (value: string) => value.toUpperCase();

export const simbriefUserIdSchema = z
  .string()
  .trim()
  .regex(/^[1-9]\d{1,11}$/, "Use the numeric SimBrief Pilot ID");

const aircraftTypeSchema = z
  .string()
  .trim()
  .min(2)
  .max(64)
  .regex(
    /^[A-Za-z0-9_-]+$/,
    "Use an ICAO aircraft type or SimBrief airframe Internal ID",
  )
  .transform((value) =>
    /^[A-Za-z0-9]{2,4}$/.test(value) ? value.toUpperCase() : value,
  );

const icaoSchema = z.string().trim().length(4).transform(upper);
const booleanOption = z.boolean().optional();

export const simbriefDispatchOptionsSchema = z
  .object({
    aircraftType: aircraftTypeSchema.optional(),
    airline: z.string().trim().min(1).max(3).transform(upper).optional(),
    flightNumber: z.string().trim().min(1).max(12).optional(),
    callsign: z
      .string()
      .trim()
      .min(2)
      .max(12)
      .regex(/^[A-Za-z0-9]+$/)
      .transform(upper)
      .optional(),
    route: z.string().trim().max(2_000).optional(),
    alternate: icaoSchema.optional(),
    flightLevel: z
      .union([
        z.number().int().min(0).max(60_000),
        z
          .string()
          .trim()
          .regex(/^(?:FL)?\d{2,5}$/i)
          .transform(upper),
      ])
      .optional(),
    registration: z.string().trim().min(1).max(16).transform(upper).optional(),
    passengers: z.number().int().min(0).max(1_000).optional(),
    cargo: z.number().min(0).max(9_999).optional(),
    captainName: z.string().trim().min(1).max(120).optional(),
    dispatcherName: z.string().trim().min(1).max(120).optional(),
    customRemarks: z.string().trim().max(2_000).optional(),
    units: z.enum(["KGS", "LBS"]).default("KGS"),
    planFormat: z.string().trim().min(1).max(32).transform(upper).optional(),
    costIndex: z
      .union([z.number().int().min(0).max(999), z.literal("AUTO")])
      .optional(),
    taxiOutMinutes: z.number().int().min(0).max(180).optional(),
    taxiInMinutes: z.number().int().min(0).max(180).optional(),
    reserveMinutes: z.number().int().min(0).max(600).optional(),
    navlog: booleanOption,
    etops: booleanOption,
    stepClimbs: booleanOption,
    runwayAnalysis: booleanOption,
    notams: booleanOption,
    firNotams: booleanOption,
    omitSids: booleanOption,
    omitStars: booleanOption,
    maps: z.enum(["detail", "simple", "none"]).optional(),
    sidStarPreference: z.enum(["R", "C"]).optional(),
  })
  .strict();

export type SimbriefDispatchOptions = z.infer<
  typeof simbriefDispatchOptionsSchema
>;
