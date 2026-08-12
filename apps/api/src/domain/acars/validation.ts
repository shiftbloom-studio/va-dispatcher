import { z } from "zod";

export const acarsStationSchema = z
  .string()
  .trim()
  .min(1)
  .max(20)
  .regex(
    /^[A-Za-z0-9-]+$/,
    "Use only letters, numbers, and hyphens for an ACARS callsign",
  )
  .transform((value) => value.toUpperCase());

export const hoppieLogonSchema = z.string().trim().min(1).max(128);
