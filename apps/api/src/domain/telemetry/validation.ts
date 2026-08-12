import { z } from "zod";

export const telemetryPhaseSchema = z.enum([
  "preflight",
  "taxi_out",
  "airborne",
  "taxi_in",
  "parked",
]);

export const telemetryIngestSchema = z
  .object({
    flightId: z.string().uuid(),
    sequence: z.number().int().min(1).max(2_147_483_647),
    simulatorTime: z.coerce
      .date()
      .refine(
        (value) =>
          value.getUTCFullYear() >= 2000 && value.getUTCFullYear() <= 2100,
        "Simulator time must be between years 2000 and 2100",
      ),
    phase: telemetryPhaseSchema,
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    altitudeFeet: z.number().int().min(-1_500).max(100_000),
    groundSpeedKnots: z.number().int().min(0).max(1_500),
    headingDegrees: z.number().finite().min(0).lt(360),
  })
  .strict();

export type TelemetryIngest = z.infer<typeof telemetryIngestSchema>;

export const oooiCorrectionSchema = z
  .object({
    outAt: z.coerce.date().nullable().optional(),
    offAt: z.coerce.date().nullable().optional(),
    onAt: z.coerce.date().nullable().optional(),
    inAt: z.coerce.date().nullable().optional(),
    reason: z.string().trim().min(1).max(500),
  })
  .strict()
  .refine(
    (value) =>
      [value.outAt, value.offAt, value.onAt, value.inAt].some(
        (item) => item !== undefined,
      ),
    "At least one OOOI value is required",
  );

export type OooiCorrection = z.infer<typeof oooiCorrectionSchema>;
