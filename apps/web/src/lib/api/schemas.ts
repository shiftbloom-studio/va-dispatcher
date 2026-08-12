import { z } from "zod";

export const roleSchema = z.enum(["pilot", "dispatcher", "admin"]);
export type Role = z.infer<typeof roleSchema>;

export const scheduleRequestStatusSchema = z.enum([
  "pending",
  "in_review",
  "partially_fulfilled",
  "fulfilled",
  "rejected",
  "cancelled",
]);
export type ScheduleRequestStatus = z.infer<typeof scheduleRequestStatusSchema>;

export const flightStatusSchema = z.enum([
  "draft",
  "offered",
  "accepted",
  "declined",
  "briefed",
  "active",
  "completed",
  "cancelled",
]);
export type FlightStatus = z.infer<typeof flightStatusSchema>;

export const tenantSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  hoppieStation: z.string().nullish(),
});
export type Tenant = z.infer<typeof tenantSchema>;

export const tenantDetailSchema = tenantSchema.extend({
  hasHoppieLogon: z.boolean(),
  acarsProvider: z.enum(["mock", "hoppie"]),
  hoppiePollingEnabled: z.boolean(),
  hoppieLastTestedAt: z.string().nullable(),
  settings: z.record(z.string(), z.unknown()),
});
export type TenantDetail = z.infer<typeof tenantDetailSchema>;

export const acarsConfigSchema = tenantDetailSchema.pick({
  hoppieStation: true,
  hasHoppieLogon: true,
  acarsProvider: true,
  hoppiePollingEnabled: true,
  hoppieLastTestedAt: true,
});

export const meSchema = z.object({
  user: z
    .object({
      clerkUserId: z.string(),
    })
    .passthrough(),
  membership: z
    .object({
      id: z.string(),
      role: roleSchema,
      pilotCallsign: z.string().nullish(),
      displayName: z.string().nullish(),
      status: z.enum(["active", "invited", "disabled"]),
    })
    .passthrough()
    .nullable(),
  tenant: tenantSchema.nullable(),
});
export type Me = z.infer<typeof meSchema>;

export const meUpdateResponseSchema = z.object({
  membership: meSchema.shape.membership.unwrap(),
});

export const scheduleRequestSchema = z.object({
  id: z.string(),
  pilotMembershipId: z.string(),
  title: z.string().nullish(),
  notes: z.string().nullish(),
  desiredFlightCount: z.number(),
  windowStart: z.string(),
  windowEnd: z.string(),
  preferences: z.unknown().nullish(),
  status: scheduleRequestStatusSchema,
  rejectReason: z.string().nullish(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ScheduleRequest = z.infer<typeof scheduleRequestSchema>;

export const scheduleRequestPageSchema = z.object({
  items: z.array(scheduleRequestSchema),
  nextCursor: z.string().nullable(),
});

export const scheduleRequestResponseSchema = z.object({
  request: scheduleRequestSchema,
});

export const scheduleRequestDetailResponseSchema = z.object({
  request: scheduleRequestSchema,
  flights: z.unknown().optional(),
});

export const flightSchema = z.object({
  id: z.string(),
  scheduleRequestId: z.string().nullish(),
  pilotMembershipId: z.string().nullable(),
  flightNumber: z.string(),
  depIcao: z.string(),
  arrIcao: z.string(),
  etd: z.string(),
  eta: z.string(),
  aircraftType: z.string().nullish(),
  status: flightStatusSchema,
  cancelReason: z.string().nullish(),
  declinedReason: z.string().nullish(),
  dispatcherNotes: z.string().nullish(),
  outAt: z.string().nullish(),
  offAt: z.string().nullish(),
  onAt: z.string().nullish(),
  inAt: z.string().nullish(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Flight = z.infer<typeof flightSchema>;

export const flightResponseSchema = z.object({ flight: flightSchema });
export const flightPageSchema = z.object({
  items: z.array(flightSchema),
  nextCursor: z.string().nullable(),
});
export const bulkFlightResponseSchema = z.object({
  flights: z.array(flightSchema),
});

export const memberSchema = z.object({
  id: z.string(),
  role: roleSchema,
  pilotCallsign: z.string().nullish(),
  displayName: z.string().nullish(),
  status: z.enum(["active", "invited", "disabled"]),
  createdAt: z.coerce.string().optional(),
});
export type Member = z.infer<typeof memberSchema>;
export const membersSchema = z.object({ items: z.array(memberSchema) });

export const boardFlightSchema = flightSchema.pick({
  id: true,
  flightNumber: true,
  depIcao: true,
  arrIcao: true,
  etd: true,
  eta: true,
  aircraftType: true,
  status: true,
  pilotMembershipId: true,
});
export type BoardFlight = z.infer<typeof boardFlightSchema>;
export const dispatchBoardSchema = z.object({
  flights: z.array(boardFlightSchema),
  scheduleRequestCounts: z.record(z.string(), z.number()).default({}),
});

export const acarsMessageSchema = z.object({
  id: z.string(),
  direction: z.enum(["inbound", "outbound"]),
  msgType: z.string(),
  fromStation: z.string(),
  toStation: z.string(),
  body: z.string(),
  provider: z.string(),
  flightId: z.string().nullish(),
  createdAt: z.string(),
  receivedAt: z.string().nullish().optional(),
  sentAt: z.string().nullish().optional(),
});
export type AcarsMessage = z.infer<typeof acarsMessageSchema>;
export const acarsMessagePageSchema = z.object({
  items: z.array(acarsMessageSchema),
  nextCursor: z.string().nullable().optional(),
});
export const acarsMessageResponseSchema = z.object({
  message: acarsMessageSchema.partial().required({
    id: true,
    direction: true,
    fromStation: true,
    toStation: true,
    body: true,
    provider: true,
  }),
});
export const simulateAcarsResponseSchema = z.object({
  queued: z.boolean(),
  to: z.string(),
});

export const healthSchema = z.object({
  ok: z.boolean(),
  service: z.string(),
  env: z.string().optional(),
  database: z.boolean().optional(),
  acarsProvider: z.string().optional(),
});

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
