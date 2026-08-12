import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const memberRoleEnum = pgEnum("member_role", [
  "pilot",
  "dispatcher",
  "admin",
]);

export const memberStatusEnum = pgEnum("member_status", [
  "active",
  "invited",
  "disabled",
]);

export const scheduleRequestStatusEnum = pgEnum("schedule_request_status", [
  "pending",
  "in_review",
  "fulfilled",
  "partially_fulfilled",
  "rejected",
  "cancelled",
]);

export const flightStatusEnum = pgEnum("flight_status", [
  "draft",
  "offered",
  "accepted",
  "declined",
  "briefed",
  "active",
  "completed",
  "cancelled",
]);

export const acarsDirectionEnum = pgEnum("acars_direction", [
  "inbound",
  "outbound",
]);

export const acarsMsgTypeEnum = pgEnum("acars_msg_type", [
  "telex",
  "progress",
  "cpdlc",
  "position",
  "other",
]);

export const acarsProviderEnum = pgEnum("acars_provider", ["mock", "hoppie"]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    clerkOrgId: text("clerk_org_id").notNull(),
    hoppieStation: text("hoppie_station"),
    hoppieLogonEnc: text("hoppie_logon_enc"),
    settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("tenants_slug_uidx").on(t.slug),
    uniqueIndex("tenants_clerk_org_uidx").on(t.clerkOrgId),
  ],
);

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    clerkUserId: text("clerk_user_id").notNull(),
    role: memberRoleEnum("role").notNull().default("pilot"),
    displayName: text("display_name"),
    pilotCallsign: text("pilot_callsign"),
    status: memberStatusEnum("status").notNull().default("active"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("memberships_tenant_user_uidx").on(t.tenantId, t.clerkUserId),
    uniqueIndex("memberships_tenant_callsign_uidx").on(
      t.tenantId,
      t.pilotCallsign,
    ),
    index("memberships_tenant_idx").on(t.tenantId),
  ],
);

export const scheduleRequests = pgTable(
  "schedule_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    pilotMembershipId: uuid("pilot_membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "restrict" }),
    title: text("title"),
    notes: text("notes"),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    windowEnd: timestamp("window_end", { withTimezone: true }).notNull(),
    desiredFlightCount: integer("desired_flight_count").notNull(),
    preferences: jsonb("preferences")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    status: scheduleRequestStatusEnum("status").notNull().default("pending"),
    rejectReason: text("reject_reason"),
    ...timestamps,
  },
  (t) => [
    index("schedule_requests_tenant_status_idx").on(t.tenantId, t.status),
    index("schedule_requests_tenant_pilot_idx").on(
      t.tenantId,
      t.pilotMembershipId,
    ),
  ],
);

export const flights = pgTable(
  "flights",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    scheduleRequestId: uuid("schedule_request_id").references(
      () => scheduleRequests.id,
      { onDelete: "set null" },
    ),
    pilotMembershipId: uuid("pilot_membership_id").references(
      () => memberships.id,
      { onDelete: "set null" },
    ),
    flightNumber: text("flight_number").notNull(),
    depIcao: text("dep_icao").notNull(),
    arrIcao: text("arr_icao").notNull(),
    etd: timestamp("etd", { withTimezone: true }).notNull(),
    eta: timestamp("eta", { withTimezone: true }).notNull(),
    aircraftType: text("aircraft_type"),
    status: flightStatusEnum("status").notNull().default("draft"),
    cancelReason: text("cancel_reason"),
    declinedReason: text("declined_reason"),
    dispatcherNotes: text("dispatcher_notes"),
    outAt: timestamp("out_at", { withTimezone: true }),
    offAt: timestamp("off_at", { withTimezone: true }),
    onAt: timestamp("on_at", { withTimezone: true }),
    inAt: timestamp("in_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("flights_tenant_status_idx").on(t.tenantId, t.status),
    index("flights_tenant_etd_idx").on(t.tenantId, t.etd),
    index("flights_tenant_pilot_idx").on(t.tenantId, t.pilotMembershipId),
    index("flights_schedule_request_idx").on(t.scheduleRequestId),
  ],
);

export const acarsMessages = pgTable(
  "acars_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    direction: acarsDirectionEnum("direction").notNull(),
    msgType: acarsMsgTypeEnum("msg_type").notNull().default("telex"),
    fromStation: text("from_station").notNull(),
    toStation: text("to_station").notNull(),
    body: text("body").notNull(),
    hoppieRaw: jsonb("hoppie_raw").$type<unknown>(),
    provider: acarsProviderEnum("provider").notNull().default("mock"),
    providerMessageId: text("provider_message_id"),
    flightId: uuid("flight_id").references(() => flights.id, {
      onDelete: "set null",
    }),
    createdByMembershipId: uuid("created_by_membership_id").references(
      () => memberships.id,
      { onDelete: "set null" },
    ),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("acars_messages_tenant_created_idx").on(t.tenantId, t.createdAt),
    index("acars_messages_tenant_flight_idx").on(t.tenantId, t.flightId),
    uniqueIndex("acars_messages_provider_dedupe_uidx").on(
      t.tenantId,
      t.provider,
      t.providerMessageId,
    ),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    actorMembershipId: uuid("actor_membership_id").references(
      () => memberships.id,
      { onDelete: "set null" },
    ),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("audit_events_tenant_created_idx").on(t.tenantId, t.createdAt),
    index("audit_events_entity_idx").on(t.entityType, t.entityId),
  ],
);

/** Inbound mock queue so poll can drain simulated messages. */
export const mockAcarsQueue = pgTable(
  "mock_acars_queue",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    toStation: text("to_station").notNull(),
    fromStation: text("from_station").notNull(),
    msgType: acarsMsgTypeEnum("msg_type").notNull().default("telex"),
    body: text("body").notNull(),
    delivered: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("mock_acars_queue_pending_idx").on(t.tenantId, t.toStation, t.delivered),
  ],
);

export type Tenant = typeof tenants.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type ScheduleRequest = typeof scheduleRequests.$inferSelect;
export type Flight = typeof flights.$inferSelect;
export type AcarsMessage = typeof acarsMessages.$inferSelect;
export type MemberRole = (typeof memberRoleEnum.enumValues)[number];
export type FlightStatus = (typeof flightStatusEnum.enumValues)[number];
export type ScheduleRequestStatus =
  (typeof scheduleRequestStatusEnum.enumValues)[number];
