CREATE TYPE "brand_presence" AS ENUM('restrained', 'balanced', 'high');--> statement-breakpoint
CREATE TYPE "dispatch_unit" AS ENUM('kg', 'lb');--> statement-breakpoint
CREATE TYPE "flight_event_kind" AS ENUM('flt_init', 'out', 'off', 'on', 'in', 'manual_start', 'manual_finish', 'assignment_confirmed');--> statement-breakpoint
CREATE TYPE "flight_event_source" AS ENUM('hoppie', 'pilot_web', 'dispatcher');--> statement-breakpoint
CREATE TABLE "dispatch_releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL,
	"flight_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"operational_route" text NOT NULL,
	"sid" text,
	"star" text,
	"cruise_level" integer NOT NULL,
	"alternate_icao" text NOT NULL,
	"fuel_unit" "dispatch_unit" NOT NULL,
	"payload_unit" "dispatch_unit" NOT NULL,
	"taxi_fuel" integer NOT NULL,
	"trip_fuel" integer NOT NULL,
	"contingency_fuel" integer NOT NULL,
	"alternate_fuel" integer NOT NULL,
	"final_reserve_fuel" integer NOT NULL,
	"additional_fuel" integer DEFAULT 0 NOT NULL,
	"block_fuel" integer NOT NULL,
	"planned_payload" integer NOT NULL,
	"weather_snapshot" jsonb DEFAULT '{}' NOT NULL,
	"release_notes" text,
	"dispatcher_remarks" text,
	"released_by_membership_id" uuid,
	"released_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dispatch_releases_revision_check" CHECK ("revision" > 0),
	CONSTRAINT "dispatch_releases_cruise_level_check" CHECK ("cruise_level" between 10 and 600),
	CONSTRAINT "dispatch_releases_nonnegative_amounts_check" CHECK ("taxi_fuel" >= 0 and "trip_fuel" >= 0 and "contingency_fuel" >= 0 and "alternate_fuel" >= 0 and "final_reserve_fuel" >= 0 and "additional_fuel" >= 0 and "block_fuel" >= 0 and "planned_payload" >= 0),
	CONSTRAINT "dispatch_releases_positive_trip_fuel_check" CHECK ("trip_fuel" > 0 and "block_fuel" > 0),
	CONSTRAINT "dispatch_releases_block_fuel_check" CHECK ("block_fuel" = "taxi_fuel" + "trip_fuel" + "contingency_fuel" + "alternate_fuel" + "final_reserve_fuel" + "additional_fuel")
);
--> statement-breakpoint
CREATE TABLE "flight_operational_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL,
	"flight_id" uuid NOT NULL,
	"kind" "flight_event_kind" NOT NULL,
	"source" "flight_event_source" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"actor_membership_id" uuid,
	"acars_message_id" uuid,
	"meta" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "flights" ADD COLUMN "assignment_revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "flights" ADD COLUMN "assignment_confirmed_revision" integer;--> statement-breakpoint
ALTER TABLE "flights" ADD COLUMN "assignment_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "brand_seed_color" text DEFAULT '#e64646' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "brand_presence" "brand_presence" DEFAULT 'balanced'::"brand_presence" NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "brand_logo_url" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "brand_logo_pathname" text;--> statement-breakpoint
CREATE UNIQUE INDEX "dispatch_releases_flight_revision_uidx" ON "dispatch_releases" ("tenant_id","flight_id","revision");--> statement-breakpoint
CREATE INDEX "dispatch_releases_tenant_flight_idx" ON "dispatch_releases" ("tenant_id","flight_id");--> statement-breakpoint
CREATE INDEX "flight_operational_events_tenant_flight_idx" ON "flight_operational_events" ("tenant_id","flight_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "flight_operational_events_acars_kind_uidx" ON "flight_operational_events" ("acars_message_id","kind");--> statement-breakpoint
ALTER TABLE "dispatch_releases" ADD CONSTRAINT "dispatch_releases_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "dispatch_releases" ADD CONSTRAINT "dispatch_releases_flight_id_flights_id_fkey" FOREIGN KEY ("flight_id") REFERENCES "flights"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "dispatch_releases" ADD CONSTRAINT "dispatch_releases_released_by_membership_id_memberships_id_fkey" FOREIGN KEY ("released_by_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "flight_operational_events" ADD CONSTRAINT "flight_operational_events_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "flight_operational_events" ADD CONSTRAINT "flight_operational_events_flight_id_flights_id_fkey" FOREIGN KEY ("flight_id") REFERENCES "flights"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "flight_operational_events" ADD CONSTRAINT "flight_operational_events_A2DjFwBCvuWe_fkey" FOREIGN KEY ("actor_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "flight_operational_events" ADD CONSTRAINT "flight_operational_events_2Fvgm6L137MW_fkey" FOREIGN KEY ("acars_message_id") REFERENCES "acars_messages"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "flights" ADD CONSTRAINT "flights_time_window_check" CHECK ("eta" > "etd");--> statement-breakpoint
ALTER TABLE "flights" ADD CONSTRAINT "flights_assignment_revision_check" CHECK ("assignment_revision" > 0);--> statement-breakpoint
ALTER TABLE "flights" ADD CONSTRAINT "flights_assignment_confirmation_check" CHECK ("assignment_confirmed_revision" is null or ("assignment_confirmed_revision" > 0 and "assignment_confirmed_revision" <= "assignment_revision"));--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_brand_seed_color_check" CHECK ("brand_seed_color" ~ '^#[0-9a-f]{6}$');