CREATE TYPE "privacy_external_provider" AS ENUM('clerk', 'vercel', 'neon', 'hoppie', 'backup', 'navigraph');--> statement-breakpoint
CREATE TYPE "privacy_external_task_status" AS ENUM('pending', 'completed', 'not_applicable', 'failed');--> statement-breakpoint
CREATE TYPE "privacy_hold_status" AS ENUM('pending', 'active', 'released');--> statement-breakpoint
CREATE TYPE "privacy_policy_status" AS ENUM('draft', 'active', 'retired');--> statement-breakpoint
CREATE TYPE "privacy_request_kind" AS ENUM('export', 'correction', 'restriction', 'objection', 'anonymization', 'erasure');--> statement-breakpoint
CREATE TYPE "privacy_request_scope" AS ENUM('member', 'tenant');--> statement-breakpoint
CREATE TYPE "privacy_request_status" AS ENUM('pending_verification', 'pending_approval', 'approved', 'processing', 'awaiting_external', 'completed', 'blocked', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "privacy_run_mode" AS ENUM('dry_run', 'execute');--> statement-breakpoint
CREATE TYPE "privacy_run_status" AS ENUM('queued', 'running', 'completed', 'failed');--> statement-breakpoint
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
ALTER TABLE "privacy_retention_runs" ADD CONSTRAINT "privacy_retention_runs_dry_run_id_privacy_retention_runs_id_fkey" FOREIGN KEY ("dry_run_id") REFERENCES "privacy_retention_runs"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "privacy_retention_runs" ADD CONSTRAINT "privacy_retention_runs_jBGAnnworq8y_fkey" FOREIGN KEY ("requested_by_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "privacy_subject_controls" ADD CONSTRAINT "privacy_subject_controls_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "privacy_subject_controls" ADD CONSTRAINT "privacy_subject_controls_membership_id_memberships_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "privacy_subject_controls" ADD CONSTRAINT "privacy_subject_controls_9nUCwDaQSWuz_fkey" FOREIGN KEY ("updated_by_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "privacy_subject_requests" ADD CONSTRAINT "privacy_subject_requests_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "privacy_subject_requests" ADD CONSTRAINT "privacy_subject_requests_tkm5UVzF22vw_fkey" FOREIGN KEY ("subject_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "privacy_subject_requests" ADD CONSTRAINT "privacy_subject_requests_Lskxhmb22jna_fkey" FOREIGN KEY ("created_by_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "privacy_subject_requests" ADD CONSTRAINT "privacy_subject_requests_8ZxEnqShdnfM_fkey" FOREIGN KEY ("verified_by_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "privacy_subject_requests" ADD CONSTRAINT "privacy_subject_requests_VCx8HjOa3sdP_fkey" FOREIGN KEY ("approved_by_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL;
