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

export const brandPresenceSchema = z.enum(["restrained", "balanced", "high"]);
export type BrandPresence = z.infer<typeof brandPresenceSchema>;

export const tenantBrandSchema = z.object({
  seedColor: z.string(),
  presence: brandPresenceSchema,
  logoUrl: z.string().url().nullable(),
});
export type TenantBrand = z.infer<typeof tenantBrandSchema>;

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
  brand: tenantBrandSchema,
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

export const tenantBrandResponseSchema = z.object({
  brand: tenantBrandSchema,
});

export const publicTenantSchema = z.object({
  slug: z.string(),
  name: z.string(),
  brand: tenantBrandSchema,
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

export const availabilityIntervalSchema = z.object({
  startAt: z.string().datetime({ offset: true }),
  endAt: z.string().datetime({ offset: true }),
});

export const schedulePreferencesSchema = z
  .object({
    availability: z.array(availabilityIntervalSchema),
  })
  .catchall(z.unknown());

export const scheduleRequestSchema = z.object({
  id: z.string(),
  pilotMembershipId: z.string(),
  title: z.string().nullish(),
  notes: z.string().nullish(),
  desiredFlightCount: z.number(),
  windowStart: z.string(),
  windowEnd: z.string(),
  preferences: schedulePreferencesSchema,
  version: z.number().int().min(1),
  status: scheduleRequestStatusSchema,
  rejectReason: z.string().nullish(),
  cancelReason: z.string().nullish(),
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
  fulfillment: z.object({
    linkedFlightCount: z.number().int().min(0),
    remainingFlightCount: z.number().int().min(0),
  }),
});

export const flightSchema = z.object({
  id: z.string(),
  scheduleRequestId: z.string().nullish(),
  replacesFlightId: z.string().nullish(),
  pilotMembershipId: z.string().nullable(),
  flightNumber: z.string(),
  depIcao: z.string(),
  arrIcao: z.string(),
  etd: z.string(),
  eta: z.string(),
  aircraftType: z.string().nullish(),
  version: z.number().int().min(1),
  status: flightStatusSchema,
  cancelReason: z.string().nullish(),
  declinedReason: z.string().nullish(),
  dispatcherNotes: z.string().nullish(),
  assignmentRevision: z.number().int(),
  assignmentConfirmedRevision: z.number().int().nullable(),
  assignmentConfirmedAt: z.string().nullable(),
  assignmentConfirmationRequired: z.boolean(),
  outAt: z.string().nullish(),
  offAt: z.string().nullish(),
  onAt: z.string().nullish(),
  inAt: z.string().nullish(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Flight = z.infer<typeof flightSchema>;

export const dispatchReleaseSchema = z.object({
  id: z.string(),
  flightId: z.string(),
  revision: z.number().int(),
  operationalRoute: z.string(),
  sid: z.string().nullable(),
  star: z.string().nullable(),
  cruiseLevel: z.number().int(),
  alternateIcao: z.string(),
  fuelUnit: z.enum(["kg", "lb"]),
  payloadUnit: z.enum(["kg", "lb"]),
  taxiFuel: z.number(),
  tripFuel: z.number(),
  contingencyFuel: z.number(),
  alternateFuel: z.number(),
  finalReserveFuel: z.number(),
  additionalFuel: z.number(),
  blockFuel: z.number(),
  plannedPayload: z.number(),
  weatherSnapshot: z.record(z.string(), z.unknown()),
  releaseNotes: z.string().nullable(),
  dispatcherRemarks: z.string().nullable(),
  releasedByMembershipId: z.string().nullable(),
  releasedAt: z.string(),
});
export type DispatchRelease = z.infer<typeof dispatchReleaseSchema>;

export const flightEventSchema = z.object({
  id: z.string(),
  kind: z.enum([
    "flt_init",
    "out",
    "off",
    "on",
    "in",
    "manual_start",
    "manual_finish",
    "assignment_confirmed",
  ]),
  source: z.enum(["hoppie", "pilot_web", "dispatcher"]),
  occurredAt: z.string(),
  actorMembershipId: z.string().nullable(),
  acarsMessageId: z.string().nullable(),
  meta: z.record(z.string(), z.unknown()),
});
export type FlightEvent = z.infer<typeof flightEventSchema>;

export const flightResponseSchema = z.object({ flight: flightSchema });
export const flightDetailResponseSchema = z.object({
  flight: flightSchema,
  release: dispatchReleaseSchema.nullable(),
  releaseRevisions: z.array(dispatchReleaseSchema),
  events: z.array(flightEventSchema),
});
export const dispatchReleaseResponseSchema = z.object({
  flight: flightSchema,
  release: dispatchReleaseSchema,
});
export const flightPageSchema = z.object({
  items: z.array(flightSchema),
  nextCursor: z.string().nullable(),
});
export const bulkFlightResponseSchema = z.object({
  flights: z.array(flightSchema),
  fulfillment: z.object({
    scheduleRequestId: z.string(),
    requestStatus: z.enum(["partially_fulfilled", "fulfilled"]),
    requestVersion: z.number().int().min(2),
    linkedFlightCount: z.number().int().positive(),
    remainingFlightCount: z.number().int().nonnegative(),
    flightIds: z.array(z.string()).min(1),
  }),
});

export const simbriefConnectionSchema = z.object({
  connected: z.boolean(),
  userId: z.string().nullable(),
  verified: z.boolean(),
  verifiedAt: z.string().nullable(),
  oauth: z.object({
    configured: z.boolean(),
    connected: z.boolean(),
    username: z.string().nullable(),
    connectedAt: z.string().nullable(),
  }),
});
export type SimbriefConnection = z.infer<typeof simbriefConnectionSchema>;
export const simbriefConnectionResponseSchema = z.object({
  connection: simbriefConnectionSchema,
});
export const simbriefOauthStartSchema = z.object({
  authorizationUrl: z.string().url(),
  redirectUri: z.string().url(),
  expiresAt: z.string(),
});

export const simbriefDispatchSchema = z.object({
  id: z.string(),
  flightId: z.string(),
  preparedByMembershipId: z.string().nullable(),
  generatedByMembershipId: z.string().nullable(),
  dispatcherName: z.string(),
  dispatcherRemarks: z.string().nullable(),
  staticId: z.string(),
  status: z.enum(["prepared", "pending", "ready"]),
  revision: z.number().int().positive(),
  flightVersion: z.number().int().positive().nullable(),
  assignmentRevision: z.number().int().positive().nullable(),
  releaseId: z.string().uuid().nullable(),
  releaseRevision: z.number().int().positive().nullable(),
  request: z.record(z.string(), z.string()),
  ofp: z.record(z.string(), z.unknown()).nullable(),
  simbriefRequestId: z.string().nullable(),
  generatedAt: z.string().nullable(),
  syncedAt: z.string().nullable(),
  lastError: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SimbriefDispatch = z.infer<typeof simbriefDispatchSchema>;
export const simbriefDispatchResponseSchema = z.object({
  dispatch: simbriefDispatchSchema,
});
export const simbriefGenerateResponseSchema =
  simbriefDispatchResponseSchema.extend({ dispatchUrl: z.string().url() });
export const simbriefDispatchListSchema = z.object({
  items: z.array(simbriefDispatchSchema),
  currentDispatchId: z.string().nullable().optional().default(null),
});

export const simulatorDeviceSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(["active", "revoked"]),
  lastSeenAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type SimulatorDevice = z.infer<typeof simulatorDeviceSchema>;
export const simulatorDeviceListSchema = z.object({
  items: z.array(simulatorDeviceSchema),
});
export const simulatorDeviceResponseSchema = z.object({
  device: simulatorDeviceSchema,
});
export const simulatorDeviceCreatedSchema =
  simulatorDeviceResponseSchema.extend({
    token: z.string(),
    warning: z.string(),
  });

export const presenceSchema = z.enum(["online", "stale", "disconnected"]);
export type Presence = z.infer<typeof presenceSchema>;
export const telemetryPhaseSchema = z.enum([
  "preflight",
  "taxi_out",
  "airborne",
  "taxi_in",
  "parked",
]);
export const flightTelemetrySchema = z.object({
  flightId: z.string(),
  membershipId: z.string(),
  phase: telemetryPhaseSchema,
  latitude: z.number(),
  longitude: z.number(),
  altitudeFeet: z.number(),
  groundSpeedKnots: z.number(),
  headingDegrees: z.number(),
  simulatorTime: z.string(),
  sampleAt: z.string(),
  sequence: z.number(),
});
export type FlightTelemetry = z.infer<typeof flightTelemetrySchema>;
export const oooiEventSchema = z.object({
  id: z.string(),
  eventType: z.enum(["out", "off", "on", "in"]),
  occurredAt: z.string().nullable(),
  source: z.enum(["telemetry", "manual"]),
  actorMembershipId: z.string().nullable(),
  deviceId: z.string().nullable(),
  reason: z.string().nullable(),
  createdAt: z.string(),
});
export type OooiEvent = z.infer<typeof oooiEventSchema>;
export const flightOooiSchema = z.object({
  id: z.string(),
  version: z.number().int().min(1),
  outAt: z.string().nullable(),
  offAt: z.string().nullable(),
  onAt: z.string().nullable(),
  inAt: z.string().nullable(),
});
export type FlightOooi = z.infer<typeof flightOooiSchema>;
export const oooiCorrectionResponseSchema = z.object({
  flight: flightOooiSchema,
  oooiEvents: z.array(oooiEventSchema),
});
export const flightTelemetryResponseSchema = z.object({
  flight: flightOooiSchema,
  presence: presenceSchema,
  current: flightTelemetrySchema.nullable(),
  track: z.array(flightTelemetrySchema),
  oooiEvents: z.array(oooiEventSchema),
});
export const dispatchTelemetrySchema = z.object({
  items: z.array(flightTelemetrySchema.extend({ presence: presenceSchema })),
  summary: z.object({
    onlinePilots: z.number().int().nonnegative(),
    flyingPilots: z.number().int().nonnegative(),
    stalePilots: z.number().int().nonnegative(),
    definition: z.string(),
  }),
  generatedAt: z.string(),
});

export const memberSchema = z.object({
  id: z.string(),
  clerkUserId: z.string(),
  role: roleSchema,
  pilotCallsign: z.string().nullish(),
  displayName: z.string().nullish(),
  status: z.enum(["active", "invited", "disabled"]),
  createdAt: z.string(),
  updatedAt: z.string(),
  openFlightCount: z.number().int().nonnegative().optional(),
  activeFlightCount: z.number().int().nonnegative().optional(),
  openScheduleRequestCount: z.number().int().nonnegative().optional(),
  terminalRequestLinkedFlightCount: z.number().int().nonnegative().optional(),
});
export type Member = z.infer<typeof memberSchema>;
export const membersSchema = z.object({
  items: z.array(memberSchema),
  nextCursor: z.string().nullable(),
});
export const memberImpactSchema = z.object({
  openFlightCount: z.number().int().nonnegative(),
  activeFlightCount: z.number().int().nonnegative(),
  openScheduleRequestCount: z.number().int().nonnegative(),
  terminalRequestLinkedFlightCount: z.number().int().nonnegative(),
});
export const memberUpdateResponseSchema = memberSchema.extend({
  reassignedFlightCount: z.number().int().nonnegative(),
  reassignedScheduleRequestCount: z.number().int().nonnegative(),
});
export const memberSyncResponseSchema = z.object({
  complete: z.boolean(),
  summaryAuditRecorded: z.boolean(),
  pages: z.number().int().nonnegative(),
  seen: z.number().int().nonnegative(),
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  failures: z.array(
    z.object({
      scope: z.enum(["page", "membership"]),
      offset: z.number().int().nonnegative(),
      code: z.string(),
    }),
  ),
  note: z.string().optional(),
});

export const auditEventSchema = z.object({
  id: z.string(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  meta: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  actor: z
    .object({
      membershipId: z.string(),
      displayName: z.string().nullable(),
      pilotCallsign: z.string().nullable(),
    })
    .nullable(),
});
export type AuditEvent = z.infer<typeof auditEventSchema>;
export const auditEventPageSchema = z.object({
  items: z.array(auditEventSchema),
  nextCursor: z.string().nullable(),
});
export const auditExportSchema = z.object({
  generatedAt: z.string(),
  filters: z.record(z.string(), z.unknown()),
  itemCount: z.number().int().nonnegative(),
  nextCursor: z.string().nullable(),
  items: z.array(auditEventSchema),
});

export const boardFlightSchema = flightSchema
  .pick({
    id: true,
    flightNumber: true,
    depIcao: true,
    arrIcao: true,
    etd: true,
    eta: true,
    aircraftType: true,
    status: true,
    pilotMembershipId: true,
    dispatcherNotes: true,
    assignmentRevision: true,
    assignmentConfirmedRevision: true,
    assignmentConfirmedAt: true,
    assignmentConfirmationRequired: true,
    outAt: true,
    inAt: true,
  })
  .extend({
    latestReleaseRevision: z.number().int().nullable(),
    boardLane: z.enum([
      "overdue",
      "accepted",
      "briefed",
      "active",
      "completed",
    ]),
  });
export type BoardFlight = z.infer<typeof boardFlightSchema>;
const metricRatio = z.number().min(0).max(1).nullable();
export const dispatchBoardSchema = z.object({
  flights: z.array(boardFlightSchema),
  metrics: z.object({
    window: z.object({
      from: z.string(),
      toExclusive: z.string(),
      label: z.string(),
    }),
    activeFlights: z.object({
      value: z.number().int().nonnegative(),
      definition: z.string(),
    }),
    onTimePerformance: z.object({
      value: metricRatio,
      onTime: z.number().int().nonnegative(),
      tracked: z.number().int().nonnegative(),
      eligible: z.number().int().nonnegative(),
      definition: z.string(),
    }),
    scheduledVsFinished: z.object({
      scheduled: z.number().int().nonnegative(),
      finished: z.number().int().nonnegative(),
      value: metricRatio,
      definition: z.string(),
    }),
  }),
  boardWindow: z.object({
    generatedAt: z.string(),
    overdueFrom: z.string(),
    upcomingTo: z.string(),
    overdueLookbackHours: z.number().int().positive(),
    upcomingHorizonDays: z.number().int().positive(),
  }),
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
  deliveryStatus: z
    .enum(["pending", "accepted", "rejected", "ambiguous"])
    .nullish()
    .optional(),
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
