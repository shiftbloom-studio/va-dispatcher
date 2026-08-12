-- Issue #22 reviewed additive schema delta.
--
-- This is intentionally a migration fragment, not a replacement baseline.
-- Transplant it into the versioned migration chain established by issue #25
-- after the post-PR-#14/#21 schema is present. It does not contact a database
-- and must be exercised against a disposable restored snapshot before rollout.

BEGIN;

CREATE TYPE "simulator_device_status" AS ENUM ('active', 'revoked');
CREATE TYPE "telemetry_phase" AS ENUM (
  'preflight',
  'taxi_out',
  'airborne',
  'taxi_in',
  'parked'
);
CREATE TYPE "oooi_event_type" AS ENUM ('out', 'off', 'on', 'in');
CREATE TYPE "oooi_source" AS ENUM ('telemetry', 'manual');

ALTER TABLE "flights"
  ADD COLUMN "out_manual_override" boolean DEFAULT false NOT NULL,
  ADD COLUMN "off_manual_override" boolean DEFAULT false NOT NULL,
  ADD COLUMN "on_manual_override" boolean DEFAULT false NOT NULL,
  ADD COLUMN "in_manual_override" boolean DEFAULT false NOT NULL;

-- Composite target keys let every telemetry edge prove tenant coherence in
-- PostgreSQL rather than relying on route filters. If issue #17 already added
-- equivalent keys during integration, retain one canonical index per target.
CREATE UNIQUE INDEX IF NOT EXISTS "memberships_tenant_id_uidx"
  ON "memberships" ("tenant_id", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "flights_tenant_id_uidx"
  ON "flights" ("tenant_id", "id");

CREATE TABLE "simulator_devices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "membership_id" uuid NOT NULL REFERENCES "memberships"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "token_mac" text NOT NULL,
  "status" "simulator_device_status" DEFAULT 'active' NOT NULL,
  "last_sequence" integer,
  "last_ingest_at" timestamp with time zone,
  "last_seen_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX "simulator_devices_tenant_member_idx"
  ON "simulator_devices" ("tenant_id", "membership_id");
CREATE UNIQUE INDEX "simulator_devices_tenant_id_uidx"
  ON "simulator_devices" ("tenant_id", "id");
CREATE UNIQUE INDEX "simulator_devices_tenant_member_id_uidx"
  ON "simulator_devices" ("tenant_id", "membership_id", "id");
ALTER TABLE "simulator_devices"
  ADD CONSTRAINT "simulator_devices_tenant_member_fk"
  FOREIGN KEY ("tenant_id", "membership_id")
  REFERENCES "memberships" ("tenant_id", "id") ON DELETE CASCADE;

CREATE TABLE "flight_telemetry_current" (
  "flight_id" uuid PRIMARY KEY REFERENCES "flights"("id") ON DELETE CASCADE,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "membership_id" uuid NOT NULL REFERENCES "memberships"("id") ON DELETE CASCADE,
  "device_id" uuid NOT NULL REFERENCES "simulator_devices"("id") ON DELETE CASCADE,
  "phase" "telemetry_phase" NOT NULL,
  "latitude" double precision NOT NULL,
  "longitude" double precision NOT NULL,
  "altitude_feet" integer NOT NULL,
  "ground_speed_knots" integer NOT NULL,
  "heading_degrees" double precision NOT NULL,
  "simulator_time" timestamp with time zone NOT NULL,
  "sample_at" timestamp with time zone NOT NULL,
  "sequence" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX "flight_telemetry_current_tenant_sample_idx"
  ON "flight_telemetry_current" ("tenant_id", "sample_at");
CREATE INDEX "flight_telemetry_current_member_idx"
  ON "flight_telemetry_current" ("tenant_id", "membership_id");
ALTER TABLE "flight_telemetry_current"
  ADD CONSTRAINT "flight_telemetry_current_tenant_flight_fk"
    FOREIGN KEY ("tenant_id", "flight_id")
    REFERENCES "flights" ("tenant_id", "id") ON DELETE CASCADE,
  ADD CONSTRAINT "flight_telemetry_current_tenant_member_fk"
    FOREIGN KEY ("tenant_id", "membership_id")
    REFERENCES "memberships" ("tenant_id", "id") ON DELETE CASCADE,
  ADD CONSTRAINT "flight_telemetry_current_tenant_member_device_fk"
    FOREIGN KEY ("tenant_id", "membership_id", "device_id")
    REFERENCES "simulator_devices" ("tenant_id", "membership_id", "id")
    ON DELETE CASCADE;

CREATE TABLE "flight_telemetry_leases" (
  "flight_id" uuid PRIMARY KEY REFERENCES "flights"("id") ON DELETE CASCADE,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "membership_id" uuid NOT NULL REFERENCES "memberships"("id") ON DELETE CASCADE,
  "device_id" uuid NOT NULL REFERENCES "simulator_devices"("id") ON DELETE CASCADE,
  "lease_expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX "flight_telemetry_leases_tenant_device_idx"
  ON "flight_telemetry_leases" ("tenant_id", "device_id");
CREATE UNIQUE INDEX "flight_telemetry_leases_device_uidx"
  ON "flight_telemetry_leases" ("device_id");
ALTER TABLE "flight_telemetry_leases"
  ADD CONSTRAINT "flight_telemetry_leases_tenant_flight_fk"
    FOREIGN KEY ("tenant_id", "flight_id")
    REFERENCES "flights" ("tenant_id", "id") ON DELETE CASCADE,
  ADD CONSTRAINT "flight_telemetry_leases_tenant_member_fk"
    FOREIGN KEY ("tenant_id", "membership_id")
    REFERENCES "memberships" ("tenant_id", "id") ON DELETE CASCADE,
  ADD CONSTRAINT "flight_telemetry_leases_tenant_member_device_fk"
    FOREIGN KEY ("tenant_id", "membership_id", "device_id")
    REFERENCES "simulator_devices" ("tenant_id", "membership_id", "id")
    ON DELETE CASCADE;

CREATE TABLE "flight_telemetry_track" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "flight_id" uuid NOT NULL REFERENCES "flights"("id") ON DELETE CASCADE,
  "membership_id" uuid NOT NULL REFERENCES "memberships"("id") ON DELETE CASCADE,
  "device_id" uuid NOT NULL REFERENCES "simulator_devices"("id") ON DELETE CASCADE,
  "phase" "telemetry_phase" NOT NULL,
  "latitude" double precision NOT NULL,
  "longitude" double precision NOT NULL,
  "altitude_feet" integer NOT NULL,
  "ground_speed_knots" integer NOT NULL,
  "heading_degrees" double precision NOT NULL,
  "simulator_time" timestamp with time zone NOT NULL,
  "sample_at" timestamp with time zone NOT NULL,
  "sequence" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX "flight_telemetry_track_flight_sample_idx"
  ON "flight_telemetry_track" ("tenant_id", "flight_id", "sample_at");
ALTER TABLE "flight_telemetry_track"
  ADD CONSTRAINT "flight_telemetry_track_tenant_flight_fk"
    FOREIGN KEY ("tenant_id", "flight_id")
    REFERENCES "flights" ("tenant_id", "id") ON DELETE CASCADE,
  ADD CONSTRAINT "flight_telemetry_track_tenant_member_fk"
    FOREIGN KEY ("tenant_id", "membership_id")
    REFERENCES "memberships" ("tenant_id", "id") ON DELETE CASCADE,
  ADD CONSTRAINT "flight_telemetry_track_tenant_member_device_fk"
    FOREIGN KEY ("tenant_id", "membership_id", "device_id")
    REFERENCES "simulator_devices" ("tenant_id", "membership_id", "id")
    ON DELETE CASCADE;

CREATE TABLE "flight_oooi_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "flight_id" uuid NOT NULL REFERENCES "flights"("id") ON DELETE CASCADE,
  "event_type" "oooi_event_type" NOT NULL,
  "occurred_at" timestamp with time zone,
  "source" "oooi_source" NOT NULL,
  "actor_membership_id" uuid REFERENCES "memberships"("id") ON DELETE SET NULL,
  "device_id" uuid REFERENCES "simulator_devices"("id") ON DELETE SET NULL,
  "reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX "flight_oooi_events_flight_created_idx"
  ON "flight_oooi_events" ("tenant_id", "flight_id", "created_at");
ALTER TABLE "flight_oooi_events"
  ADD CONSTRAINT "flight_oooi_events_tenant_flight_fk"
    FOREIGN KEY ("tenant_id", "flight_id")
    REFERENCES "flights" ("tenant_id", "id") ON DELETE CASCADE,
  ADD CONSTRAINT "flight_oooi_events_tenant_actor_fk"
    FOREIGN KEY ("tenant_id", "actor_membership_id")
    REFERENCES "memberships" ("tenant_id", "id"),
  ADD CONSTRAINT "flight_oooi_events_tenant_device_fk"
    FOREIGN KEY ("tenant_id", "device_id")
    REFERENCES "simulator_devices" ("tenant_id", "id");

COMMIT;

-- Rollback is intentionally not automated here. Before production rollback,
-- preserve/export operational telemetry and provenance if required, then drop
-- the four tables in reverse dependency order and finally drop the four enums.
