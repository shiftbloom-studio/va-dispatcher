import { z } from "zod";

export const RETENTION_CLASS_KEYS = [
  "memberships",
  "scheduleRequests",
  "flights",
  "telemetry",
  "simbrief",
  "acars",
  "oauth",
  "audit",
  "logs",
  "backups",
] as const;

export type RetentionClassKey = (typeof RETENTION_CLASS_KEYS)[number];

const deleteClass = z
  .object({
    retentionDays: z.number().int().min(1).max(36_500),
    action: z.literal("delete"),
  })
  .strict();

const membershipClass = z
  .object({
    retentionDays: z.number().int().min(1).max(36_500),
    action: z.literal("anonymize"),
  })
  .strict();

const externalClass = z
  .object({
    retentionDays: z.number().int().min(1).max(36_500),
    action: z.literal("external"),
  })
  .strict();

export const retentionPolicyConfigSchema = z
  .object({
    classes: z
      .object({
        memberships: membershipClass,
        scheduleRequests: deleteClass,
        flights: deleteClass,
        telemetry: deleteClass.default({
          retentionDays: 1,
          action: "delete",
        }),
        simbrief: deleteClass,
        acars: deleteClass,
        oauth: deleteClass,
        audit: deleteClass,
        logs: externalClass,
        backups: externalClass,
      })
      .strict(),
    batchSize: z.number().int().min(1).max(500).default(100),
    intervalHours: z
      .number()
      .int()
      .min(1)
      .max(24 * 365)
      .default(24),
    automaticExecution: z.boolean().default(false),
    minimumDryRunAgeHours: z
      .number()
      .int()
      .min(1)
      .max(24 * 30)
      .default(24),
  })
  .strict();

export type RetentionPolicyConfig = z.infer<typeof retentionPolicyConfigSchema>;

export const DEFAULT_RETENTION_POLICY: RetentionPolicyConfig = {
  classes: {
    memberships: { retentionDays: 730, action: "anonymize" },
    scheduleRequests: { retentionDays: 730, action: "delete" },
    flights: { retentionDays: 2_555, action: "delete" },
    telemetry: { retentionDays: 1, action: "delete" },
    simbrief: { retentionDays: 90, action: "delete" },
    acars: { retentionDays: 30, action: "delete" },
    oauth: { retentionDays: 1, action: "delete" },
    audit: { retentionDays: 365, action: "delete" },
    logs: { retentionDays: 30, action: "external" },
    backups: { retentionDays: 30, action: "external" },
  },
  batchSize: 100,
  intervalHours: 24,
  automaticExecution: false,
  minimumDryRunAgeHours: 24,
};

export const objectionScopeSchema = z.enum([
  "optional_integrations",
  "simbrief_navigraph",
  "acars",
]);

export type ObjectionScope = z.infer<typeof objectionScopeSchema>;

export const privacyCorrectionSchema = z
  .object({
    displayName: z.string().trim().min(1).max(200).nullable().optional(),
    pilotCallsign: z
      .string()
      .trim()
      .min(2)
      .max(20)
      .transform((value) => value.toUpperCase())
      .nullable()
      .optional(),
    clerkCorrectionRequested: z.boolean().default(false),
  })
  .strict()
  .refine(
    (value) =>
      value.displayName !== undefined ||
      value.pilotCallsign !== undefined ||
      value.clerkCorrectionRequested,
    { message: "At least one correction is required" },
  );

export const privacyRestrictionSchema = z
  .object({
    reason: z.string().trim().min(1).max(1_000),
  })
  .strict();

export const privacyObjectionSchema = z
  .object({
    scopes: z.array(objectionScopeSchema).min(1).max(3),
    reason: z.string().trim().min(1).max(1_000),
  })
  .strict();

export const retentionReportSchema = z.object({
  asOf: z.string().datetime(),
  classes: z.record(
    z.string(),
    z.object({
      eligible: z.number().int().nonnegative().default(0),
      affected: z.number().int().nonnegative().default(0),
      held: z.number().int().nonnegative().default(0),
      externalActionRequired: z.boolean().default(false),
    }),
  ),
});

export type RetentionReport = z.infer<typeof retentionReportSchema>;

export function emptyRetentionReport(asOf: Date): RetentionReport {
  return {
    asOf: asOf.toISOString(),
    classes: Object.fromEntries(
      RETENTION_CLASS_KEYS.map((key) => [
        key,
        {
          eligible: 0,
          affected: 0,
          held: 0,
          externalActionRequired: key === "logs" || key === "backups",
        },
      ]),
    ),
  };
}

export function cutoffFor(asOf: Date, retentionDays: number): Date {
  return new Date(asOf.getTime() - retentionDays * 86_400_000);
}
