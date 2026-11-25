import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  check,
  foreignKey,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * D1 (SQLite) has no native enum, UUID, timestamp, or JSONB types. These
 * helpers keep the column definitions close to the domain vocabulary:
 * enums are TEXT columns with a CHECK constraint, UUIDs are canonical
 * lowercase TEXT, timestamps are integer milliseconds since the epoch, and
 * JSON documents are TEXT validated with `json_valid`.
 */
function sqliteEnum<const T extends readonly [string, ...string[]]>(
  enumName: string,
  values: T,
) {
  const column = (name: string) => text(name, { enum: values });
  return Object.assign(column, { enumName, enumValues: values });
}

/** SQL default producing an RFC 4122 version 4 UUID string. */
export const uuidV4Sql = sql`(lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))))`;

/** SQL default for the current time in epoch milliseconds. */
export const nowMsSql = sql`(cast(unixepoch('subsec') * 1000 as integer))`;

const uuid = (name: string) => text(name);
const uuidPk = (name: string) =>
  text(name)
    .primaryKey()
    .default(uuidV4Sql)
    .$defaultFn(() => crypto.randomUUID());
const timestamp = (name: string) => integer(name, { mode: "timestamp_ms" });
const jsonb = (name: string) => text(name, { mode: "json" });
const boolean = (name: string) => integer(name, { mode: "boolean" });
const doublePrecision = (name: string) => real(name);

export const memberRoleEnum = sqliteEnum("member_role", [
  "pilot",
  "dispatcher",
  "admin",
]);

export const memberStatusEnum = sqliteEnum("member_status", [
  "active",
  "invited",
  "disabled",
]);

export const scheduleRequestStatusEnum = sqliteEnum("schedule_request_status", [
  "pending",
  "in_review",
  "fulfilled",
  "partially_fulfilled",
  "rejected",
  "cancelled",
]);

export const flightStatusEnum = sqliteEnum("flight_status", [
  "draft",
  "offered",
  "accepted",
  "declined",
  "briefed",
  "active",
  "completed",
  "cancelled",
]);

export const acarsDirectionEnum = sqliteEnum("acars_direction", [
  "inbound",
  "outbound",
]);

export const acarsMsgTypeEnum = sqliteEnum("acars_msg_type", [
  "telex",
  "progress",
  "cpdlc",
  "position",
  "other",
]);

export const acarsProviderEnum = sqliteEnum("acars_provider", ["mock", "hoppie"]);

export const acarsDeliveryStatusEnum = sqliteEnum("acars_delivery_status", [
  "pending",
  "accepted",
  "rejected",
  "ambiguous",
]);

export const simbriefDispatchStatusEnum = sqliteEnum("simbrief_dispatch_status", [
  "prepared",
  "pending",
  "ready",
]);

export const brandPresenceEnum = sqliteEnum("brand_presence", [
  "restrained",
  "balanced",
  "high",
]);

export const dispatchUnitEnum = sqliteEnum("dispatch_unit", ["kg", "lb"]);

export const flightEventKindEnum = sqliteEnum("flight_event_kind", [
  "flt_init",
  "out",
  "off",
  "on",
  "in",
  "manual_start",
  "manual_finish",
  "assignment_confirmed",
]);

export const flightEventSourceEnum = sqliteEnum("flight_event_source", [
  "hoppie",
  "pilot_web",
  "dispatcher",
]);

export const simulatorDeviceStatusEnum = sqliteEnum("simulator_device_status", [
  "active",
  "revoked",
]);

export const telemetryPhaseEnum = sqliteEnum("telemetry_phase", [
  "preflight",
  "taxi_out",
  "airborne",
  "taxi_in",
  "parked",
]);

export const oooiEventTypeEnum = sqliteEnum("oooi_event_type", [
  "out",
  "off",
  "on",
  "in",
]);

export const oooiSourceEnum = sqliteEnum("oooi_source", ["telemetry", "manual"]);

export const privacyPolicyStatusEnum = sqliteEnum("privacy_policy_status", [
  "draft",
  "active",
  "retired",
]);

export const privacyRunModeEnum = sqliteEnum("privacy_run_mode", [
  "dry_run",
  "execute",
]);

export const privacyRunStatusEnum = sqliteEnum("privacy_run_status", [
  "queued",
  "running",
  "completed",
  "failed",
]);

export const privacyRequestScopeEnum = sqliteEnum("privacy_request_scope", [
  "member",
  "tenant",
]);

export const privacyRequestKindEnum = sqliteEnum("privacy_request_kind", [
  "export",
  "correction",
  "restriction",
  "objection",
  "anonymization",
  "erasure",
]);

export const privacyRequestStatusEnum = sqliteEnum("privacy_request_status", [
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

export const privacyHoldStatusEnum = sqliteEnum("privacy_hold_status", [
  "pending",
  "active",
  "released",
]);

export const privacyExternalProviderEnum = sqliteEnum("privacy_external_provider", [
  "clerk",
  "vercel",
  "neon",
  "hoppie",
  "backup",
  "navigraph",
]);

export const privacyExternalTaskStatusEnum = sqliteEnum(
  "privacy_external_task_status",
  ["pending", "completed", "not_applicable", "failed"],
);

const timestamps = {
  createdAt: timestamp("created_at")
    .notNull()
    .default(nowMsSql)
      .$defaultFn(() => new Date()),
  updatedAt: timestamp("updated_at")
    .notNull()
    .default(nowMsSql)
      .$defaultFn(() => new Date())
    .$onUpdate(() => new Date()),
};

export const tenants = sqliteTable(
  "tenants",
  {
    id: uuidPk("id"),
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
    check(
      "tenants_brand_presence_enum_check",
      sql`${t.brandPresence} in ('restrained', 'balanced', 'high')`,
    ),
    uniqueIndex("tenants_slug_uidx").on(t.slug),
    uniqueIndex("tenants_clerk_org_uidx").on(t.clerkOrgId),
    check(
      "tenants_brand_seed_color_check",
      sql`length(${t.brandSeedColor}) = 7 and ${t.brandSeedColor} glob '#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'`,
    ),
  ],
);

export const memberships = sqliteTable(
  "memberships",
  {
    id: uuidPk("id"),
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
    simbriefVerifiedAt: timestamp("simbrief_verified_at"),
    navigraphSubject: text("navigraph_subject"),
    navigraphUsername: text("navigraph_username"),
    navigraphConnectedAt: timestamp("navigraph_connected_at"),
    status: memberStatusEnum("status").notNull().default("active"),
    ...timestamps,
  },
  (t) => [
    check(
      "memberships_role_enum_check",
      sql`${t.role} in ('pilot', 'dispatcher', 'admin')`,
    ),
    check(
      "memberships_status_enum_check",
      sql`${t.status} in ('active', 'invited', 'disabled')`,
    ),
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

export const scheduleRequests = sqliteTable(
  "schedule_requests",
  {
    id: uuidPk("id"),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    pilotMembershipId: uuid("pilot_membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "restrict" }),
    title: text("title"),
    notes: text("notes"),
    windowStart: timestamp("window_start").notNull(),
    windowEnd: timestamp("window_end").notNull(),
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
    check(
      "schedule_requests_status_enum_check",
      sql`${t.status} in ('pending', 'in_review', 'fulfilled', 'partially_fulfilled', 'rejected', 'cancelled')`,
    ),
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

export const flights = sqliteTable(
  "flights",
  {
    id: uuidPk("id"),
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
    etd: timestamp("etd").notNull(),
    eta: timestamp("eta").notNull(),
    aircraftType: text("aircraft_type"),
    version: integer("version").notNull().default(1),
    status: flightStatusEnum("status").notNull().default("draft"),
    cancelReason: text("cancel_reason"),
    declinedReason: text("declined_reason"),
    dispatcherNotes: text("dispatcher_notes"),
    assignmentRevision: integer("assignment_revision").notNull().default(1),
    assignmentConfirmedRevision: integer("assignment_confirmed_revision"),
    assignmentConfirmedAt: timestamp("assignment_confirmed_at"),
    outAt: timestamp("out_at"),
    offAt: timestamp("off_at"),
    onAt: timestamp("on_at"),
    inAt: timestamp("in_at"),
    outManualOverride: boolean("out_manual_override").notNull().default(false),
    offManualOverride: boolean("off_manual_override").notNull().default(false),
    onManualOverride: boolean("on_manual_override").notNull().default(false),
    inManualOverride: boolean("in_manual_override").notNull().default(false),
    ...timestamps,
  },
  (t) => [
    check(
      "flights_status_enum_check",
      sql`${t.status} in ('draft', 'offered', 'accepted', 'declined', 'briefed', 'active', 'completed', 'cancelled')`,
    ),
    uniqueIndex("flights_tenant_id_uidx").on(t.tenantId, t.id),
    uniqueIndex("flights_tenant_replaces_uidx").on(
      t.tenantId,
      t.replacesFlightId,
    ),
    foreignKey({
      columns: [t.tenantId, t.replacesFlightId],
      foreignColumns: [t.tenantId, t.id],
      name: "flights_tenant_replaces_fkey",
    }).onDelete("no action"),
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
export const dispatchReleases = sqliteTable(
  "dispatch_releases",
  {
    id: uuidPk("id"),
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
    releasedAt: timestamp("released_at")
      .notNull()
      .default(nowMsSql)
      .$defaultFn(() => new Date()),
  },
  (t) => [
    check(
      "dispatch_releases_fuel_unit_enum_check",
      sql`${t.fuelUnit} in ('kg', 'lb')`,
    ),
    check(
      "dispatch_releases_payload_unit_enum_check",
      sql`${t.payloadUnit} in ('kg', 'lb')`,
    ),
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
export const scheduleFulfillmentAttempts = sqliteTable(
  "schedule_fulfillment_attempts",
  {
    id: uuidPk("id"),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    scheduleRequestId: uuid("schedule_request_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    payloadHash: text("payload_hash").notNull(),
    flightIds: jsonb("flight_ids").$type<string[]>().notNull(),
    requestStatus: scheduleRequestStatusEnum("request_status").notNull(),
    requestVersion: integer("request_version").notNull(),
    linkedFlightCount: integer("linked_flight_count").notNull(),
    remainingFlightCount: integer("remaining_flight_count").notNull(),
    createdAt: timestamp("created_at")
      .notNull()
      .default(nowMsSql)
      .$defaultFn(() => new Date()),
  },
  (t) => [
    check(
      "schedule_fulfillment_attempts_request_status_enum_check",
      sql`${t.requestStatus} in ('pending', 'in_review', 'fulfilled', 'partially_fulfilled', 'rejected', 'cancelled')`,
    ),
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
      sql`length(${t.idempotencyKey}) between 1 and 200`,
    ),
    check(
      "schedule_fulfillment_attempts_payload_hash_check",
      sql`length(${t.payloadHash}) = 64`,
    ),
    check(
      "schedule_fulfillment_attempts_flights_check",
      sql`json_array_length(${t.flightIds}) > 0`,
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
export const navigraphOauthTransactions = sqliteTable(
  "navigraph_oauth_transactions",
  {
    id: uuidPk("id"),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
    stateId: text("state_id").notNull(),
    codeVerifierEnc: text("code_verifier_enc").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    consumedAt: timestamp("consumed_at"),
    createdAt: timestamp("created_at")
      .notNull()
      .default(nowMsSql)
      .$defaultFn(() => new Date()),
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
export const simbriefDispatches = sqliteTable(
  "simbrief_dispatches",
  {
    id: uuidPk("id"),
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
    callbackExpiresAt: timestamp("callback_expires_at"),
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
    generatedAt: timestamp("generated_at"),
    syncedAt: timestamp("synced_at"),
    lastError: text("last_error"),
    ...timestamps,
  },
  (t) => [
    check(
      "simbrief_dispatches_status_enum_check",
      sql`${t.status} in ('prepared', 'pending', 'ready')`,
    ),
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
      sql`json_type(${t.flightSnapshot}) = 'object'`,
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
export const simbriefFlightHeads = sqliteTable(
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
export const simulatorDevices = sqliteTable(
  "simulator_devices",
  {
    id: uuidPk("id"),
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
    lastIngestAt: timestamp("last_ingest_at"),
    lastSeenAt: timestamp("last_seen_at"),
    revokedAt: timestamp("revoked_at"),
    ...timestamps,
  },
  (t) => [
    check(
      "simulator_devices_status_enum_check",
      sql`${t.status} in ('active', 'revoked')`,
    ),
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
export const flightTelemetryCurrent = sqliteTable(
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
    simulatorTime: timestamp("simulator_time").notNull(),
    sampleAt: timestamp("sample_at").notNull(),
    sequence: integer("sequence").notNull(),
    ...timestamps,
  },
  (t) => [
    check(
      "flight_telemetry_current_phase_enum_check",
      sql`${t.phase} in ('preflight', 'taxi_out', 'airborne', 'taxi_in', 'parked')`,
    ),
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
export const flightTelemetryLeases = sqliteTable(
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
    leaseExpiresAt: timestamp("lease_expires_at").notNull(),
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
export const flightTelemetryTrack = sqliteTable(
  "flight_telemetry_track",
  {
    id: uuidPk("id"),
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
    simulatorTime: timestamp("simulator_time").notNull(),
    sampleAt: timestamp("sample_at").notNull(),
    sequence: integer("sequence").notNull(),
    createdAt: timestamp("created_at")
      .notNull()
      .default(nowMsSql)
      .$defaultFn(() => new Date()),
  },
  (t) => [
    check(
      "flight_telemetry_track_phase_enum_check",
      sql`${t.phase} in ('preflight', 'taxi_out', 'airborne', 'taxi_in', 'parked')`,
    ),
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
export const flightOooiEvents = sqliteTable(
  "flight_oooi_events",
  {
    id: uuidPk("id"),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    flightId: uuid("flight_id")
      .notNull()
      .references(() => flights.id, { onDelete: "cascade" }),
    eventType: oooiEventTypeEnum("event_type").notNull(),
    occurredAt: timestamp("occurred_at"),
    source: oooiSourceEnum("source").notNull(),
    actorMembershipId: uuid("actor_membership_id").references(
      () => memberships.id,
      { onDelete: "restrict" },
    ),
    deviceId: uuid("device_id").references(() => simulatorDevices.id, {
      onDelete: "restrict",
    }),
    reason: text("reason"),
    createdAt: timestamp("created_at")
      .notNull()
      .default(nowMsSql)
      .$defaultFn(() => new Date()),
  },
  (t) => [
    check(
      "flight_oooi_events_event_type_enum_check",
      sql`${t.eventType} in ('out', 'off', 'on', 'in')`,
    ),
    check(
      "flight_oooi_events_source_enum_check",
      sql`${t.source} in ('telemetry', 'manual')`,
    ),
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

export const acarsMessages = sqliteTable(
  "acars_messages",
  {
    id: uuidPk("id"),
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
    receivedAt: timestamp("received_at"),
    sentAt: timestamp("sent_at"),
    ...timestamps,
  },
  (t) => [
    check(
      "acars_messages_direction_enum_check",
      sql`${t.direction} in ('inbound', 'outbound')`,
    ),
    check(
      "acars_messages_msg_type_enum_check",
      sql`${t.msgType} in ('telex', 'progress', 'cpdlc', 'position', 'other')`,
    ),
    check(
      "acars_messages_provider_enum_check",
      sql`${t.provider} in ('mock', 'hoppie')`,
    ),
    check(
      "acars_messages_delivery_status_enum_check",
      sql`${t.deliveryStatus} in ('pending', 'accepted', 'rejected', 'ambiguous')`,
    ),
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
export const flightOperationalEvents = sqliteTable(
  "flight_operational_events",
  {
    id: uuidPk("id"),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    flightId: uuid("flight_id")
      .notNull()
      .references(() => flights.id, { onDelete: "cascade" }),
    kind: flightEventKindEnum("kind").notNull(),
    source: flightEventSourceEnum("source").notNull(),
    occurredAt: timestamp("occurred_at").notNull(),
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
    createdAt: timestamp("created_at")
      .notNull()
      .default(nowMsSql)
      .$defaultFn(() => new Date()),
  },
  (t) => [
    check(
      "flight_operational_events_kind_enum_check",
      sql`${t.kind} in ('flt_init', 'out', 'off', 'on', 'in', 'manual_start', 'manual_finish', 'assignment_confirmed')`,
    ),
    check(
      "flight_operational_events_source_enum_check",
      sql`${t.source} in ('hoppie', 'pilot_web', 'dispatcher')`,
    ),
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

export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: uuidPk("id"),
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
    createdAt: timestamp("created_at")
      .notNull()
      .default(nowMsSql)
      .$defaultFn(() => new Date()),
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
export const privacyPolicies = sqliteTable(
  "privacy_policies",
  {
    id: uuidPk("id"),
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
    approvedAt: timestamp("approved_at"),
    effectiveAt: timestamp("effective_at"),
    ...timestamps,
  },
  (t) => [
    check(
      "privacy_policies_status_enum_check",
      sql`${t.status} in ('draft', 'active', 'retired')`,
    ),
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
export const privacyRetentionRuns = sqliteTable(
  "privacy_retention_runs",
  {
    id: uuidPk("id"),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => privacyPolicies.id, { onDelete: "restrict" }),
    mode: privacyRunModeEnum("mode").notNull(),
    status: privacyRunStatusEnum("status").notNull().default("queued"),
    asOf: timestamp("as_of").notNull(),
    dryRunId: uuid("dry_run_id").references(
      (): AnySQLiteColumn => privacyRetentionRuns.id,
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
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    lastError: text("last_error"),
    attemptCount: integer("attempt_count").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    check(
      "privacy_retention_runs_mode_enum_check",
      sql`${t.mode} in ('dry_run', 'execute')`,
    ),
    check(
      "privacy_retention_runs_status_enum_check",
      sql`${t.status} in ('queued', 'running', 'completed', 'failed')`,
    ),
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
export const privacySubjectRequests = sqliteTable(
  "privacy_subject_requests",
  {
    id: uuidPk("id"),
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
    verifiedAt: timestamp("verified_at"),
    approvedByMembershipId: uuid("approved_by_membership_id").references(
      () => memberships.id,
      { onDelete: "set null" },
    ),
    approvedAt: timestamp("approved_at"),
    processedAt: timestamp("processed_at"),
    lastError: text("last_error"),
    ...timestamps,
  },
  (t) => [
    check(
      "privacy_subject_requests_scope_enum_check",
      sql`${t.scope} in ('member', 'tenant')`,
    ),
    check(
      "privacy_subject_requests_kind_enum_check",
      sql`${t.kind} in ('export', 'correction', 'restriction', 'objection', 'anonymization', 'erasure')`,
    ),
    check(
      "privacy_subject_requests_status_enum_check",
      sql`${t.status} in ('pending_verification', 'pending_approval', 'approved', 'processing', 'awaiting_external', 'completed', 'blocked', 'failed', 'cancelled')`,
    ),
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
export const privacySubjectControls = sqliteTable(
  "privacy_subject_controls",
  {
    id: uuidPk("id"),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
    restrictedAt: timestamp("restricted_at"),
    restrictionReason: text("restriction_reason"),
    objectedAt: timestamp("objected_at"),
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
export const privacyLegalHolds = sqliteTable(
  "privacy_legal_holds",
  {
    id: uuidPk("id"),
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
    expiresAt: timestamp("expires_at"),
    createdByMembershipId: uuid("created_by_membership_id").references(
      () => memberships.id,
      { onDelete: "set null" },
    ),
    approvedByMembershipId: uuid("approved_by_membership_id").references(
      () => memberships.id,
      { onDelete: "set null" },
    ),
    approvedAt: timestamp("approved_at"),
    releasedByMembershipId: uuid("released_by_membership_id").references(
      () => memberships.id,
      { onDelete: "set null" },
    ),
    releasedAt: timestamp("released_at"),
    ...timestamps,
  },
  (t) => [
    check(
      "privacy_legal_holds_status_enum_check",
      sql`${t.status} in ('pending', 'active', 'released')`,
    ),
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
export const privacyExternalTasks = sqliteTable(
  "privacy_external_tasks",
  {
    id: uuidPk("id"),
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
    completedAt: timestamp("completed_at"),
    ...timestamps,
  },
  (t) => [
    check(
      "privacy_external_tasks_provider_enum_check",
      sql`${t.provider} in ('clerk', 'vercel', 'neon', 'hoppie', 'backup', 'navigraph')`,
    ),
    check(
      "privacy_external_tasks_status_enum_check",
      sql`${t.status} in ('pending', 'completed', 'not_applicable', 'failed')`,
    ),
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
      sql`(${t.requestId} is not null) + (${t.runId} is not null) = 1`,
    ),
  ],
);

/** Internal local/test queue used by the mock adapter. */
export const mockAcarsQueue = sqliteTable(
  "mock_acars_queue",
  {
    id: uuidPk("id"),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    toStation: text("to_station").notNull(),
    fromStation: text("from_station").notNull(),
    msgType: acarsMsgTypeEnum("msg_type").notNull().default("telex"),
    body: text("body").notNull(),
    delivered: timestamp("delivered_at"),
    createdAt: timestamp("created_at")
      .notNull()
      .default(nowMsSql)
      .$defaultFn(() => new Date()),
  },
  (t) => [
    check(
      "mock_acars_queue_msg_type_enum_check",
      sql`${t.msgType} in ('telex', 'progress', 'cpdlc', 'position', 'other')`,
    ),
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

/**
 * Assertion sink for atomic D1 batches. The table never holds a row: any
 * insert violates `batch_guard_rejected`, which aborts and rolls back the
 * whole batch. See `db/atomic.ts`.
 */
export const batchGuards = sqliteTable(
  "batch_guards",
  {
    reason: text("reason").notNull(),
  },
  () => [check("batch_guard_rejected", sql`0`)],
);
