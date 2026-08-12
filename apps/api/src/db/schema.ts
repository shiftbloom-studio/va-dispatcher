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

export const simbriefDispatchStatusEnum = pgEnum("simbrief_dispatch_status", [
  "pending",
  "ready",
]);

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
    settings: jsonb("settings")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
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
    simbriefUserId: text("simbrief_user_id"),
    simbriefVerifiedAt: timestamp("simbrief_verified_at", {
      withTimezone: true,
    }),
    navigraphSubject: text("navigraph_subject"),
    navigraphUsername: text("navigraph_username"),
    navigraphConnectedAt: timestamp("navigraph_connected_at", {
      withTimezone: true,
    }),
    status: memberStatusEnum("status").notNull().default("active"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("memberships_tenant_user_uidx").on(t.tenantId, t.clerkUserId),
    uniqueIndex("memberships_tenant_callsign_uidx").on(
      t.tenantId,
      t.pilotCallsign,
    ),
    uniqueIndex("memberships_tenant_simbrief_user_uidx").on(
      t.tenantId,
      t.simbriefUserId,
    ),
    uniqueIndex("memberships_tenant_navigraph_subject_uidx").on(
      t.tenantId,
      t.navigraphSubject,
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

/**
 * Short-lived server-side state for Navigraph Authorization Code + PKCE.
 *
 * Browser state is a versioned, server-authenticated token. Only its random
 * lookup ID is stored, so a database leak cannot reconstruct a valid state.
 * The PKCE verifier is encrypted at rest and each transaction is atomically
 * consumed before the authorization code is exchanged.
 */
export const navigraphOauthTransactions = pgTable(
  "navigraph_oauth_transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
    stateId: text("state_id").notNull(),
    codeVerifierEnc: text("code_verifier_enc").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("navigraph_oauth_transactions_state_uidx").on(t.stateId),
    index("navigraph_oauth_transactions_expiry_idx").on(t.expiresAt),
    index("navigraph_oauth_transactions_member_idx").on(
      t.tenantId,
      t.membershipId,
    ),
  ],
);

/**
 * A server-signed SimBrief Dispatch Redirect attempt and its resulting OFP.
 *
 * The API key and callback token are never persisted. Only a domain-separated
 * keyed callback authenticator is stored, so a leaked database cannot be used
 * to complete a pending dispatch. The actor's SimBrief user ID is snapshotted
 * because the member may later disconnect or change accounts.
 */
export const simbriefDispatches = pgTable(
  "simbrief_dispatches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    flightId: uuid("flight_id")
      .notNull()
      .references(() => flights.id, { onDelete: "cascade" }),
    createdByMembershipId: uuid("created_by_membership_id").references(
      () => memberships.id,
      { onDelete: "set null" },
    ),
    simbriefUserId: text("simbrief_user_id").notNull(),
    staticId: text("static_id").notNull(),
    callbackTokenMac: text("callback_token_mac"),
    status: simbriefDispatchStatusEnum("status").notNull().default("pending"),
    request: jsonb("request")
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    ofp: jsonb("ofp").$type<Record<string, unknown>>(),
    simbriefRequestId: text("simbrief_request_id"),
    generatedAt: timestamp("generated_at", { withTimezone: true }),
    syncedAt: timestamp("synced_at", { withTimezone: true }),
    lastError: text("last_error"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("simbrief_dispatches_static_id_uidx").on(t.staticId),
    index("simbrief_dispatches_tenant_flight_created_idx").on(
      t.tenantId,
      t.flightId,
      t.createdAt,
    ),
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

/** Internal local/test queue used by the mock adapter. */
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
    index("mock_acars_queue_pending_idx").on(
      t.tenantId,
      t.toStation,
      t.delivered,
    ),
  ],
);

export type Tenant = typeof tenants.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type ScheduleRequest = typeof scheduleRequests.$inferSelect;
export type Flight = typeof flights.$inferSelect;
export type NavigraphOauthTransaction =
  typeof navigraphOauthTransactions.$inferSelect;
export type SimbriefDispatch = typeof simbriefDispatches.$inferSelect;
export type AcarsMessage = typeof acarsMessages.$inferSelect;
export type MemberRole = (typeof memberRoleEnum.enumValues)[number];
export type FlightStatus = (typeof flightStatusEnum.enumValues)[number];
export type ScheduleRequestStatus =
  (typeof scheduleRequestStatusEnum.enumValues)[number];
export type SimbriefDispatchStatus =
  (typeof simbriefDispatchStatusEnum.enumValues)[number];
