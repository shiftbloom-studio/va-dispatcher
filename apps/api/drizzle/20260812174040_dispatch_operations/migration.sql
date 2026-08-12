CREATE TYPE "acars_delivery_status" AS ENUM('pending', 'accepted', 'rejected', 'ambiguous');--> statement-breakpoint
CREATE TYPE "oooi_event_type" AS ENUM('out', 'off', 'on', 'in');--> statement-breakpoint
CREATE TYPE "oooi_source" AS ENUM('telemetry', 'manual');--> statement-breakpoint
CREATE TYPE "privacy_external_provider" AS ENUM('clerk', 'vercel', 'neon', 'hoppie', 'backup', 'navigraph');--> statement-breakpoint
CREATE TYPE "privacy_external_task_status" AS ENUM('pending', 'completed', 'not_applicable', 'failed');--> statement-breakpoint
CREATE TYPE "privacy_hold_status" AS ENUM('pending', 'active', 'released');--> statement-breakpoint
CREATE TYPE "privacy_policy_status" AS ENUM('draft', 'active', 'retired');--> statement-breakpoint
CREATE TYPE "privacy_request_kind" AS ENUM('export', 'correction', 'restriction', 'objection', 'anonymization', 'erasure');--> statement-breakpoint
CREATE TYPE "privacy_request_scope" AS ENUM('member', 'tenant');--> statement-breakpoint
CREATE TYPE "privacy_request_status" AS ENUM('pending_verification', 'pending_approval', 'approved', 'processing', 'awaiting_external', 'completed', 'blocked', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "privacy_run_mode" AS ENUM('dry_run', 'execute');--> statement-breakpoint
CREATE TYPE "privacy_run_status" AS ENUM('queued', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "simulator_device_status" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TYPE "telemetry_phase" AS ENUM('preflight', 'taxi_out', 'airborne', 'taxi_in', 'parked');--> statement-breakpoint
ALTER TYPE "simbrief_dispatch_status" ADD VALUE 'prepared' BEFORE 'pending';--> statement-breakpoint
CREATE TABLE "flight_oooi_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL,
	"flight_id" uuid NOT NULL,
	"event_type" "oooi_event_type" NOT NULL,
	"occurred_at" timestamp with time zone,
	"source" "oooi_source" NOT NULL,
	"actor_membership_id" uuid,
	"device_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flight_telemetry_current" (
	"flight_id" uuid PRIMARY KEY,
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
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
--> statement-breakpoint
CREATE TABLE "flight_telemetry_leases" (
	"flight_id" uuid PRIMARY KEY,
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"lease_expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flight_telemetry_track" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL,
	"flight_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
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
--> statement-breakpoint
CREATE TABLE "privacy_external_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL,
	"request_id" uuid,
	"run_id" uuid,
	"provider" "privacy_external_provider" NOT NULL,
	"action" text NOT NULL,
	"status" "privacy_external_task_status" DEFAULT 'pending'::"privacy_external_task_status" NOT NULL,
	"operator_note" text,
	"completed_by_membership_id" uuid,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "privacy_external_tasks_parent_check" CHECK (("request_id" is not null)::int + ("run_id" is not null)::int = 1)
);
--> statement-breakpoint
CREATE TABLE "privacy_legal_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL,
	"subject_membership_id" uuid,
	"status" "privacy_hold_status" DEFAULT 'pending'::"privacy_hold_status" NOT NULL,
	"scope" text NOT NULL,
	"reason" text NOT NULL,
	"expires_at" timestamp with time zone,
	"created_by_membership_id" uuid,
	"approved_by_membership_id" uuid,
	"approved_at" timestamp with time zone,
	"released_by_membership_id" uuid,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "privacy_legal_holds_distinct_approval_check" CHECK ("approved_by_membership_id" is null or "created_by_membership_id" is null or "approved_by_membership_id" <> "created_by_membership_id")
);
--> statement-breakpoint
CREATE TABLE "privacy_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" "privacy_policy_status" DEFAULT 'draft'::"privacy_policy_status" NOT NULL,
	"config" jsonb DEFAULT '{}' NOT NULL,
	"created_by_membership_id" uuid,
	"approved_by_membership_id" uuid,
	"approved_at" timestamp with time zone,
	"effective_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "privacy_policies_version_check" CHECK ("version" > 0),
	CONSTRAINT "privacy_policies_distinct_approval_check" CHECK ("approved_by_membership_id" is null or "created_by_membership_id" is null or "approved_by_membership_id" <> "created_by_membership_id")
);
--> statement-breakpoint
CREATE TABLE "privacy_retention_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"mode" "privacy_run_mode" NOT NULL,
	"status" "privacy_run_status" DEFAULT 'queued'::"privacy_run_status" NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"dry_run_id" uuid,
	"idempotency_key" text NOT NULL,
	"cursor" jsonb DEFAULT '{}' NOT NULL,
	"report" jsonb DEFAULT '{}' NOT NULL,
	"requested_by_membership_id" uuid,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"last_error" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "privacy_retention_runs_attempt_count_check" CHECK ("attempt_count" >= 0),
	CONSTRAINT "privacy_retention_runs_dry_run_check" CHECK (("mode" = 'dry_run' and "dry_run_id" is null) or ("mode" = 'execute' and "dry_run_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "privacy_subject_controls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"restricted_at" timestamp with time zone,
	"restriction_reason" text,
	"objected_at" timestamp with time zone,
	"objection_scopes" jsonb DEFAULT '[]' NOT NULL,
	"updated_by_membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "privacy_subject_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL,
	"scope" "privacy_request_scope" NOT NULL,
	"subject_membership_id" uuid,
	"subject_reference" text NOT NULL,
	"kind" "privacy_request_kind" NOT NULL,
	"status" "privacy_request_status" DEFAULT 'pending_verification'::"privacy_request_status" NOT NULL,
	"payload" jsonb DEFAULT '{}' NOT NULL,
	"result" jsonb DEFAULT '{}' NOT NULL,
	"created_by_membership_id" uuid,
	"verified_by_membership_id" uuid,
	"verified_at" timestamp with time zone,
	"approved_by_membership_id" uuid,
	"approved_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "privacy_subject_requests_scope_check" CHECK ("scope" = 'tenant' or "subject_membership_id" is not null or "status" not in ('pending_verification', 'pending_approval')),
	CONSTRAINT "privacy_subject_requests_distinct_approval_check" CHECK ("approved_by_membership_id" is null or "created_by_membership_id" is null or "approved_by_membership_id" <> "created_by_membership_id")
);
--> statement-breakpoint
CREATE TABLE "schedule_fulfillment_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL,
	"schedule_request_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload_hash" text NOT NULL,
	"flight_ids" uuid[] NOT NULL,
	"request_status" "schedule_request_status" NOT NULL,
	"request_version" integer NOT NULL,
	"linked_flight_count" integer NOT NULL,
	"remaining_flight_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_fulfillment_attempts_key_check" CHECK (char_length("idempotency_key") between 1 and 200),
	CONSTRAINT "schedule_fulfillment_attempts_payload_hash_check" CHECK (char_length("payload_hash") = 64),
	CONSTRAINT "schedule_fulfillment_attempts_flights_check" CHECK (cardinality("flight_ids") > 0),
	CONSTRAINT "schedule_fulfillment_attempts_status_check" CHECK ("request_status" in ('partially_fulfilled', 'fulfilled')),
	CONSTRAINT "schedule_fulfillment_attempts_counts_check" CHECK ("request_version" > 1 and "linked_flight_count" > 0 and "remaining_flight_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "simbrief_flight_heads" (
	"flight_id" uuid PRIMARY KEY,
	"tenant_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "simbrief_flight_heads_positive_revision_check" CHECK ("revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "simulator_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_mac" text NOT NULL,
	"status" "simulator_device_status" DEFAULT 'active'::"simulator_device_status" NOT NULL,
	"last_sequence" integer,
	"last_ingest_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dispatch_releases" DROP CONSTRAINT "dispatch_releases_flight_id_flights_id_fkey";--> statement-breakpoint
ALTER TABLE "acars_messages" ADD COLUMN "delivery_status" "acars_delivery_status";--> statement-breakpoint
UPDATE "acars_messages"
SET "delivery_status" = 'accepted'
WHERE "direction" = 'outbound' AND "sent_at" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "flights" ADD COLUMN "replaces_flight_id" uuid;--> statement-breakpoint
ALTER TABLE "flights" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "flights" ADD COLUMN "out_manual_override" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "flights" ADD COLUMN "off_manual_override" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "flights" ADD COLUMN "on_manual_override" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "flights" ADD COLUMN "in_manual_override" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "schedule_requests" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "schedule_requests" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "simbrief_dispatches" ADD COLUMN "generated_by_membership_id" uuid;--> statement-breakpoint
ALTER TABLE "simbrief_dispatches" ADD COLUMN "callback_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "simbrief_dispatches" ADD COLUMN "revision" integer;--> statement-breakpoint
ALTER TABLE "simbrief_dispatches" ADD COLUMN "flight_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "simbrief_dispatches" ALTER COLUMN "simbrief_user_id" DROP NOT NULL;--> statement-breakpoint
WITH ranked_dispatches AS (
	SELECT
		dispatch.id,
		row_number() OVER (
			PARTITION BY dispatch.tenant_id, dispatch.flight_id
			ORDER BY dispatch.created_at, dispatch.id
		)::integer AS revision,
		jsonb_build_object(
			'flightVersion', 1,
			'assignmentRevision', flight.assignment_revision,
			'dispatchReleaseId', release.id,
			'dispatchReleaseRevision', release.revision,
			'pilotMembershipId', flight.pilot_membership_id,
			'flightNumber', flight.flight_number,
			'depIcao', flight.dep_icao,
			'arrIcao', flight.arr_icao,
			'etd', flight.etd,
			'eta', flight.eta,
			'aircraftType', flight.aircraft_type
		) AS flight_snapshot
	FROM simbrief_dispatches dispatch
	JOIN flights flight
		ON flight.tenant_id = dispatch.tenant_id
		AND flight.id = dispatch.flight_id
	LEFT JOIN LATERAL (
		SELECT dispatch_release.id, dispatch_release.revision
		FROM dispatch_releases dispatch_release
		WHERE dispatch_release.tenant_id = dispatch.tenant_id
			AND dispatch_release.flight_id = dispatch.flight_id
		ORDER BY dispatch_release.revision DESC
		LIMIT 1
	) release ON true
)
UPDATE simbrief_dispatches dispatch
SET
	"revision" = ranked.revision,
	"flight_snapshot" = ranked.flight_snapshot,
	"callback_expires_at" = CASE
		WHEN dispatch.callback_token_mac IS NOT NULL
			THEN dispatch.created_at + interval '30 minutes'
		ELSE NULL
	END
FROM ranked_dispatches ranked
WHERE dispatch.id = ranked.id;--> statement-breakpoint
ALTER TABLE "simbrief_dispatches" ALTER COLUMN "revision" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "simbrief_dispatches" ALTER COLUMN "flight_snapshot" SET NOT NULL;--> statement-breakpoint
INSERT INTO "simbrief_flight_heads" (
	"flight_id", "tenant_id", "revision"
)
SELECT "flight_id", "tenant_id", max("revision")
FROM "simbrief_dispatches"
GROUP BY "tenant_id", "flight_id";--> statement-breakpoint
CREATE INDEX "flight_oooi_events_flight_created_idx" ON "flight_oooi_events" ("tenant_id","flight_id","created_at");--> statement-breakpoint
CREATE INDEX "flight_telemetry_current_tenant_sample_idx" ON "flight_telemetry_current" ("tenant_id","sample_at");--> statement-breakpoint
CREATE INDEX "flight_telemetry_current_member_idx" ON "flight_telemetry_current" ("tenant_id","membership_id");--> statement-breakpoint
CREATE UNIQUE INDEX "flight_telemetry_leases_device_uidx" ON "flight_telemetry_leases" ("device_id");--> statement-breakpoint
CREATE INDEX "flight_telemetry_leases_tenant_device_idx" ON "flight_telemetry_leases" ("tenant_id","device_id");--> statement-breakpoint
CREATE INDEX "flight_telemetry_track_flight_sample_idx" ON "flight_telemetry_track" ("tenant_id","flight_id","sample_at");--> statement-breakpoint
CREATE UNIQUE INDEX "flights_tenant_id_uidx" ON "flights" ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "flights_tenant_replaces_uidx" ON "flights" ("tenant_id","replaces_flight_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_tenant_id_uidx" ON "memberships" ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "privacy_external_tasks_request_provider_action_uidx" ON "privacy_external_tasks" ("request_id","provider","action");--> statement-breakpoint
CREATE UNIQUE INDEX "privacy_external_tasks_run_provider_action_uidx" ON "privacy_external_tasks" ("run_id","provider","action");--> statement-breakpoint
CREATE INDEX "privacy_external_tasks_tenant_status_idx" ON "privacy_external_tasks" ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "privacy_legal_holds_tenant_status_idx" ON "privacy_legal_holds" ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "privacy_legal_holds_tenant_member_idx" ON "privacy_legal_holds" ("tenant_id","subject_membership_id");--> statement-breakpoint
CREATE UNIQUE INDEX "privacy_policies_tenant_version_uidx" ON "privacy_policies" ("tenant_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "privacy_policies_one_active_uidx" ON "privacy_policies" ("tenant_id") WHERE "status" = 'active';--> statement-breakpoint
CREATE INDEX "privacy_policies_tenant_status_idx" ON "privacy_policies" ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "privacy_retention_runs_tenant_idempotency_uidx" ON "privacy_retention_runs" ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "privacy_retention_runs_status_created_idx" ON "privacy_retention_runs" ("status","created_at");--> statement-breakpoint
CREATE INDEX "privacy_retention_runs_tenant_created_idx" ON "privacy_retention_runs" ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "privacy_subject_controls_tenant_member_uidx" ON "privacy_subject_controls" ("tenant_id","membership_id");--> statement-breakpoint
CREATE INDEX "privacy_subject_requests_tenant_status_idx" ON "privacy_subject_requests" ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "privacy_subject_requests_tenant_member_idx" ON "privacy_subject_requests" ("tenant_id","subject_membership_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_fulfillment_attempts_request_key_uidx" ON "schedule_fulfillment_attempts" ("tenant_id","schedule_request_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "schedule_fulfillment_attempts_request_idx" ON "schedule_fulfillment_attempts" ("tenant_id","schedule_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_requests_tenant_id_uidx" ON "schedule_requests" ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "simbrief_dispatches_tenant_flight_revision_uidx" ON "simbrief_dispatches" ("tenant_id","flight_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "simbrief_flight_heads_tenant_flight_uidx" ON "simbrief_flight_heads" ("tenant_id","flight_id");--> statement-breakpoint
CREATE INDEX "simulator_devices_tenant_member_idx" ON "simulator_devices" ("tenant_id","membership_id");--> statement-breakpoint
CREATE UNIQUE INDEX "simulator_devices_tenant_id_uidx" ON "simulator_devices" ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "simulator_devices_tenant_member_id_uidx" ON "simulator_devices" ("tenant_id","membership_id","id");--> statement-breakpoint
ALTER TABLE "dispatch_releases" ADD CONSTRAINT "dispatch_releases_tenant_flight_fk" FOREIGN KEY ("tenant_id","flight_id") REFERENCES "flights"("tenant_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "flight_oooi_events" ADD CONSTRAINT "flight_oooi_events_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "flight_oooi_events" ADD CONSTRAINT "flight_oooi_events_flight_id_flights_id_fkey" FOREIGN KEY ("flight_id") REFERENCES "flights"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "flight_oooi_events" ADD CONSTRAINT "flight_oooi_events_actor_membership_id_memberships_id_fkey" FOREIGN KEY ("actor_membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "flight_oooi_events" ADD CONSTRAINT "flight_oooi_events_device_id_simulator_devices_id_fkey" FOREIGN KEY ("device_id") REFERENCES "simulator_devices"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "flight_oooi_events" ADD CONSTRAINT "flight_oooi_events_tenant_flight_fk" FOREIGN KEY ("tenant_id","flight_id") REFERENCES "flights"("tenant_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "flight_oooi_events" ADD CONSTRAINT "flight_oooi_events_tenant_actor_fk" FOREIGN KEY ("tenant_id","actor_membership_id") REFERENCES "memberships"("tenant_id","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "flight_oooi_events" ADD CONSTRAINT "flight_oooi_events_tenant_device_fk" FOREIGN KEY ("tenant_id","device_id") REFERENCES "simulator_devices"("tenant_id","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "flight_telemetry_current" ADD CONSTRAINT "flight_telemetry_current_flight_id_flights_id_fkey" FOREIGN KEY ("flight_id") REFERENCES "flights"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "flight_telemetry_current" ADD CONSTRAINT "flight_telemetry_current_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "flight_telemetry_current" ADD CONSTRAINT "flight_telemetry_current_membership_id_memberships_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "flight_telemetry_current" ADD CONSTRAINT "flight_telemetry_current_device_id_simulator_devices_id_fkey" FOREIGN KEY ("device_id") REFERENCES "simulator_devices"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "flight_telemetry_current" ADD CONSTRAINT "flight_telemetry_current_tenant_flight_fk" FOREIGN KEY ("tenant_id","flight_id") REFERENCES "flights"("tenant_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "flight_telemetry_current" ADD CONSTRAINT "flight_telemetry_current_tenant_member_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "memberships"("tenant_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "flight_telemetry_current" ADD CONSTRAINT "flight_telemetry_current_tenant_member_device_fk" FOREIGN KEY ("tenant_id","membership_id","device_id") REFERENCES "simulator_devices"("tenant_id","membership_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "flight_telemetry_leases" ADD CONSTRAINT "flight_telemetry_leases_flight_id_flights_id_fkey" FOREIGN KEY ("flight_id") REFERENCES "flights"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "flight_telemetry_leases" ADD CONSTRAINT "flight_telemetry_leases_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "flight_telemetry_leases" ADD CONSTRAINT "flight_telemetry_leases_membership_id_memberships_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "flight_telemetry_leases" ADD CONSTRAINT "flight_telemetry_leases_device_id_simulator_devices_id_fkey" FOREIGN KEY ("device_id") REFERENCES "simulator_devices"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "flight_telemetry_leases" ADD CONSTRAINT "flight_telemetry_leases_tenant_flight_fk" FOREIGN KEY ("tenant_id","flight_id") REFERENCES "flights"("tenant_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "flight_telemetry_leases" ADD CONSTRAINT "flight_telemetry_leases_tenant_member_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "memberships"("tenant_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "flight_telemetry_leases" ADD CONSTRAINT "flight_telemetry_leases_tenant_member_device_fk" FOREIGN KEY ("tenant_id","membership_id","device_id") REFERENCES "simulator_devices"("tenant_id","membership_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "flight_telemetry_track" ADD CONSTRAINT "flight_telemetry_track_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "flight_telemetry_track" ADD CONSTRAINT "flight_telemetry_track_flight_id_flights_id_fkey" FOREIGN KEY ("flight_id") REFERENCES "flights"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "flight_telemetry_track" ADD CONSTRAINT "flight_telemetry_track_membership_id_memberships_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "flight_telemetry_track" ADD CONSTRAINT "flight_telemetry_track_device_id_simulator_devices_id_fkey" FOREIGN KEY ("device_id") REFERENCES "simulator_devices"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "flight_telemetry_track" ADD CONSTRAINT "flight_telemetry_track_tenant_flight_fk" FOREIGN KEY ("tenant_id","flight_id") REFERENCES "flights"("tenant_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "flight_telemetry_track" ADD CONSTRAINT "flight_telemetry_track_tenant_member_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "memberships"("tenant_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "flight_telemetry_track" ADD CONSTRAINT "flight_telemetry_track_tenant_member_device_fk" FOREIGN KEY ("tenant_id","membership_id","device_id") REFERENCES "simulator_devices"("tenant_id","membership_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "flights" ADD CONSTRAINT "flights_tenant_replaces_fkey" FOREIGN KEY ("tenant_id","replaces_flight_id") REFERENCES "flights"("tenant_id","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "flights" ADD CONSTRAINT "flights_tenant_pilot_fkey" FOREIGN KEY ("tenant_id","pilot_membership_id") REFERENCES "memberships"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "flights" ADD CONSTRAINT "flights_tenant_schedule_request_fkey" FOREIGN KEY ("tenant_id","schedule_request_id") REFERENCES "schedule_requests"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "privacy_external_tasks" ADD CONSTRAINT "privacy_external_tasks_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "privacy_external_tasks" ADD CONSTRAINT "privacy_external_tasks_xbCPrbEbWxFg_fkey" FOREIGN KEY ("request_id") REFERENCES "privacy_subject_requests"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "privacy_external_tasks" ADD CONSTRAINT "privacy_external_tasks_run_id_privacy_retention_runs_id_fkey" FOREIGN KEY ("run_id") REFERENCES "privacy_retention_runs"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "privacy_external_tasks" ADD CONSTRAINT "privacy_external_tasks_fHzPHfye2g6e_fkey" FOREIGN KEY ("completed_by_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "privacy_legal_holds" ADD CONSTRAINT "privacy_legal_holds_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "privacy_legal_holds" ADD CONSTRAINT "privacy_legal_holds_subject_membership_id_memberships_id_fkey" FOREIGN KEY ("subject_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "privacy_legal_holds" ADD CONSTRAINT "privacy_legal_holds_gL428MJ46l1R_fkey" FOREIGN KEY ("created_by_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "privacy_legal_holds" ADD CONSTRAINT "privacy_legal_holds_Lkh5hhlobgny_fkey" FOREIGN KEY ("approved_by_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "privacy_legal_holds" ADD CONSTRAINT "privacy_legal_holds_fka5AZryNNYo_fkey" FOREIGN KEY ("released_by_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "privacy_policies" ADD CONSTRAINT "privacy_policies_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "privacy_policies" ADD CONSTRAINT "privacy_policies_created_by_membership_id_memberships_id_fkey" FOREIGN KEY ("created_by_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "privacy_policies" ADD CONSTRAINT "privacy_policies_approved_by_membership_id_memberships_id_fkey" FOREIGN KEY ("approved_by_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "privacy_retention_runs" ADD CONSTRAINT "privacy_retention_runs_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "privacy_retention_runs" ADD CONSTRAINT "privacy_retention_runs_policy_id_privacy_policies_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "privacy_policies"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "privacy_retention_runs" ADD CONSTRAINT "privacy_retention_runs_Drhdyn6RJFgL_fkey" FOREIGN KEY ("dry_run_id") REFERENCES "privacy_retention_runs"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "privacy_retention_runs" ADD CONSTRAINT "privacy_retention_runs_jBGAnnworq8y_fkey" FOREIGN KEY ("requested_by_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "privacy_subject_controls" ADD CONSTRAINT "privacy_subject_controls_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "privacy_subject_controls" ADD CONSTRAINT "privacy_subject_controls_membership_id_memberships_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "privacy_subject_controls" ADD CONSTRAINT "privacy_subject_controls_9nUCwDaQSWuz_fkey" FOREIGN KEY ("updated_by_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "privacy_subject_requests" ADD CONSTRAINT "privacy_subject_requests_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "privacy_subject_requests" ADD CONSTRAINT "privacy_subject_requests_tkm5UVzF22vw_fkey" FOREIGN KEY ("subject_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "privacy_subject_requests" ADD CONSTRAINT "privacy_subject_requests_Lskxhmb22jna_fkey" FOREIGN KEY ("created_by_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "privacy_subject_requests" ADD CONSTRAINT "privacy_subject_requests_8ZxEnqShdnfM_fkey" FOREIGN KEY ("verified_by_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "privacy_subject_requests" ADD CONSTRAINT "privacy_subject_requests_VCx8HjOa3sdP_fkey" FOREIGN KEY ("approved_by_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "schedule_fulfillment_attempts" ADD CONSTRAINT "schedule_fulfillment_attempts_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "schedule_fulfillment_attempts" ADD CONSTRAINT "schedule_fulfillment_attempts_tenant_request_fkey" FOREIGN KEY ("tenant_id","schedule_request_id") REFERENCES "schedule_requests"("tenant_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "schedule_requests" ADD CONSTRAINT "schedule_requests_tenant_pilot_fkey" FOREIGN KEY ("tenant_id","pilot_membership_id") REFERENCES "memberships"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "simbrief_dispatches" ADD CONSTRAINT "simbrief_dispatches_LkWK9hP35CGL_fkey" FOREIGN KEY ("generated_by_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "simbrief_dispatches" ADD CONSTRAINT "simbrief_dispatches_tenant_flight_fk" FOREIGN KEY ("tenant_id","flight_id") REFERENCES "flights"("tenant_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "simbrief_flight_heads" ADD CONSTRAINT "simbrief_flight_heads_flight_id_flights_id_fkey" FOREIGN KEY ("flight_id") REFERENCES "flights"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "simbrief_flight_heads" ADD CONSTRAINT "simbrief_flight_heads_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "simbrief_flight_heads" ADD CONSTRAINT "simbrief_flight_heads_tenant_flight_fk" FOREIGN KEY ("tenant_id","flight_id") REFERENCES "flights"("tenant_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "simulator_devices" ADD CONSTRAINT "simulator_devices_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "simulator_devices" ADD CONSTRAINT "simulator_devices_membership_id_memberships_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "simulator_devices" ADD CONSTRAINT "simulator_devices_tenant_member_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "memberships"("tenant_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "simbrief_dispatches" ADD CONSTRAINT "simbrief_dispatches_flight_snapshot_object_check" CHECK (jsonb_typeof("flight_snapshot") = 'object');--> statement-breakpoint
ALTER TABLE "simbrief_dispatches" ADD CONSTRAINT "simbrief_dispatches_positive_revision_check" CHECK ("revision" > 0);--> statement-breakpoint
ALTER TABLE "simbrief_dispatches" ADD CONSTRAINT "simbrief_dispatches_callback_lifecycle_check" CHECK ("callback_token_mac" IS NULL OR ("status" = 'pending' AND "callback_expires_at" IS NOT NULL));
