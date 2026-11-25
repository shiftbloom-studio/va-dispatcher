CREATE TABLE `acars_messages` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
	`tenant_id` text NOT NULL,
	`direction` text NOT NULL,
	`msg_type` text DEFAULT 'telex' NOT NULL,
	`from_station` text NOT NULL,
	`to_station` text NOT NULL,
	`body` text NOT NULL,
	`hoppie_raw` text,
	`provider` text DEFAULT 'mock' NOT NULL,
	`provider_message_id` text,
	`delivery_status` text,
	`flight_id` text,
	`created_by_membership_id` text,
	`received_at` integer,
	`sent_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_acars_messages_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_acars_messages_flight_id_flights_id_fk` FOREIGN KEY (`flight_id`) REFERENCES `flights`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_acars_messages_created_by_membership_id_memberships_id_fk` FOREIGN KEY (`created_by_membership_id`) REFERENCES `memberships`(`id`) ON DELETE SET NULL,
	CONSTRAINT "acars_messages_direction_enum_check" CHECK("direction" in ('inbound', 'outbound')),
	CONSTRAINT "acars_messages_msg_type_enum_check" CHECK("msg_type" in ('telex', 'progress', 'cpdlc', 'position', 'other')),
	CONSTRAINT "acars_messages_provider_enum_check" CHECK("provider" in ('mock', 'hoppie')),
	CONSTRAINT "acars_messages_delivery_status_enum_check" CHECK("delivery_status" in ('pending', 'accepted', 'rejected', 'ambiguous'))
);
--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
	`tenant_id` text NOT NULL,
	`actor_membership_id` text,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`meta` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_audit_events_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_audit_events_actor_membership_id_memberships_id_fk` FOREIGN KEY (`actor_membership_id`) REFERENCES `memberships`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `batch_guards` (
	`reason` text NOT NULL,
	CONSTRAINT "batch_guard_rejected" CHECK(0)
);
--> statement-breakpoint
CREATE TABLE `dispatch_releases` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
	`tenant_id` text NOT NULL,
	`flight_id` text NOT NULL,
	`revision` integer NOT NULL,
	`operational_route` text NOT NULL,
	`sid` text,
	`star` text,
	`cruise_level` integer NOT NULL,
	`alternate_icao` text NOT NULL,
	`fuel_unit` text NOT NULL,
	`payload_unit` text NOT NULL,
	`taxi_fuel` integer NOT NULL,
	`trip_fuel` integer NOT NULL,
	`contingency_fuel` integer NOT NULL,
	`alternate_fuel` integer NOT NULL,
	`final_reserve_fuel` integer NOT NULL,
	`additional_fuel` integer DEFAULT 0 NOT NULL,
	`block_fuel` integer NOT NULL,
	`planned_payload` integer NOT NULL,
	`weather_snapshot` text DEFAULT '{}' NOT NULL,
	`release_notes` text,
	`dispatcher_remarks` text,
	`released_by_membership_id` text,
	`released_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_dispatch_releases_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_dispatch_releases_released_by_membership_id_memberships_id_fk` FOREIGN KEY (`released_by_membership_id`) REFERENCES `memberships`(`id`) ON DELETE SET NULL,
	CONSTRAINT `dispatch_releases_tenant_flight_fk` FOREIGN KEY (`tenant_id`,`flight_id`) REFERENCES `flights`(`tenant_id`,`id`) ON DELETE CASCADE,
	CONSTRAINT "dispatch_releases_fuel_unit_enum_check" CHECK("fuel_unit" in ('kg', 'lb')),
	CONSTRAINT "dispatch_releases_payload_unit_enum_check" CHECK("payload_unit" in ('kg', 'lb')),
	CONSTRAINT "dispatch_releases_revision_check" CHECK("revision" > 0),
	CONSTRAINT "dispatch_releases_cruise_level_check" CHECK("cruise_level" between 10 and 600),
	CONSTRAINT "dispatch_releases_nonnegative_amounts_check" CHECK("taxi_fuel" >= 0 and "trip_fuel" >= 0 and "contingency_fuel" >= 0 and "alternate_fuel" >= 0 and "final_reserve_fuel" >= 0 and "additional_fuel" >= 0 and "block_fuel" >= 0 and "planned_payload" >= 0),
	CONSTRAINT "dispatch_releases_positive_trip_fuel_check" CHECK("trip_fuel" > 0 and "block_fuel" > 0),
	CONSTRAINT "dispatch_releases_block_fuel_check" CHECK("block_fuel" = "taxi_fuel" + "trip_fuel" + "contingency_fuel" + "alternate_fuel" + "final_reserve_fuel" + "additional_fuel")
);
--> statement-breakpoint
CREATE TABLE `flight_oooi_events` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
	`tenant_id` text NOT NULL,
	`flight_id` text NOT NULL,
	`event_type` text NOT NULL,
	`occurred_at` integer,
	`source` text NOT NULL,
	`actor_membership_id` text,
	`device_id` text,
	`reason` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_flight_oooi_events_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_flight_oooi_events_flight_id_flights_id_fk` FOREIGN KEY (`flight_id`) REFERENCES `flights`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_flight_oooi_events_actor_membership_id_memberships_id_fk` FOREIGN KEY (`actor_membership_id`) REFERENCES `memberships`(`id`) ON DELETE RESTRICT,
	CONSTRAINT `fk_flight_oooi_events_device_id_simulator_devices_id_fk` FOREIGN KEY (`device_id`) REFERENCES `simulator_devices`(`id`) ON DELETE RESTRICT,
	CONSTRAINT `flight_oooi_events_tenant_flight_fk` FOREIGN KEY (`tenant_id`,`flight_id`) REFERENCES `flights`(`tenant_id`,`id`) ON DELETE CASCADE,
	CONSTRAINT `flight_oooi_events_tenant_actor_fk` FOREIGN KEY (`tenant_id`,`actor_membership_id`) REFERENCES `memberships`(`tenant_id`,`id`) ON DELETE RESTRICT,
	CONSTRAINT `flight_oooi_events_tenant_device_fk` FOREIGN KEY (`tenant_id`,`device_id`) REFERENCES `simulator_devices`(`tenant_id`,`id`) ON DELETE RESTRICT,
	CONSTRAINT "flight_oooi_events_event_type_enum_check" CHECK("event_type" in ('out', 'off', 'on', 'in')),
	CONSTRAINT "flight_oooi_events_source_enum_check" CHECK("source" in ('telemetry', 'manual'))
);
--> statement-breakpoint
CREATE TABLE `flight_operational_events` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
	`tenant_id` text NOT NULL,
	`flight_id` text NOT NULL,
	`kind` text NOT NULL,
	`source` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`actor_membership_id` text,
	`acars_message_id` text,
	`meta` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_flight_operational_events_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_flight_operational_events_flight_id_flights_id_fk` FOREIGN KEY (`flight_id`) REFERENCES `flights`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_flight_operational_events_actor_membership_id_memberships_id_fk` FOREIGN KEY (`actor_membership_id`) REFERENCES `memberships`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_flight_operational_events_acars_message_id_acars_messages_id_fk` FOREIGN KEY (`acars_message_id`) REFERENCES `acars_messages`(`id`) ON DELETE SET NULL,
	CONSTRAINT "flight_operational_events_kind_enum_check" CHECK("kind" in ('flt_init', 'out', 'off', 'on', 'in', 'manual_start', 'manual_finish', 'assignment_confirmed')),
	CONSTRAINT "flight_operational_events_source_enum_check" CHECK("source" in ('hoppie', 'pilot_web', 'dispatcher'))
);
--> statement-breakpoint
CREATE TABLE `flight_telemetry_current` (
	`flight_id` text PRIMARY KEY,
	`tenant_id` text NOT NULL,
	`membership_id` text NOT NULL,
	`device_id` text NOT NULL,
	`phase` text NOT NULL,
	`latitude` real NOT NULL,
	`longitude` real NOT NULL,
	`altitude_feet` integer NOT NULL,
	`ground_speed_knots` integer NOT NULL,
	`heading_degrees` real NOT NULL,
	`simulator_time` integer NOT NULL,
	`sample_at` integer NOT NULL,
	`sequence` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_flight_telemetry_current_flight_id_flights_id_fk` FOREIGN KEY (`flight_id`) REFERENCES `flights`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_flight_telemetry_current_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_flight_telemetry_current_membership_id_memberships_id_fk` FOREIGN KEY (`membership_id`) REFERENCES `memberships`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_flight_telemetry_current_device_id_simulator_devices_id_fk` FOREIGN KEY (`device_id`) REFERENCES `simulator_devices`(`id`) ON DELETE CASCADE,
	CONSTRAINT `flight_telemetry_current_tenant_flight_fk` FOREIGN KEY (`tenant_id`,`flight_id`) REFERENCES `flights`(`tenant_id`,`id`) ON DELETE CASCADE,
	CONSTRAINT `flight_telemetry_current_tenant_member_fk` FOREIGN KEY (`tenant_id`,`membership_id`) REFERENCES `memberships`(`tenant_id`,`id`) ON DELETE CASCADE,
	CONSTRAINT `flight_telemetry_current_tenant_member_device_fk` FOREIGN KEY (`tenant_id`,`membership_id`,`device_id`) REFERENCES `simulator_devices`(`tenant_id`,`membership_id`,`id`) ON DELETE CASCADE,
	CONSTRAINT "flight_telemetry_current_phase_enum_check" CHECK("phase" in ('preflight', 'taxi_out', 'airborne', 'taxi_in', 'parked'))
);
--> statement-breakpoint
CREATE TABLE `flight_telemetry_leases` (
	`flight_id` text PRIMARY KEY,
	`tenant_id` text NOT NULL,
	`membership_id` text NOT NULL,
	`device_id` text NOT NULL,
	`lease_expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_flight_telemetry_leases_flight_id_flights_id_fk` FOREIGN KEY (`flight_id`) REFERENCES `flights`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_flight_telemetry_leases_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_flight_telemetry_leases_membership_id_memberships_id_fk` FOREIGN KEY (`membership_id`) REFERENCES `memberships`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_flight_telemetry_leases_device_id_simulator_devices_id_fk` FOREIGN KEY (`device_id`) REFERENCES `simulator_devices`(`id`) ON DELETE CASCADE,
	CONSTRAINT `flight_telemetry_leases_tenant_flight_fk` FOREIGN KEY (`tenant_id`,`flight_id`) REFERENCES `flights`(`tenant_id`,`id`) ON DELETE CASCADE,
	CONSTRAINT `flight_telemetry_leases_tenant_member_fk` FOREIGN KEY (`tenant_id`,`membership_id`) REFERENCES `memberships`(`tenant_id`,`id`) ON DELETE CASCADE,
	CONSTRAINT `flight_telemetry_leases_tenant_member_device_fk` FOREIGN KEY (`tenant_id`,`membership_id`,`device_id`) REFERENCES `simulator_devices`(`tenant_id`,`membership_id`,`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `flight_telemetry_track` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
	`tenant_id` text NOT NULL,
	`flight_id` text NOT NULL,
	`membership_id` text NOT NULL,
	`device_id` text NOT NULL,
	`phase` text NOT NULL,
	`latitude` real NOT NULL,
	`longitude` real NOT NULL,
	`altitude_feet` integer NOT NULL,
	`ground_speed_knots` integer NOT NULL,
	`heading_degrees` real NOT NULL,
	`simulator_time` integer NOT NULL,
	`sample_at` integer NOT NULL,
	`sequence` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_flight_telemetry_track_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_flight_telemetry_track_flight_id_flights_id_fk` FOREIGN KEY (`flight_id`) REFERENCES `flights`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_flight_telemetry_track_membership_id_memberships_id_fk` FOREIGN KEY (`membership_id`) REFERENCES `memberships`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_flight_telemetry_track_device_id_simulator_devices_id_fk` FOREIGN KEY (`device_id`) REFERENCES `simulator_devices`(`id`) ON DELETE CASCADE,
	CONSTRAINT `flight_telemetry_track_tenant_flight_fk` FOREIGN KEY (`tenant_id`,`flight_id`) REFERENCES `flights`(`tenant_id`,`id`) ON DELETE CASCADE,
	CONSTRAINT `flight_telemetry_track_tenant_member_fk` FOREIGN KEY (`tenant_id`,`membership_id`) REFERENCES `memberships`(`tenant_id`,`id`) ON DELETE CASCADE,
	CONSTRAINT `flight_telemetry_track_tenant_member_device_fk` FOREIGN KEY (`tenant_id`,`membership_id`,`device_id`) REFERENCES `simulator_devices`(`tenant_id`,`membership_id`,`id`) ON DELETE CASCADE,
	CONSTRAINT "flight_telemetry_track_phase_enum_check" CHECK("phase" in ('preflight', 'taxi_out', 'airborne', 'taxi_in', 'parked'))
);
--> statement-breakpoint
CREATE TABLE `flights` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
	`tenant_id` text NOT NULL,
	`schedule_request_id` text,
	`replaces_flight_id` text,
	`pilot_membership_id` text,
	`flight_number` text NOT NULL,
	`dep_icao` text NOT NULL,
	`arr_icao` text NOT NULL,
	`etd` integer NOT NULL,
	`eta` integer NOT NULL,
	`aircraft_type` text,
	`version` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`cancel_reason` text,
	`declined_reason` text,
	`dispatcher_notes` text,
	`assignment_revision` integer DEFAULT 1 NOT NULL,
	`assignment_confirmed_revision` integer,
	`assignment_confirmed_at` integer,
	`out_at` integer,
	`off_at` integer,
	`on_at` integer,
	`in_at` integer,
	`out_manual_override` integer DEFAULT false NOT NULL,
	`off_manual_override` integer DEFAULT false NOT NULL,
	`on_manual_override` integer DEFAULT false NOT NULL,
	`in_manual_override` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_flights_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_flights_schedule_request_id_schedule_requests_id_fk` FOREIGN KEY (`schedule_request_id`) REFERENCES `schedule_requests`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_flights_pilot_membership_id_memberships_id_fk` FOREIGN KEY (`pilot_membership_id`) REFERENCES `memberships`(`id`) ON DELETE SET NULL,
	CONSTRAINT `flights_tenant_replaces_fkey` FOREIGN KEY (`tenant_id`,`replaces_flight_id`) REFERENCES `flights`(`tenant_id`,`id`),
	CONSTRAINT `flights_tenant_pilot_fkey` FOREIGN KEY (`tenant_id`,`pilot_membership_id`) REFERENCES `memberships`(`tenant_id`,`id`),
	CONSTRAINT `flights_tenant_schedule_request_fkey` FOREIGN KEY (`tenant_id`,`schedule_request_id`) REFERENCES `schedule_requests`(`tenant_id`,`id`),
	CONSTRAINT "flights_status_enum_check" CHECK("status" in ('draft', 'offered', 'accepted', 'declined', 'briefed', 'active', 'completed', 'cancelled')),
	CONSTRAINT "flights_time_window_check" CHECK("eta" > "etd"),
	CONSTRAINT "flights_assignment_revision_check" CHECK("assignment_revision" > 0),
	CONSTRAINT "flights_assignment_confirmation_check" CHECK("assignment_confirmed_revision" is null or ("assignment_confirmed_revision" > 0 and "assignment_confirmed_revision" <= "assignment_revision"))
);
--> statement-breakpoint
CREATE TABLE `memberships` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
	`tenant_id` text NOT NULL,
	`clerk_user_id` text NOT NULL,
	`role` text DEFAULT 'pilot' NOT NULL,
	`display_name` text,
	`pilot_callsign` text,
	`simbrief_user_id` text,
	`simbrief_verified_at` integer,
	`navigraph_subject` text,
	`navigraph_username` text,
	`navigraph_connected_at` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_memberships_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE,
	CONSTRAINT "memberships_role_enum_check" CHECK("role" in ('pilot', 'dispatcher', 'admin')),
	CONSTRAINT "memberships_status_enum_check" CHECK("status" in ('active', 'invited', 'disabled'))
);
--> statement-breakpoint
CREATE TABLE `mock_acars_queue` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
	`tenant_id` text NOT NULL,
	`to_station` text NOT NULL,
	`from_station` text NOT NULL,
	`msg_type` text DEFAULT 'telex' NOT NULL,
	`body` text NOT NULL,
	`delivered_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_mock_acars_queue_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE,
	CONSTRAINT "mock_acars_queue_msg_type_enum_check" CHECK("msg_type" in ('telex', 'progress', 'cpdlc', 'position', 'other'))
);
--> statement-breakpoint
CREATE TABLE `navigraph_oauth_transactions` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
	`tenant_id` text NOT NULL,
	`membership_id` text NOT NULL,
	`state_id` text NOT NULL,
	`code_verifier_enc` text NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_navigraph_oauth_transactions_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_navigraph_oauth_transactions_membership_id_memberships_id_fk` FOREIGN KEY (`membership_id`) REFERENCES `memberships`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `privacy_external_tasks` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
	`tenant_id` text NOT NULL,
	`request_id` text,
	`run_id` text,
	`provider` text NOT NULL,
	`action` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`operator_note` text,
	`completed_by_membership_id` text,
	`completed_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_privacy_external_tasks_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_privacy_external_tasks_request_id_privacy_subject_requests_id_fk` FOREIGN KEY (`request_id`) REFERENCES `privacy_subject_requests`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_privacy_external_tasks_run_id_privacy_retention_runs_id_fk` FOREIGN KEY (`run_id`) REFERENCES `privacy_retention_runs`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_privacy_external_tasks_completed_by_membership_id_memberships_id_fk` FOREIGN KEY (`completed_by_membership_id`) REFERENCES `memberships`(`id`) ON DELETE SET NULL,
	CONSTRAINT "privacy_external_tasks_provider_enum_check" CHECK("provider" in ('clerk', 'vercel', 'neon', 'hoppie', 'backup', 'navigraph')),
	CONSTRAINT "privacy_external_tasks_status_enum_check" CHECK("status" in ('pending', 'completed', 'not_applicable', 'failed')),
	CONSTRAINT "privacy_external_tasks_parent_check" CHECK(("request_id" is not null) + ("run_id" is not null) = 1)
);
--> statement-breakpoint
CREATE TABLE `privacy_legal_holds` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
	`tenant_id` text NOT NULL,
	`subject_membership_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`scope` text NOT NULL,
	`reason` text NOT NULL,
	`expires_at` integer,
	`created_by_membership_id` text,
	`approved_by_membership_id` text,
	`approved_at` integer,
	`released_by_membership_id` text,
	`released_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_privacy_legal_holds_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_privacy_legal_holds_subject_membership_id_memberships_id_fk` FOREIGN KEY (`subject_membership_id`) REFERENCES `memberships`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_privacy_legal_holds_created_by_membership_id_memberships_id_fk` FOREIGN KEY (`created_by_membership_id`) REFERENCES `memberships`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_privacy_legal_holds_approved_by_membership_id_memberships_id_fk` FOREIGN KEY (`approved_by_membership_id`) REFERENCES `memberships`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_privacy_legal_holds_released_by_membership_id_memberships_id_fk` FOREIGN KEY (`released_by_membership_id`) REFERENCES `memberships`(`id`) ON DELETE SET NULL,
	CONSTRAINT "privacy_legal_holds_status_enum_check" CHECK("status" in ('pending', 'active', 'released')),
	CONSTRAINT "privacy_legal_holds_distinct_approval_check" CHECK("approved_by_membership_id" is null or "created_by_membership_id" is null or "approved_by_membership_id" <> "created_by_membership_id")
);
--> statement-breakpoint
CREATE TABLE `privacy_policies` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
	`tenant_id` text NOT NULL,
	`version` integer NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`created_by_membership_id` text,
	`approved_by_membership_id` text,
	`approved_at` integer,
	`effective_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_privacy_policies_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_privacy_policies_created_by_membership_id_memberships_id_fk` FOREIGN KEY (`created_by_membership_id`) REFERENCES `memberships`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_privacy_policies_approved_by_membership_id_memberships_id_fk` FOREIGN KEY (`approved_by_membership_id`) REFERENCES `memberships`(`id`) ON DELETE SET NULL,
	CONSTRAINT "privacy_policies_status_enum_check" CHECK("status" in ('draft', 'active', 'retired')),
	CONSTRAINT "privacy_policies_version_check" CHECK("version" > 0),
	CONSTRAINT "privacy_policies_distinct_approval_check" CHECK("approved_by_membership_id" is null or "created_by_membership_id" is null or "approved_by_membership_id" <> "created_by_membership_id")
);
--> statement-breakpoint
CREATE TABLE `privacy_retention_runs` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
	`tenant_id` text NOT NULL,
	`policy_id` text NOT NULL,
	`mode` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`as_of` integer NOT NULL,
	`dry_run_id` text,
	`idempotency_key` text NOT NULL,
	`cursor` text DEFAULT '{}' NOT NULL,
	`report` text DEFAULT '{}' NOT NULL,
	`requested_by_membership_id` text,
	`started_at` integer,
	`completed_at` integer,
	`last_error` text,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_privacy_retention_runs_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_privacy_retention_runs_policy_id_privacy_policies_id_fk` FOREIGN KEY (`policy_id`) REFERENCES `privacy_policies`(`id`) ON DELETE RESTRICT,
	CONSTRAINT `fk_privacy_retention_runs_dry_run_id_privacy_retention_runs_id_fk` FOREIGN KEY (`dry_run_id`) REFERENCES `privacy_retention_runs`(`id`) ON DELETE RESTRICT,
	CONSTRAINT `fk_privacy_retention_runs_requested_by_membership_id_memberships_id_fk` FOREIGN KEY (`requested_by_membership_id`) REFERENCES `memberships`(`id`) ON DELETE SET NULL,
	CONSTRAINT "privacy_retention_runs_mode_enum_check" CHECK("mode" in ('dry_run', 'execute')),
	CONSTRAINT "privacy_retention_runs_status_enum_check" CHECK("status" in ('queued', 'running', 'completed', 'failed')),
	CONSTRAINT "privacy_retention_runs_attempt_count_check" CHECK("attempt_count" >= 0),
	CONSTRAINT "privacy_retention_runs_dry_run_check" CHECK(("mode" = 'dry_run' and "dry_run_id" is null) or ("mode" = 'execute' and "dry_run_id" is not null))
);
--> statement-breakpoint
CREATE TABLE `privacy_subject_controls` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
	`tenant_id` text NOT NULL,
	`membership_id` text NOT NULL,
	`restricted_at` integer,
	`restriction_reason` text,
	`objected_at` integer,
	`objection_scopes` text DEFAULT '[]' NOT NULL,
	`updated_by_membership_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_privacy_subject_controls_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_privacy_subject_controls_membership_id_memberships_id_fk` FOREIGN KEY (`membership_id`) REFERENCES `memberships`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_privacy_subject_controls_updated_by_membership_id_memberships_id_fk` FOREIGN KEY (`updated_by_membership_id`) REFERENCES `memberships`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `privacy_subject_requests` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
	`tenant_id` text NOT NULL,
	`scope` text NOT NULL,
	`subject_membership_id` text,
	`subject_reference` text NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'pending_verification' NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`result` text DEFAULT '{}' NOT NULL,
	`created_by_membership_id` text,
	`verified_by_membership_id` text,
	`verified_at` integer,
	`approved_by_membership_id` text,
	`approved_at` integer,
	`processed_at` integer,
	`last_error` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_privacy_subject_requests_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_privacy_subject_requests_subject_membership_id_memberships_id_fk` FOREIGN KEY (`subject_membership_id`) REFERENCES `memberships`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_privacy_subject_requests_created_by_membership_id_memberships_id_fk` FOREIGN KEY (`created_by_membership_id`) REFERENCES `memberships`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_privacy_subject_requests_verified_by_membership_id_memberships_id_fk` FOREIGN KEY (`verified_by_membership_id`) REFERENCES `memberships`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_privacy_subject_requests_approved_by_membership_id_memberships_id_fk` FOREIGN KEY (`approved_by_membership_id`) REFERENCES `memberships`(`id`) ON DELETE SET NULL,
	CONSTRAINT "privacy_subject_requests_scope_enum_check" CHECK("scope" in ('member', 'tenant')),
	CONSTRAINT "privacy_subject_requests_kind_enum_check" CHECK("kind" in ('export', 'correction', 'restriction', 'objection', 'anonymization', 'erasure')),
	CONSTRAINT "privacy_subject_requests_status_enum_check" CHECK("status" in ('pending_verification', 'pending_approval', 'approved', 'processing', 'awaiting_external', 'completed', 'blocked', 'failed', 'cancelled')),
	CONSTRAINT "privacy_subject_requests_scope_check" CHECK("scope" = 'tenant' or "subject_membership_id" is not null or "status" not in ('pending_verification', 'pending_approval')),
	CONSTRAINT "privacy_subject_requests_distinct_approval_check" CHECK("approved_by_membership_id" is null or "created_by_membership_id" is null or "approved_by_membership_id" <> "created_by_membership_id")
);
--> statement-breakpoint
CREATE TABLE `schedule_fulfillment_attempts` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
	`tenant_id` text NOT NULL,
	`schedule_request_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`payload_hash` text NOT NULL,
	`flight_ids` text NOT NULL,
	`request_status` text NOT NULL,
	`request_version` integer NOT NULL,
	`linked_flight_count` integer NOT NULL,
	`remaining_flight_count` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_schedule_fulfillment_attempts_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE,
	CONSTRAINT `schedule_fulfillment_attempts_tenant_request_fkey` FOREIGN KEY (`tenant_id`,`schedule_request_id`) REFERENCES `schedule_requests`(`tenant_id`,`id`) ON DELETE CASCADE,
	CONSTRAINT "schedule_fulfillment_attempts_request_status_enum_check" CHECK("request_status" in ('pending', 'in_review', 'fulfilled', 'partially_fulfilled', 'rejected', 'cancelled')),
	CONSTRAINT "schedule_fulfillment_attempts_key_check" CHECK(length("idempotency_key") between 1 and 200),
	CONSTRAINT "schedule_fulfillment_attempts_payload_hash_check" CHECK(length("payload_hash") = 64),
	CONSTRAINT "schedule_fulfillment_attempts_flights_check" CHECK(json_array_length("flight_ids") > 0),
	CONSTRAINT "schedule_fulfillment_attempts_status_check" CHECK("request_status" in ('partially_fulfilled', 'fulfilled')),
	CONSTRAINT "schedule_fulfillment_attempts_counts_check" CHECK("request_version" > 1 and "linked_flight_count" > 0 and "remaining_flight_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE `schedule_requests` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
	`tenant_id` text NOT NULL,
	`pilot_membership_id` text NOT NULL,
	`title` text,
	`notes` text,
	`window_start` integer NOT NULL,
	`window_end` integer NOT NULL,
	`desired_flight_count` integer NOT NULL,
	`preferences` text DEFAULT '{}' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`reject_reason` text,
	`cancel_reason` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_schedule_requests_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_schedule_requests_pilot_membership_id_memberships_id_fk` FOREIGN KEY (`pilot_membership_id`) REFERENCES `memberships`(`id`) ON DELETE RESTRICT,
	CONSTRAINT `schedule_requests_tenant_pilot_fkey` FOREIGN KEY (`tenant_id`,`pilot_membership_id`) REFERENCES `memberships`(`tenant_id`,`id`),
	CONSTRAINT "schedule_requests_status_enum_check" CHECK("status" in ('pending', 'in_review', 'fulfilled', 'partially_fulfilled', 'rejected', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE `simbrief_dispatches` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
	`tenant_id` text NOT NULL,
	`flight_id` text NOT NULL,
	`created_by_membership_id` text,
	`generated_by_membership_id` text,
	`simbrief_user_id` text,
	`static_id` text NOT NULL,
	`callback_token_mac` text,
	`callback_expires_at` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`revision` integer NOT NULL,
	`flight_snapshot` text NOT NULL,
	`request` text DEFAULT '{}' NOT NULL,
	`ofp` text,
	`simbrief_request_id` text,
	`generated_at` integer,
	`synced_at` integer,
	`last_error` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_simbrief_dispatches_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_simbrief_dispatches_flight_id_flights_id_fk` FOREIGN KEY (`flight_id`) REFERENCES `flights`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_simbrief_dispatches_created_by_membership_id_memberships_id_fk` FOREIGN KEY (`created_by_membership_id`) REFERENCES `memberships`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_simbrief_dispatches_generated_by_membership_id_memberships_id_fk` FOREIGN KEY (`generated_by_membership_id`) REFERENCES `memberships`(`id`) ON DELETE SET NULL,
	CONSTRAINT `simbrief_dispatches_tenant_flight_fk` FOREIGN KEY (`tenant_id`,`flight_id`) REFERENCES `flights`(`tenant_id`,`id`) ON DELETE CASCADE,
	CONSTRAINT "simbrief_dispatches_status_enum_check" CHECK("status" in ('prepared', 'pending', 'ready')),
	CONSTRAINT "simbrief_dispatches_flight_snapshot_object_check" CHECK(json_type("flight_snapshot") = 'object'),
	CONSTRAINT "simbrief_dispatches_positive_revision_check" CHECK("revision" > 0),
	CONSTRAINT "simbrief_dispatches_callback_lifecycle_check" CHECK("callback_token_mac" IS NULL OR ("status" = 'pending' AND "callback_expires_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE `simbrief_flight_heads` (
	`flight_id` text PRIMARY KEY,
	`tenant_id` text NOT NULL,
	`revision` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_simbrief_flight_heads_flight_id_flights_id_fk` FOREIGN KEY (`flight_id`) REFERENCES `flights`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_simbrief_flight_heads_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE,
	CONSTRAINT `simbrief_flight_heads_tenant_flight_fk` FOREIGN KEY (`tenant_id`,`flight_id`) REFERENCES `flights`(`tenant_id`,`id`) ON DELETE CASCADE,
	CONSTRAINT "simbrief_flight_heads_positive_revision_check" CHECK("revision" > 0)
);
--> statement-breakpoint
CREATE TABLE `simulator_devices` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
	`tenant_id` text NOT NULL,
	`membership_id` text NOT NULL,
	`name` text NOT NULL,
	`token_mac` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`last_sequence` integer,
	`last_ingest_at` integer,
	`last_seen_at` integer,
	`revoked_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_simulator_devices_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_simulator_devices_membership_id_memberships_id_fk` FOREIGN KEY (`membership_id`) REFERENCES `memberships`(`id`) ON DELETE CASCADE,
	CONSTRAINT `simulator_devices_tenant_member_fk` FOREIGN KEY (`tenant_id`,`membership_id`) REFERENCES `memberships`(`tenant_id`,`id`) ON DELETE CASCADE,
	CONSTRAINT "simulator_devices_status_enum_check" CHECK("status" in ('active', 'revoked'))
);
--> statement-breakpoint
CREATE TABLE `tenants` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`clerk_org_id` text NOT NULL,
	`hoppie_station` text,
	`hoppie_logon_enc` text,
	`brand_seed_color` text DEFAULT '#e64646' NOT NULL,
	`brand_presence` text DEFAULT 'balanced' NOT NULL,
	`brand_logo_url` text,
	`brand_logo_pathname` text,
	`settings` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT "tenants_brand_presence_enum_check" CHECK("brand_presence" in ('restrained', 'balanced', 'high')),
	CONSTRAINT "tenants_brand_seed_color_check" CHECK(length("brand_seed_color") = 7 and "brand_seed_color" glob '#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]')
);
--> statement-breakpoint
CREATE INDEX `acars_messages_tenant_created_idx` ON `acars_messages` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `acars_messages_tenant_flight_idx` ON `acars_messages` (`tenant_id`,`flight_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `acars_messages_provider_dedupe_uidx` ON `acars_messages` (`tenant_id`,`provider`,`provider_message_id`);--> statement-breakpoint
CREATE INDEX `audit_events_tenant_created_idx` ON `audit_events` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_events_entity_idx` ON `audit_events` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `dispatch_releases_flight_revision_uidx` ON `dispatch_releases` (`tenant_id`,`flight_id`,`revision`);--> statement-breakpoint
CREATE INDEX `dispatch_releases_tenant_flight_idx` ON `dispatch_releases` (`tenant_id`,`flight_id`);--> statement-breakpoint
CREATE INDEX `flight_oooi_events_flight_created_idx` ON `flight_oooi_events` (`tenant_id`,`flight_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `flight_operational_events_tenant_flight_idx` ON `flight_operational_events` (`tenant_id`,`flight_id`,`occurred_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `flight_operational_events_acars_kind_uidx` ON `flight_operational_events` (`acars_message_id`,`kind`);--> statement-breakpoint
CREATE INDEX `flight_telemetry_current_tenant_sample_idx` ON `flight_telemetry_current` (`tenant_id`,`sample_at`);--> statement-breakpoint
CREATE INDEX `flight_telemetry_current_member_idx` ON `flight_telemetry_current` (`tenant_id`,`membership_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `flight_telemetry_leases_device_uidx` ON `flight_telemetry_leases` (`device_id`);--> statement-breakpoint
CREATE INDEX `flight_telemetry_leases_tenant_device_idx` ON `flight_telemetry_leases` (`tenant_id`,`device_id`);--> statement-breakpoint
CREATE INDEX `flight_telemetry_track_flight_sample_idx` ON `flight_telemetry_track` (`tenant_id`,`flight_id`,`sample_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `flights_tenant_id_uidx` ON `flights` (`tenant_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `flights_tenant_replaces_uidx` ON `flights` (`tenant_id`,`replaces_flight_id`);--> statement-breakpoint
CREATE INDEX `flights_tenant_status_idx` ON `flights` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `flights_tenant_etd_idx` ON `flights` (`tenant_id`,`etd`);--> statement-breakpoint
CREATE INDEX `flights_tenant_pilot_idx` ON `flights` (`tenant_id`,`pilot_membership_id`);--> statement-breakpoint
CREATE INDEX `flights_schedule_request_idx` ON `flights` (`schedule_request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `memberships_tenant_user_uidx` ON `memberships` (`tenant_id`,`clerk_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `memberships_tenant_id_uidx` ON `memberships` (`tenant_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `memberships_tenant_callsign_uidx` ON `memberships` (`tenant_id`,`pilot_callsign`);--> statement-breakpoint
CREATE UNIQUE INDEX `memberships_tenant_simbrief_user_uidx` ON `memberships` (`tenant_id`,`simbrief_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `memberships_tenant_navigraph_subject_uidx` ON `memberships` (`tenant_id`,`navigraph_subject`);--> statement-breakpoint
CREATE INDEX `memberships_tenant_idx` ON `memberships` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `mock_acars_queue_pending_idx` ON `mock_acars_queue` (`tenant_id`,`to_station`,`delivered_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `navigraph_oauth_transactions_state_uidx` ON `navigraph_oauth_transactions` (`state_id`);--> statement-breakpoint
CREATE INDEX `navigraph_oauth_transactions_expiry_idx` ON `navigraph_oauth_transactions` (`expires_at`);--> statement-breakpoint
CREATE INDEX `navigraph_oauth_transactions_member_idx` ON `navigraph_oauth_transactions` (`tenant_id`,`membership_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `privacy_external_tasks_request_provider_action_uidx` ON `privacy_external_tasks` (`request_id`,`provider`,`action`);--> statement-breakpoint
CREATE UNIQUE INDEX `privacy_external_tasks_run_provider_action_uidx` ON `privacy_external_tasks` (`run_id`,`provider`,`action`);--> statement-breakpoint
CREATE INDEX `privacy_external_tasks_tenant_status_idx` ON `privacy_external_tasks` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `privacy_legal_holds_tenant_status_idx` ON `privacy_legal_holds` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `privacy_legal_holds_tenant_member_idx` ON `privacy_legal_holds` (`tenant_id`,`subject_membership_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `privacy_policies_tenant_version_uidx` ON `privacy_policies` (`tenant_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `privacy_policies_one_active_uidx` ON `privacy_policies` (`tenant_id`) WHERE "privacy_policies"."status" = 'active';--> statement-breakpoint
CREATE INDEX `privacy_policies_tenant_status_idx` ON `privacy_policies` (`tenant_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `privacy_retention_runs_tenant_idempotency_uidx` ON `privacy_retention_runs` (`tenant_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `privacy_retention_runs_status_created_idx` ON `privacy_retention_runs` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `privacy_retention_runs_tenant_created_idx` ON `privacy_retention_runs` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `privacy_subject_controls_tenant_member_uidx` ON `privacy_subject_controls` (`tenant_id`,`membership_id`);--> statement-breakpoint
CREATE INDEX `privacy_subject_requests_tenant_status_idx` ON `privacy_subject_requests` (`tenant_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `privacy_subject_requests_tenant_member_idx` ON `privacy_subject_requests` (`tenant_id`,`subject_membership_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `schedule_fulfillment_attempts_request_key_uidx` ON `schedule_fulfillment_attempts` (`tenant_id`,`schedule_request_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `schedule_fulfillment_attempts_request_idx` ON `schedule_fulfillment_attempts` (`tenant_id`,`schedule_request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `schedule_requests_tenant_id_uidx` ON `schedule_requests` (`tenant_id`,`id`);--> statement-breakpoint
CREATE INDEX `schedule_requests_tenant_status_idx` ON `schedule_requests` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `schedule_requests_tenant_pilot_idx` ON `schedule_requests` (`tenant_id`,`pilot_membership_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `simbrief_dispatches_static_id_uidx` ON `simbrief_dispatches` (`static_id`);--> statement-breakpoint
CREATE INDEX `simbrief_dispatches_tenant_flight_created_idx` ON `simbrief_dispatches` (`tenant_id`,`flight_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `simbrief_dispatches_tenant_flight_revision_uidx` ON `simbrief_dispatches` (`tenant_id`,`flight_id`,`revision`);--> statement-breakpoint
CREATE UNIQUE INDEX `simbrief_flight_heads_tenant_flight_uidx` ON `simbrief_flight_heads` (`tenant_id`,`flight_id`);--> statement-breakpoint
CREATE INDEX `simulator_devices_tenant_member_idx` ON `simulator_devices` (`tenant_id`,`membership_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `simulator_devices_tenant_id_uidx` ON `simulator_devices` (`tenant_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `simulator_devices_tenant_member_id_uidx` ON `simulator_devices` (`tenant_id`,`membership_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `tenants_slug_uidx` ON `tenants` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `tenants_clerk_org_uidx` ON `tenants` (`clerk_org_id`);