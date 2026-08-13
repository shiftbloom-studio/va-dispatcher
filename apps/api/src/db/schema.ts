import { sql } from "drizzle-orm";
import {
  boolean,
  type AnyPgColumn,
  check,
  doublePrecision,
  foreignKey,
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

export const acarsDeliveryStatusEnum = pgEnum("acars_delivery_status", [
  "pending",
  "accepted",
  "rejected",
  "ambiguous",
]);

export const simbriefDispatchStatusEnum = pgEnum("simbrief_dispatch_status", [
  "prepared",
  "pending",
  "ready",
]);

export const brandPresenceEnum = pgEnum("brand_presence", [
  "restrained",
  "balanced",
  "high",
]);

export const dispatchUnitEnum = pgEnum("dispatch_unit", ["kg", "lb"]);

export const flightEventKindEnum = pgEnum("flight_event_kind", [
  "flt_init",
  "out",
  "off",
  "on",
  "in",
  "manual_start",
  "manual_finish",
  "assignment_confirmed",
]);

export const flightEventSourceEnum = pgEnum("flight_event_source", [
  "hoppie",
  "pilot_web",
  "dispatcher",
]);

export const simulatorDeviceStatusEnum = pgEnum("simulator_device_status", [
  "active",
  "revoked",
]);

export const telemetryPhaseEnum = pgEnum("telemetry_phase", [
  "preflight",
  "taxi_out",
  "airborne",
  "taxi_in",
  "parked",
]);

export const oooiEventTypeEnum = pgEnum("oooi_event_type", [
  "out",
  "off",
  "on",
  "in",
]);

export const oooiSourceEnum = pgEnum("oooi_source", ["telemetry", "manual"]);

export const privacyPolicyStatusEnum = pgEnum("privacy_policy_status", [
  "draft",
  "active",
  "retired",
]);

export const privacyRunModeEnum = pgEnum("privacy_run_mode", [
  "dry_run",
  "execute",
]);

export const privacyRunStatusEnum = pgEnum("privacy_run_status", [
  "queued",
  "running",
  "completed",
  "failed",
]);

export const privacyRequestScopeEnum = pgEnum("privacy_request_scope", [
  "member",
  "tenant",
]);

export const privacyRequestKindEnum = pgEnum("privacy_request_kind", [
  "export",
  "correction",
  "restriction",
  "objection",
  "anonymization",
  "erasure",
]);

export const privacyRequestStatusEnum = pgEnum("privacy_request_status", [
  "pending_verification",
  "pending_approval",
  "approved",
  "processing",
  "awaiting_external",
  "completed",
  "blocked",
  "failed",
  "cancelled",
]);

export const privacyHoldStatusEnum = pgEnum("privacy_hold_status", [
  "pending",
  "active",
  "released",
]);

export const privacyExternalProviderEnum = pgEnum("privacy_external_provider", [
  "clerk",
  "vercel",
  "neon",
  "hoppie",
  "backup",
  "navigraph",
]);

export const privacyExternalTaskStatusEnum = pgEnum(
  "privacy_external_task_status",
  ["pending", "completed", "not_applicable", "failed"],
);

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
    brandSeedColor: text("brand_seed_color").notNull().default("#e64646"),
    brandPresence: brandPresenceEnum("brand_presence")
      .notNull()
      .default("balanced"),
    brandLogoUrl: text("brand_logo_url"),
    brandLogoPathname: text("brand_logo_pathname"),
    settings: jsonb("settings")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("tenants_slug_uidx").on(t.slug),
    uniqueIndex("tenants_clerk_org_uidx").on(t.clerkOrgId),
    check(
      "tenants_brand_seed_color_check",
      sql`${t.brandSeedColor} ~ '^#[0-9a-f]{6}$'`,
    ),
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
    // `invited` memberships are not authorized; their role is the requested
    // pilot/dispatcher role until a tenant administrator decides the request.
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
    uniqueIndex("memberships_tenant_id_uidx").on(t.tenantId, t.id),
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
    version: integer("version").notNull().default(1),
    status: scheduleRequestStatusEnum("status").notNull().default("pending"),
    rejectReason: text("reject_reason"),
    cancelReason: text("cancel_reason"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("schedule_requests_tenant_id_uidx").on(t.tenantId, t.id),
    foreignKey({
      columns: [t.tenantId, t.pilotMembershipId],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: "schedule_requests_tenant_pilot_fkey",
    }),
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
    replacesFlightId: uuid("replaces_flight_id"),
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
    version: integer("version").notNull().default(1),
    status: flightStatusEnum("status").notNull().default("draft"),
    cancelReason: text("cancel_reason"),
    declinedReason: text("declined_reason"),
    dispatcherNotes: text("dispatcher_notes"),
    assignmentRevision: integer("assignment_revision").notNull().default(1),
    assignmentConfirmedRevision: integer("assignment_confirmed_revision"),
    assignmentConfirmedAt: timestamp("assignment_confirmed_at", {
      withTimezone: true,
    }),
    outAt: timestamp("out_at", { withTimezone: true }),
    offAt: timestamp("off_at", { withTimezone: true }),
    onAt: timestamp("on_at", { withTimezone: true }),
    inAt: timestamp("in_at", { withTimezone: true }),
    outManualOverride: boolean("out_manual_override").notNull().default(false),
    offManualOverride: boolean("off_manual_override").notNull().default(false),
    onManualOverride: boolean("on_manual_override").notNull().default(false),
    inManualOverride: boolean("in_manual_override").notNull().default(false),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("flights_tenant_id_uidx").on(t.tenantId, t.id),
    uniqueIndex("flights_tenant_replaces_uidx").on(
      t.tenantId,
      t.replacesFlightId,
    ),
    foreignKey({
      columns: [t.tenantId, t.replacesFlightId],
      foreignColumns: [t.tenantId, t.id],
      name: "flights_tenant_replaces_fkey",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.tenantId, t.pilotMembershipId],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: "flights_tenant_pilot_fkey",
    }),
    foreignKey({
      columns: [t.tenantId, t.scheduleRequestId],
      foreignColumns: [scheduleRequests.tenantId, scheduleRequests.id],
      name: "flights_tenant_schedule_request_fkey",
    }),
    index("flights_tenant_status_idx").on(t.tenantId, t.status),
    index("flights_tenant_etd_idx").on(t.tenantId, t.etd),
    index("flights_tenant_pilot_idx").on(t.tenantId, t.pilotMembershipId),
    index("flights_schedule_request_idx").on(t.scheduleRequestId),
    check("flights_time_window_check", sql`${t.eta} > ${t.etd}`),
    check(
      "flights_assignment_revision_check",
      sql`${t.assignmentRevision} > 0`,
    ),
    check(
      "flights_assignment_confirmation_check",
      sql`${t.assignmentConfirmedRevision} is null or (${t.assignmentConfirmedRevision} > 0 and ${t.assignmentConfirmedRevision} <= ${t.assignmentRevision})`,
    ),
  ],
);

/** Immutable revisions of a dispatch release. The latest revision is current. */
export const dispatchReleases = pgTable(
  "dispatch_releases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    flightId: uuid("flight_id").notNull(),
    revision: integer("revision").notNull(),
    operationalRoute: text("operational_route").notNull(),
    sid: text("sid"),
    star: text("star"),
    cruiseLevel: integer("cruise_level").notNull(),
    alternateIcao: text("alternate_icao").notNull(),
    fuelUnit: dispatchUnitEnum("fuel_unit").notNull(),
    payloadUnit: dispatchUnitEnum("payload_unit").notNull(),
    taxiFuel: integer("taxi_fuel").notNull(),
    tripFuel: integer("trip_fuel").notNull(),
    contingencyFuel: integer("contingency_fuel").notNull(),
    alternateFuel: integer("alternate_fuel").notNull(),
    finalReserveFuel: integer("final_reserve_fuel").notNull(),
    additionalFuel: integer("additional_fuel").notNull().default(0),
    blockFuel: integer("block_fuel").notNull(),
    plannedPayload: integer("planned_payload").notNull(),
    weatherSnapshot: jsonb("weather_snapshot")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    releaseNotes: text("release_notes"),
    dispatcherRemarks: text("dispatcher_remarks"),
    releasedByMembershipId: uuid("released_by_membership_id").references(
      () => memberships.id,
      { onDelete: "set null" },
    ),
    releasedAt: timestamp("released_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("dispatch_releases_flight_revision_uidx").on(
      t.tenantId,
      t.flightId,
      t.revision,
    ),
    index("dispatch_releases_tenant_flight_idx").on(t.tenantId, t.flightId),
    foreignKey({
      columns: [t.tenantId, t.flightId],
      foreignColumns: [flights.tenantId, flights.id],
      name: "dispatch_releases_tenant_flight_fk",
    }).onDelete("cascade"),
    check("dispatch_releases_revision_check", sql`${t.revision} > 0`),
    check(
      "dispatch_releases_cruise_level_check",
      sql`${t.cruiseLevel} between 10 and 600`,
    ),
    check(
      "dispatch_releases_nonnegative_amounts_check",
      sql`${t.taxiFuel} >= 0 and ${t.tripFuel} >= 0 and ${t.contingencyFuel} >= 0 and ${t.alternateFuel} >= 0 and ${t.finalReserveFuel} >= 0 and ${t.additionalFuel} >= 0 and ${t.blockFuel} >= 0 and ${t.plannedPayload} >= 0`,
    ),
    check(
      "dispatch_releases_positive_trip_fuel_check",
      sql`${t.tripFuel} > 0 and ${t.blockFuel} > 0`,
    ),
    check(
      "dispatch_releases_block_fuel_check",
      sql`${t.blockFuel} = ${t.taxiFuel} + ${t.tripFuel} + ${t.contingencyFuel} + ${t.alternateFuel} + ${t.finalReserveFuel} + ${t.additionalFuel}`,
    ),
  ],
);

/**
 * Durable result of one logical request-fulfillment submission.
 *
 * Canonical flights remain in `flights`; this record stores only the ordered
 * canonical IDs and the immutable request-progress outcome needed to replay
 * an idempotent POST without generating another batch.
 */
export const scheduleFulfillmentAttempts = pgTable(
  "schedule_fulfillment_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    scheduleRequestId: uuid("schedule_request_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    payloadHash: text("payload_hash").notNull(),
    flightIds: uuid("flight_ids").array().notNull(),
    requestStatus: scheduleRequestStatusEnum("request_status").notNull(),
    requestVersion: integer("request_version").notNull(),
    linkedFlightCount: integer("linked_flight_count").notNull(),
    remainingFlightCount: integer("remaining_flight_count").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("schedule_fulfillment_attempts_request_key_uidx").on(
      t.tenantId,
      t.scheduleRequestId,
      t.idempotencyKey,
    ),
    foreignKey({
      columns: [t.tenantId, t.scheduleRequestId],
      foreignColumns: [scheduleRequests.tenantId, scheduleRequests.id],
      name: "schedule_fulfillment_attempts_tenant_request_fkey",
    }).onDelete("cascade"),
    check(
      "schedule_fulfillment_attempts_key_check",
      sql`char_length(${t.idempotencyKey}) between 1 and 200`,
    ),
    check(
      "schedule_fulfillment_attempts_payload_hash_check",
      sql`char_length(${t.payloadHash}) = 64`,
    ),
    check(
      "schedule_fulfillment_attempts_flights_check",
      sql`cardinality(${t.flightIds}) > 0`,
    ),
    check(
      "schedule_fulfillment_attempts_status_check",
      sql`${t.requestStatus} in ('partially_fulfilled', 'fulfilled')`,
    ),
    check(
      "schedule_fulfillment_attempts_counts_check",
      sql`${t.requestVersion} > 1 and ${t.linkedFlightCount} > 0 and ${t.remainingFlightCount} >= 0`,
    ),
    index("schedule_fulfillment_attempts_request_idx").on(
      t.tenantId,
      t.scheduleRequestId,
    ),
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
    generatedByMembershipId: uuid("generated_by_membership_id").references(
      () => memberships.id,
      { onDelete: "set null" },
    ),
    simbriefUserId: text("simbrief_user_id"),
    staticId: text("static_id").notNull(),
    callbackTokenMac: text("callback_token_mac"),
    callbackExpiresAt: timestamp("callback_expires_at", {
      withTimezone: true,
    }),
    status: simbriefDispatchStatusEnum("status").notNull().default("pending"),
    revision: integer("revision").notNull(),
    flightSnapshot: jsonb("flight_snapshot")
      .$type<Record<string, string | number | null>>()
      .notNull(),
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
    uniqueIndex("simbrief_dispatches_tenant_flight_revision_uidx").on(
      t.tenantId,
      t.flightId,
      t.revision,
    ),
    foreignKey({
      columns: [t.tenantId, t.flightId],
      foreignColumns: [flights.tenantId, flights.id],
      name: "simbrief_dispatches_tenant_flight_fk",
    }).onDelete("cascade"),
    check(
      "simbrief_dispatches_flight_snapshot_object_check",
      sql`jsonb_typeof(${t.flightSnapshot}) = 'object'`,
    ),
    check(
      "simbrief_dispatches_positive_revision_check",
      sql`${t.revision} > 0`,
    ),
    check(
      "simbrief_dispatches_callback_lifecycle_check",
      sql`${t.callbackTokenMac} IS NULL OR (${t.status} = 'pending' AND ${t.callbackExpiresAt} IS NOT NULL)`,
    ),
  ],
);

/** Linearization point for canonical SimBrief revision prepare/generate races. */
export const simbriefFlightHeads = pgTable(
  "simbrief_flight_heads",
  {
    flightId: uuid("flight_id")
      .primaryKey()
      .references(() => flights.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("simbrief_flight_heads_tenant_flight_uidx").on(
      t.tenantId,
      t.flightId,
    ),
    foreignKey({
      columns: [t.tenantId, t.flightId],
      foreignColumns: [flights.tenantId, flights.id],
      name: "simbrief_flight_heads_tenant_flight_fk",
    }).onDelete("cascade"),
    check(
      "simbrief_flight_heads_positive_revision_check",
      sql`${t.revision} > 0`,
    ),
  ],
);

/** Revocable simulator-client credential. Only a keyed authenticator is stored. */
export const simulatorDevices = pgTable(
  "simulator_devices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tokenMac: text("token_mac").notNull(),
    status: simulatorDeviceStatusEnum("status").notNull().default("active"),
    lastSequence: integer("last_sequence"),
    lastIngestAt: timestamp("last_ingest_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("simulator_devices_tenant_member_idx").on(t.tenantId, t.membershipId),
    uniqueIndex("simulator_devices_tenant_id_uidx").on(t.tenantId, t.id),
    uniqueIndex("simulator_devices_tenant_member_id_uidx").on(
      t.tenantId,
      t.membershipId,
      t.id,
    ),
    foreignKey({
      columns: [t.tenantId, t.membershipId],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: "simulator_devices_tenant_member_fk",
    }).onDelete("cascade"),
  ],
);

/** Latest known simulator state. This is intentionally separate from history. */
export const flightTelemetryCurrent = pgTable(
  "flight_telemetry_current",
  {
    flightId: uuid("flight_id")
      .primaryKey()
      .references(() => flights.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => simulatorDevices.id, { onDelete: "cascade" }),
    phase: telemetryPhaseEnum("phase").notNull(),
    latitude: doublePrecision("latitude").notNull(),
    longitude: doublePrecision("longitude").notNull(),
    altitudeFeet: integer("altitude_feet").notNull(),
    groundSpeedKnots: integer("ground_speed_knots").notNull(),
    headingDegrees: doublePrecision("heading_degrees").notNull(),
    simulatorTime: timestamp("simulator_time", {
      withTimezone: true,
    }).notNull(),
    sampleAt: timestamp("sample_at", { withTimezone: true }).notNull(),
    sequence: integer("sequence").notNull(),
    ...timestamps,
  },
  (t) => [
    index("flight_telemetry_current_tenant_sample_idx").on(
      t.tenantId,
      t.sampleAt,
    ),
    index("flight_telemetry_current_member_idx").on(t.tenantId, t.membershipId),
    foreignKey({
      columns: [t.tenantId, t.flightId],
      foreignColumns: [flights.tenantId, flights.id],
      name: "flight_telemetry_current_tenant_flight_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.tenantId, t.membershipId],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: "flight_telemetry_current_tenant_member_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.tenantId, t.membershipId, t.deviceId],
      foreignColumns: [
        simulatorDevices.tenantId,
        simulatorDevices.membershipId,
        simulatorDevices.id,
      ],
      name: "flight_telemetry_current_tenant_member_device_fk",
    }).onDelete("cascade"),
  ],
);

/** Single-writer lease preventing two active clients from racing one flight. */
export const flightTelemetryLeases = pgTable(
  "flight_telemetry_leases",
  {
    flightId: uuid("flight_id")
      .primaryKey()
      .references(() => flights.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => simulatorDevices.id, { onDelete: "cascade" }),
    leaseExpiresAt: timestamp("lease_expires_at", {
      withTimezone: true,
    }).notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("flight_telemetry_leases_device_uidx").on(t.deviceId),
    index("flight_telemetry_leases_tenant_device_idx").on(
      t.tenantId,
      t.deviceId,
    ),
    foreignKey({
      columns: [t.tenantId, t.flightId],
      foreignColumns: [flights.tenantId, flights.id],
      name: "flight_telemetry_leases_tenant_flight_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.tenantId, t.membershipId],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: "flight_telemetry_leases_tenant_member_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.tenantId, t.membershipId, t.deviceId],
      foreignColumns: [
        simulatorDevices.tenantId,
        simulatorDevices.membershipId,
        simulatorDevices.id,
      ],
      name: "flight_telemetry_leases_tenant_member_device_fk",
    }).onDelete("cascade"),
  ],
);

/** Retained, bounded flight track used for operational replay and export. */
export const flightTelemetryTrack = pgTable(
  "flight_telemetry_track",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    flightId: uuid("flight_id")
      .notNull()
      .references(() => flights.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => simulatorDevices.id, { onDelete: "cascade" }),
    phase: telemetryPhaseEnum("phase").notNull(),
    latitude: doublePrecision("latitude").notNull(),
    longitude: doublePrecision("longitude").notNull(),
    altitudeFeet: integer("altitude_feet").notNull(),
    groundSpeedKnots: integer("ground_speed_knots").notNull(),
    headingDegrees: doublePrecision("heading_degrees").notNull(),
    simulatorTime: timestamp("simulator_time", {
      withTimezone: true,
    }).notNull(),
    sampleAt: timestamp("sample_at", { withTimezone: true }).notNull(),
    sequence: integer("sequence").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("flight_telemetry_track_flight_sample_idx").on(
      t.tenantId,
      t.flightId,
      t.sampleAt,
    ),
    foreignKey({
      columns: [t.tenantId, t.flightId],
      foreignColumns: [flights.tenantId, flights.id],
      name: "flight_telemetry_track_tenant_flight_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.tenantId, t.membershipId],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: "flight_telemetry_track_tenant_member_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.tenantId, t.membershipId, t.deviceId],
      foreignColumns: [
        simulatorDevices.tenantId,
        simulatorDevices.membershipId,
        simulatorDevices.id,
      ],
      name: "flight_telemetry_track_tenant_member_device_fk",
    }).onDelete("cascade"),
  ],
);

/** Append-only provenance for automatic and manually corrected OOOI values. */
export const flightOooiEvents = pgTable(
  "flight_oooi_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    flightId: uuid("flight_id")
      .notNull()
      .references(() => flights.id, { onDelete: "cascade" }),
    eventType: oooiEventTypeEnum("event_type").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    source: oooiSourceEnum("source").notNull(),
    actorMembershipId: uuid("actor_membership_id").references(
      () => memberships.id,
      { onDelete: "restrict" },
    ),
    deviceId: uuid("device_id").references(() => simulatorDevices.id, {
      onDelete: "restrict",
    }),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("flight_oooi_events_flight_created_idx").on(
      t.tenantId,
      t.flightId,
      t.createdAt,
    ),
    foreignKey({
      columns: [t.tenantId, t.flightId],
      foreignColumns: [flights.tenantId, flights.id],
      name: "flight_oooi_events_tenant_flight_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.tenantId, t.actorMembershipId],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: "flight_oooi_events_tenant_actor_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.tenantId, t.deviceId],
      foreignColumns: [simulatorDevices.tenantId, simulatorDevices.id],
      name: "flight_oooi_events_tenant_device_fk",
    }).onDelete("restrict"),
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
    deliveryStatus: acarsDeliveryStatusEnum("delivery_status"),
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

/** Auditable source-of-truth events behind tracked flight progress. */
export const flightOperationalEvents = pgTable(
  "flight_operational_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    flightId: uuid("flight_id")
      .notNull()
      .references(() => flights.id, { onDelete: "cascade" }),
    kind: flightEventKindEnum("kind").notNull(),
    source: flightEventSourceEnum("source").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    actorMembershipId: uuid("actor_membership_id").references(
      () => memberships.id,
      { onDelete: "set null" },
    ),
    acarsMessageId: uuid("acars_message_id").references(
      () => acarsMessages.id,
      {
        onDelete: "set null",
      },
    ),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("flight_operational_events_tenant_flight_idx").on(
      t.tenantId,
      t.flightId,
      t.occurredAt,
    ),
    uniqueIndex("flight_operational_events_acars_kind_uidx").on(
      t.acarsMessageId,
      t.kind,
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

/**
 * Immutable, tenant-approved retention policy versions. Only one version may
 * be active; material lifecycle execution requires a policy approved by a
 * second administrator.
 */
export const privacyPolicies = pgTable(
  "privacy_policies",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    status: privacyPolicyStatusEnum("status").notNull().default("draft"),
    config: jsonb("config")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdByMembershipId: uuid("created_by_membership_id").references(
      () => memberships.id,
      { onDelete: "set null" },
    ),
    approvedByMembershipId: uuid("approved_by_membership_id").references(
      () => memberships.id,
      { onDelete: "set null" },
    ),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    effectiveAt: timestamp("effective_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("privacy_policies_tenant_version_uidx").on(
      t.tenantId,
      t.version,
    ),
    uniqueIndex("privacy_policies_one_active_uidx")
      .on(t.tenantId)
      .where(sql`${t.status} = 'active'`),
    index("privacy_policies_tenant_status_idx").on(t.tenantId, t.status),
    check("privacy_policies_version_check", sql`${t.version} > 0`),
    check(
      "privacy_policies_distinct_approval_check",
      sql`${t.approvedByMembershipId} is null or ${t.createdByMembershipId} is null or ${t.approvedByMembershipId} <> ${t.createdByMembershipId}`,
    ),
  ],
);

/** Checkpointed, bounded retention reports and executions. */
export const privacyRetentionRuns = pgTable(
  "privacy_retention_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => privacyPolicies.id, { onDelete: "restrict" }),
    mode: privacyRunModeEnum("mode").notNull(),
    status: privacyRunStatusEnum("status").notNull().default("queued"),
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),
    dryRunId: uuid("dry_run_id").references(
      (): AnyPgColumn => privacyRetentionRuns.id,
      { onDelete: "restrict" },
    ),
    idempotencyKey: text("idempotency_key").notNull(),
    cursor: jsonb("cursor")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    report: jsonb("report")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    requestedByMembershipId: uuid("requested_by_membership_id").references(
      () => memberships.id,
      { onDelete: "set null" },
    ),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    lastError: text("last_error"),
    attemptCount: integer("attempt_count").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("privacy_retention_runs_tenant_idempotency_uidx").on(
      t.tenantId,
      t.idempotencyKey,
    ),
    index("privacy_retention_runs_status_created_idx").on(
      t.status,
      t.createdAt,
    ),
    index("privacy_retention_runs_tenant_created_idx").on(
      t.tenantId,
      t.createdAt,
    ),
    check(
      "privacy_retention_runs_attempt_count_check",
      sql`${t.attemptCount} >= 0`,
    ),
    check(
      "privacy_retention_runs_dry_run_check",
      sql`(${t.mode} = 'dry_run' and ${t.dryRunId} is null) or (${t.mode} = 'execute' and ${t.dryRunId} is not null)`,
    ),
  ],
);

/** Verified data-subject or tenant-level privacy workflow. */
export const privacySubjectRequests = pgTable(
  "privacy_subject_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    scope: privacyRequestScopeEnum("scope").notNull(),
    subjectMembershipId: uuid("subject_membership_id").references(
      () => memberships.id,
      { onDelete: "set null" },
    ),
    subjectReference: text("subject_reference").notNull(),
    kind: privacyRequestKindEnum("kind").notNull(),
    status: privacyRequestStatusEnum("status")
      .notNull()
      .default("pending_verification"),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    result: jsonb("result")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdByMembershipId: uuid("created_by_membership_id").references(
      () => memberships.id,
      { onDelete: "set null" },
    ),
    verifiedByMembershipId: uuid("verified_by_membership_id").references(
      () => memberships.id,
      { onDelete: "set null" },
    ),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    approvedByMembershipId: uuid("approved_by_membership_id").references(
      () => memberships.id,
      { onDelete: "set null" },
    ),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    lastError: text("last_error"),
    ...timestamps,
  },
  (t) => [
    index("privacy_subject_requests_tenant_status_idx").on(
      t.tenantId,
      t.status,
      t.createdAt,
    ),
    index("privacy_subject_requests_tenant_member_idx").on(
      t.tenantId,
      t.subjectMembershipId,
      t.createdAt,
    ),
    check(
      "privacy_subject_requests_scope_check",
      sql`${t.scope} = 'tenant' or ${t.subjectMembershipId} is not null or ${t.status} not in ('pending_verification', 'pending_approval')`,
    ),
    check(
      "privacy_subject_requests_distinct_approval_check",
      sql`${t.approvedByMembershipId} is null or ${t.createdByMembershipId} is null or ${t.approvedByMembershipId} <> ${t.createdByMembershipId}`,
    ),
  ],
);

/** Active restriction and objection flags enforced for optional processors. */
export const privacySubjectControls = pgTable(
  "privacy_subject_controls",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
    restrictedAt: timestamp("restricted_at", { withTimezone: true }),
    restrictionReason: text("restriction_reason"),
    objectedAt: timestamp("objected_at", { withTimezone: true }),
    objectionScopes: jsonb("objection_scopes")
      .$type<string[]>()
      .notNull()
      .default([]),
    updatedByMembershipId: uuid("updated_by_membership_id").references(
      () => memberships.id,
      { onDelete: "set null" },
    ),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("privacy_subject_controls_tenant_member_uidx").on(
      t.tenantId,
      t.membershipId,
    ),
  ],
);

/** Two-person approved legal or claims preservation exception. */
export const privacyLegalHolds = pgTable(
  "privacy_legal_holds",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    subjectMembershipId: uuid("subject_membership_id").references(
      () => memberships.id,
      { onDelete: "set null" },
    ),
    status: privacyHoldStatusEnum("status").notNull().default("pending"),
    scope: text("scope").notNull(),
    reason: text("reason").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdByMembershipId: uuid("created_by_membership_id").references(
      () => memberships.id,
      { onDelete: "set null" },
    ),
    approvedByMembershipId: uuid("approved_by_membership_id").references(
      () => memberships.id,
      { onDelete: "set null" },
    ),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    releasedByMembershipId: uuid("released_by_membership_id").references(
      () => memberships.id,
      { onDelete: "set null" },
    ),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("privacy_legal_holds_tenant_status_idx").on(t.tenantId, t.status),
    index("privacy_legal_holds_tenant_member_idx").on(
      t.tenantId,
      t.subjectMembershipId,
    ),
    check(
      "privacy_legal_holds_distinct_approval_check",
      sql`${t.approvedByMembershipId} is null or ${t.createdByMembershipId} is null or ${t.approvedByMembershipId} <> ${t.createdByMembershipId}`,
    ),
  ],
);

/** Provider/operator follow-up that cannot safely be performed in-process. */
export const privacyExternalTasks = pgTable(
  "privacy_external_tasks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    requestId: uuid("request_id").references(() => privacySubjectRequests.id, {
      onDelete: "cascade",
    }),
    runId: uuid("run_id").references(() => privacyRetentionRuns.id, {
      onDelete: "cascade",
    }),
    provider: privacyExternalProviderEnum("provider").notNull(),
    action: text("action").notNull(),
    status: privacyExternalTaskStatusEnum("status")
      .notNull()
      .default("pending"),
    operatorNote: text("operator_note"),
    completedByMembershipId: uuid("completed_by_membership_id").references(
      () => memberships.id,
      { onDelete: "set null" },
    ),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("privacy_external_tasks_request_provider_action_uidx").on(
      t.requestId,
      t.provider,
      t.action,
    ),
    uniqueIndex("privacy_external_tasks_run_provider_action_uidx").on(
      t.runId,
      t.provider,
      t.action,
    ),
    index("privacy_external_tasks_tenant_status_idx").on(t.tenantId, t.status),
    check(
      "privacy_external_tasks_parent_check",
      sql`(${t.requestId} is not null)::int + (${t.runId} is not null)::int = 1`,
    ),
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
export type ScheduleFulfillmentAttempt =
  typeof scheduleFulfillmentAttempts.$inferSelect;
export type NavigraphOauthTransaction =
  typeof navigraphOauthTransactions.$inferSelect;
export type SimbriefDispatch = typeof simbriefDispatches.$inferSelect;
export type DispatchRelease = typeof dispatchReleases.$inferSelect;
export type FlightOperationalEvent =
  typeof flightOperationalEvents.$inferSelect;
export type SimbriefFlightHead = typeof simbriefFlightHeads.$inferSelect;
export type SimulatorDevice = typeof simulatorDevices.$inferSelect;
export type FlightTelemetryCurrent = typeof flightTelemetryCurrent.$inferSelect;
export type FlightTelemetryLease = typeof flightTelemetryLeases.$inferSelect;
export type FlightTelemetryTrack = typeof flightTelemetryTrack.$inferSelect;
export type FlightOooiEvent = typeof flightOooiEvents.$inferSelect;
export type AcarsMessage = typeof acarsMessages.$inferSelect;
export type MemberRole = (typeof memberRoleEnum.enumValues)[number];
export type FlightStatus = (typeof flightStatusEnum.enumValues)[number];
export type ScheduleRequestStatus =
  (typeof scheduleRequestStatusEnum.enumValues)[number];
export type SimbriefDispatchStatus =
  (typeof simbriefDispatchStatusEnum.enumValues)[number];
export type BrandPresence = (typeof brandPresenceEnum.enumValues)[number];
export type DispatchUnit = (typeof dispatchUnitEnum.enumValues)[number];
export type FlightEventKind = (typeof flightEventKindEnum.enumValues)[number];
export type FlightEventSource =
  (typeof flightEventSourceEnum.enumValues)[number];
export type TelemetryPhase = (typeof telemetryPhaseEnum.enumValues)[number];
export type PrivacyPolicy = typeof privacyPolicies.$inferSelect;
export type PrivacyRetentionRun = typeof privacyRetentionRuns.$inferSelect;
export type PrivacySubjectRequest = typeof privacySubjectRequests.$inferSelect;
export type PrivacySubjectControl = typeof privacySubjectControls.$inferSelect;
export type PrivacyLegalHold = typeof privacyLegalHolds.$inferSelect;
export type PrivacyExternalTask = typeof privacyExternalTasks.$inferSelect;
