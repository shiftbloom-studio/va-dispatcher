CREATE TYPE "simbrief_dispatch_status" AS ENUM('pending', 'ready');

ALTER TABLE "memberships" ADD COLUMN "simbrief_user_id" text;
ALTER TABLE "memberships" ADD COLUMN "simbrief_verified_at" timestamp with time zone;
ALTER TABLE "memberships" ADD COLUMN "navigraph_subject" text;
ALTER TABLE "memberships" ADD COLUMN "navigraph_username" text;
ALTER TABLE "memberships" ADD COLUMN "navigraph_connected_at" timestamp with time zone;

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

CREATE UNIQUE INDEX "memberships_tenant_simbrief_user_uidx" ON "memberships" ("tenant_id", "simbrief_user_id");
CREATE UNIQUE INDEX "memberships_tenant_navigraph_subject_uidx" ON "memberships" ("tenant_id", "navigraph_subject");
CREATE UNIQUE INDEX "navigraph_oauth_transactions_state_uidx" ON "navigraph_oauth_transactions" ("state_id");
CREATE INDEX "navigraph_oauth_transactions_expiry_idx" ON "navigraph_oauth_transactions" ("expires_at");
CREATE INDEX "navigraph_oauth_transactions_member_idx" ON "navigraph_oauth_transactions" ("tenant_id", "membership_id");
CREATE UNIQUE INDEX "simbrief_dispatches_static_id_uidx" ON "simbrief_dispatches" ("static_id");
CREATE INDEX "simbrief_dispatches_tenant_flight_created_idx" ON "simbrief_dispatches" ("tenant_id", "flight_id", "created_at");

ALTER TABLE "navigraph_oauth_transactions" ADD CONSTRAINT "navigraph_oauth_transactions_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;
ALTER TABLE "navigraph_oauth_transactions" ADD CONSTRAINT "navigraph_oauth_transactions_membership_id_memberships_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE CASCADE;
ALTER TABLE "simbrief_dispatches" ADD CONSTRAINT "simbrief_dispatches_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;
ALTER TABLE "simbrief_dispatches" ADD CONSTRAINT "simbrief_dispatches_flight_id_flights_id_fkey" FOREIGN KEY ("flight_id") REFERENCES "flights"("id") ON DELETE CASCADE;
ALTER TABLE "simbrief_dispatches" ADD CONSTRAINT "simbrief_dispatches_nXjb1iqZ7Tas_fkey" FOREIGN KEY ("created_by_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL;
