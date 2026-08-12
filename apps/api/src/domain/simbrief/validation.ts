import { z } from "zod";

export const simbriefUserIdSchema = z
  .string()
  .trim()
  .regex(/^[1-9]\d{1,11}$/, "Use the numeric SimBrief Pilot ID");

/**
 * A preparation is always derived from the current immutable dispatch release.
 * These compare-and-set fields are the only client input: they make a stale UI
 * fail closed without creating a second, competing planning model in SimBrief.
 */
export const prepareSimbriefDispatchSchema = z
  .object({
    expectedFlightVersion: z.number().int().min(1),
    expectedAssignmentRevision: z.number().int().min(1),
    releaseId: z.string().uuid(),
    releaseRevision: z.number().int().min(1),
  })
  .strict();

export type PrepareSimbriefDispatchInput = z.infer<
  typeof prepareSimbriefDispatchSchema
>;
