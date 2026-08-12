CREATE TYPE "acars_direction" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TYPE "acars_msg_type" AS ENUM('telex', 'progress', 'cpdlc', 'position', 'other');--> statement-breakpoint
CREATE TYPE "acars_provider" AS ENUM('mock', 'hoppie');--> statement-breakpoint
CREATE TYPE "flight_status" AS ENUM('draft', 'offered', 'accepted', 'declined', 'briefed', 'active', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "member_role" AS ENUM('pilot', 'dispatcher', 'admin');--> statement-breakpoint
CREATE TYPE "member_status" AS ENUM('active', 'invited', 'disabled');--> statement-breakpoint
CREATE TYPE "schedule_request_status" AS ENUM('pending', 'in_review', 'fulfilled', 'partially_fulfilled', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "simbrief_dispatch_status" AS ENUM('pending', 'ready');--> statement-breakpoint
CREATE TABLE "acars_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL,
	"direction" "acars_direction" NOT NULL,
	"msg_type" "acars_msg_type" DEFAULT 'telex'::"acars_msg_type" NOT NULL,
	"from_station" text NOT NULL,
	"to_station" text NOT NULL,
	"body" text NOT NULL,
	"hoppie_raw" jsonb,
	"provider" "acars_provider" DEFAULT 'mock'::"acars_provider" NOT NULL,
	"provider_message_id" text,
	"flight_id" uuid,
	"created_by_membership_id" uuid,
	"received_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL,
	"actor_membership_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"meta" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL,
	"schedule_request_id" uuid,
	"pilot_membership_id" uuid,
	"flight_number" text NOT NULL,
	"dep_icao" text NOT NULL,
	"arr_icao" text NOT NULL,
	"etd" timestamp with time zone NOT NULL,
	"eta" timestamp with time zone NOT NULL,
	"aircraft_type" text,
	"status" "flight_status" DEFAULT 'draft'::"flight_status" NOT NULL,
	"cancel_reason" text,
	"declined_reason" text,
	"dispatcher_notes" text,
	"out_at" timestamp with time zone,
	"off_at" timestamp with time zone,
	"on_at" timestamp with time zone,
	"in_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL,
	"clerk_user_id" text NOT NULL,
	"role" "member_role" DEFAULT 'pilot'::"member_role" NOT NULL,
	"display_name" text,
	"pilot_callsign" text,
	"simbrief_user_id" text,
	"simbrief_verified_at" timestamp with time zone,
	"navigraph_subject" text,
	"navigraph_username" text,
	"navigraph_connected_at" timestamp with time zone,
	"status" "member_status" DEFAULT 'active'::"member_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mock_acars_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL,
	"to_station" text NOT NULL,
	"from_station" text NOT NULL,
	"msg_type" "acars_msg_type" DEFAULT 'telex'::"acars_msg_type" NOT NULL,
	"body" text NOT NULL,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "navigraph_oauth_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"state_id" text NOT NULL,
	"code_verifier_enc" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL,
	"pilot_membership_id" uuid NOT NULL,
	"title" text,
	"notes" text,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"desired_flight_count" integer NOT NULL,
	"preferences" jsonb DEFAULT '{}' NOT NULL,
	"status" "schedule_request_status" DEFAULT 'pending'::"schedule_request_status" NOT NULL,
	"reject_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "simbrief_dispatches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL,
	"flight_id" uuid NOT NULL,
	"created_by_membership_id" uuid,
	"simbrief_user_id" text NOT NULL,
	"static_id" text NOT NULL,
	"callback_token_mac" text,
	"status" "simbrief_dispatch_status" DEFAULT 'pending'::"simbrief_dispatch_status" NOT NULL,
	"request" jsonb DEFAULT '{}' NOT NULL,
	"ofp" jsonb,
	"simbrief_request_id" text,
	"generated_at" timestamp with time zone,
	"synced_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"clerk_org_id" text NOT NULL,
	"hoppie_station" text,
	"hoppie_logon_enc" text,
	"settings" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "acars_messages_tenant_created_idx" ON "acars_messages" ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "acars_messages_tenant_flight_idx" ON "acars_messages" ("tenant_id","flight_id");--> statement-breakpoint
CREATE UNIQUE INDEX "acars_messages_provider_dedupe_uidx" ON "acars_messages" ("tenant_id","provider","provider_message_id");--> statement-breakpoint
CREATE INDEX "audit_events_tenant_created_idx" ON "audit_events" ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_events_entity_idx" ON "audit_events" ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "flights_tenant_status_idx" ON "flights" ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "flights_tenant_etd_idx" ON "flights" ("tenant_id","etd");--> statement-breakpoint
CREATE INDEX "flights_tenant_pilot_idx" ON "flights" ("tenant_id","pilot_membership_id");--> statement-breakpoint
CREATE INDEX "flights_schedule_request_idx" ON "flights" ("schedule_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_tenant_user_uidx" ON "memberships" ("tenant_id","clerk_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_tenant_callsign_uidx" ON "memberships" ("tenant_id","pilot_callsign");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_tenant_simbrief_user_uidx" ON "memberships" ("tenant_id","simbrief_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_tenant_navigraph_subject_uidx" ON "memberships" ("tenant_id","navigraph_subject");--> statement-breakpoint
CREATE INDEX "memberships_tenant_idx" ON "memberships" ("tenant_id");--> statement-breakpoint
CREATE INDEX "mock_acars_queue_pending_idx" ON "mock_acars_queue" ("tenant_id","to_station","delivered_at");--> statement-breakpoint
CREATE UNIQUE INDEX "navigraph_oauth_transactions_state_uidx" ON "navigraph_oauth_transactions" ("state_id");--> statement-breakpoint
CREATE INDEX "navigraph_oauth_transactions_expiry_idx" ON "navigraph_oauth_transactions" ("expires_at");--> statement-breakpoint
CREATE INDEX "navigraph_oauth_transactions_member_idx" ON "navigraph_oauth_transactions" ("tenant_id","membership_id");--> statement-breakpoint
CREATE INDEX "schedule_requests_tenant_status_idx" ON "schedule_requests" ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "schedule_requests_tenant_pilot_idx" ON "schedule_requests" ("tenant_id","pilot_membership_id");--> statement-breakpoint
CREATE UNIQUE INDEX "simbrief_dispatches_static_id_uidx" ON "simbrief_dispatches" ("static_id");--> statement-breakpoint
CREATE INDEX "simbrief_dispatches_tenant_flight_created_idx" ON "simbrief_dispatches" ("tenant_id","flight_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_slug_uidx" ON "tenants" ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_clerk_org_uidx" ON "tenants" ("clerk_org_id");--> statement-breakpoint
ALTER TABLE "acars_messages" ADD CONSTRAINT "acars_messages_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "acars_messages" ADD CONSTRAINT "acars_messages_flight_id_flights_id_fkey" FOREIGN KEY ("flight_id") REFERENCES "flights"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "acars_messages" ADD CONSTRAINT "acars_messages_created_by_membership_id_memberships_id_fkey" FOREIGN KEY ("created_by_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_membership_id_memberships_id_fkey" FOREIGN KEY ("actor_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "flights" ADD CONSTRAINT "flights_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "flights" ADD CONSTRAINT "flights_schedule_request_id_schedule_requests_id_fkey" FOREIGN KEY ("schedule_request_id") REFERENCES "schedule_requests"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "flights" ADD CONSTRAINT "flights_pilot_membership_id_memberships_id_fkey" FOREIGN KEY ("pilot_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mock_acars_queue" ADD CONSTRAINT "mock_acars_queue_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "navigraph_oauth_transactions" ADD CONSTRAINT "navigraph_oauth_transactions_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "navigraph_oauth_transactions" ADD CONSTRAINT "navigraph_oauth_transactions_membership_id_memberships_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "schedule_requests" ADD CONSTRAINT "schedule_requests_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "schedule_requests" ADD CONSTRAINT "schedule_requests_pilot_membership_id_memberships_id_fkey" FOREIGN KEY ("pilot_membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "simbrief_dispatches" ADD CONSTRAINT "simbrief_dispatches_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "simbrief_dispatches" ADD CONSTRAINT "simbrief_dispatches_flight_id_flights_id_fkey" FOREIGN KEY ("flight_id") REFERENCES "flights"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "simbrief_dispatches" ADD CONSTRAINT "simbrief_dispatches_nXjb1iqZ7Tas_fkey" FOREIGN KEY ("created_by_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL;