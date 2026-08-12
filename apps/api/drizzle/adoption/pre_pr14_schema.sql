CREATE TYPE "acars_direction" AS ENUM('inbound', 'outbound');
CREATE TYPE "acars_msg_type" AS ENUM('telex', 'progress', 'cpdlc', 'position', 'other');
CREATE TYPE "acars_provider" AS ENUM('mock', 'hoppie');
CREATE TYPE "flight_status" AS ENUM('draft', 'offered', 'accepted', 'declined', 'briefed', 'active', 'completed', 'cancelled');
CREATE TYPE "member_role" AS ENUM('pilot', 'dispatcher', 'admin');
CREATE TYPE "member_status" AS ENUM('active', 'invited', 'disabled');
CREATE TYPE "schedule_request_status" AS ENUM('pending', 'in_review', 'fulfilled', 'partially_fulfilled', 'rejected', 'cancelled');

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

CREATE TABLE "memberships" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "clerk_user_id" text NOT NULL,
  "role" "member_role" DEFAULT 'pilot'::"member_role" NOT NULL,
  "display_name" text,
  "pilot_callsign" text,
  "status" "member_status" DEFAULT 'active'::"member_status" NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

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

CREATE UNIQUE INDEX "tenants_slug_uidx" ON "tenants" ("slug");
CREATE UNIQUE INDEX "tenants_clerk_org_uidx" ON "tenants" ("clerk_org_id");
CREATE UNIQUE INDEX "memberships_tenant_user_uidx" ON "memberships" ("tenant_id", "clerk_user_id");
CREATE UNIQUE INDEX "memberships_tenant_callsign_uidx" ON "memberships" ("tenant_id", "pilot_callsign");
CREATE INDEX "memberships_tenant_idx" ON "memberships" ("tenant_id");
CREATE INDEX "schedule_requests_tenant_status_idx" ON "schedule_requests" ("tenant_id", "status");
CREATE INDEX "schedule_requests_tenant_pilot_idx" ON "schedule_requests" ("tenant_id", "pilot_membership_id");
CREATE INDEX "flights_tenant_status_idx" ON "flights" ("tenant_id", "status");
CREATE INDEX "flights_tenant_etd_idx" ON "flights" ("tenant_id", "etd");
CREATE INDEX "flights_tenant_pilot_idx" ON "flights" ("tenant_id", "pilot_membership_id");
CREATE INDEX "flights_schedule_request_idx" ON "flights" ("schedule_request_id");
CREATE INDEX "acars_messages_tenant_created_idx" ON "acars_messages" ("tenant_id", "created_at");
CREATE INDEX "acars_messages_tenant_flight_idx" ON "acars_messages" ("tenant_id", "flight_id");
CREATE UNIQUE INDEX "acars_messages_provider_dedupe_uidx" ON "acars_messages" ("tenant_id", "provider", "provider_message_id");
CREATE INDEX "audit_events_tenant_created_idx" ON "audit_events" ("tenant_id", "created_at");
CREATE INDEX "audit_events_entity_idx" ON "audit_events" ("entity_type", "entity_id");
CREATE INDEX "mock_acars_queue_pending_idx" ON "mock_acars_queue" ("tenant_id", "to_station", "delivered_at");

ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;
ALTER TABLE "schedule_requests" ADD CONSTRAINT "schedule_requests_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;
ALTER TABLE "schedule_requests" ADD CONSTRAINT "schedule_requests_pilot_membership_id_memberships_id_fkey" FOREIGN KEY ("pilot_membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT;
ALTER TABLE "flights" ADD CONSTRAINT "flights_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;
ALTER TABLE "flights" ADD CONSTRAINT "flights_schedule_request_id_schedule_requests_id_fkey" FOREIGN KEY ("schedule_request_id") REFERENCES "schedule_requests"("id") ON DELETE SET NULL;
ALTER TABLE "flights" ADD CONSTRAINT "flights_pilot_membership_id_memberships_id_fkey" FOREIGN KEY ("pilot_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL;
ALTER TABLE "acars_messages" ADD CONSTRAINT "acars_messages_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;
ALTER TABLE "acars_messages" ADD CONSTRAINT "acars_messages_flight_id_flights_id_fkey" FOREIGN KEY ("flight_id") REFERENCES "flights"("id") ON DELETE SET NULL;
ALTER TABLE "acars_messages" ADD CONSTRAINT "acars_messages_created_by_membership_id_memberships_id_fkey" FOREIGN KEY ("created_by_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL;
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_membership_id_memberships_id_fkey" FOREIGN KEY ("actor_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL;
ALTER TABLE "mock_acars_queue" ADD CONSTRAINT "mock_acars_queue_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;
