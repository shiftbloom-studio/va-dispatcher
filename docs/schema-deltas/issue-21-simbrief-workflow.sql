-- Issue #21 reviewed additive schema delta.
--
-- This upgrades the post-PR-#14 SimBrief foundation. Transplant it into the
-- versioned migration chain established by issue #25; do not run this fragment
-- directly against a shared database. Exercise it against a disposable
-- restored snapshot first. The enum value is added before the transactional
-- table changes and is not used until the migration has committed.

ALTER TYPE "simbrief_dispatch_status"
  ADD VALUE IF NOT EXISTS 'prepared' BEFORE 'pending';

BEGIN;

ALTER TABLE "simbrief_dispatches"
  ADD COLUMN "generated_by_membership_id" uuid,
  ADD COLUMN "callback_expires_at" timestamp with time zone,
  ADD COLUMN "flight_snapshot" jsonb,
  ADD COLUMN "revision" integer;

ALTER TABLE "simbrief_dispatches"
  ALTER COLUMN "simbrief_user_id" DROP NOT NULL;

-- PR #14 generated immediately and attributed the operation to the creating
-- member. Preserve that historical fact while new rows distinguish the
-- dispatcher who prepared the revision from the pilot who generated it.
UPDATE "simbrief_dispatches"
SET "generated_by_membership_id" = "created_by_membership_id"
WHERE "generated_by_membership_id" IS NULL
  AND "simbrief_user_id" IS NOT NULL;

-- Material fields are snapshotted so a prepared revision cannot launch after
-- assignment, route, schedule, or aircraft changes. Existing rows represent
-- already-launched/ready plans and are backfilled from their current flight.
UPDATE "simbrief_dispatches" AS dispatch
SET "flight_snapshot" = jsonb_build_object(
  'pilotMembershipId', flight."pilot_membership_id",
  'flightNumber', flight."flight_number",
  'depIcao', flight."dep_icao",
  'arrIcao', flight."arr_icao",
  'etd', to_char(flight."etd" AT TIME ZONE 'UTC',
                 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'eta', to_char(flight."eta" AT TIME ZONE 'UTC',
                 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'aircraftType', flight."aircraft_type"
)
FROM "flights" AS flight
WHERE dispatch."flight_id" = flight."id";

-- Give historical plans a deterministic order, oldest first. Future prepare
-- operations increment the per-flight head in one upsert and copy that value
-- into the immutable dispatch row.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY tenant_id, flight_id
           ORDER BY created_at, id
         )::integer AS revision
  FROM "simbrief_dispatches"
)
UPDATE "simbrief_dispatches" AS dispatch
SET "revision" = ranked.revision
FROM ranked
WHERE dispatch.id = ranked.id;

-- Existing callback MACs predate an immutable expiry and cannot safely be
-- grandfathered. Fail closed by consuming them; authenticated manual sync
-- remains available for unfinished historical plans.
UPDATE "simbrief_dispatches"
SET "callback_token_mac" = NULL
WHERE "callback_token_mac" IS NOT NULL
  AND "callback_expires_at" IS NULL;

ALTER TABLE "simbrief_dispatches"
  ALTER COLUMN "flight_snapshot" SET NOT NULL,
  ALTER COLUMN "revision" SET NOT NULL,
  ADD CONSTRAINT "simbrief_dispatches_generated_by_membership_id_memberships_id_fk"
    FOREIGN KEY ("generated_by_membership_id")
    REFERENCES "memberships"("id") ON DELETE SET NULL,
  ADD CONSTRAINT "simbrief_dispatches_flight_snapshot_object_check"
    CHECK (jsonb_typeof("flight_snapshot") = 'object'),
  ADD CONSTRAINT "simbrief_dispatches_positive_revision_check"
    CHECK ("revision" > 0),
  ADD CONSTRAINT "simbrief_dispatches_callback_lifecycle_check"
    CHECK (
      "callback_token_mac" IS NULL
      OR (
        "status" = 'pending'
        AND "callback_expires_at" IS NOT NULL
      )
    );

CREATE UNIQUE INDEX IF NOT EXISTS "flights_tenant_id_uidx"
  ON "flights" ("tenant_id", "id");
CREATE UNIQUE INDEX "simbrief_dispatches_tenant_flight_revision_uidx"
  ON "simbrief_dispatches" ("tenant_id", "flight_id", "revision");

ALTER TABLE "simbrief_dispatches"
  ADD CONSTRAINT "simbrief_dispatches_tenant_flight_fk"
    FOREIGN KEY ("tenant_id", "flight_id")
    REFERENCES "flights" ("tenant_id", "id") ON DELETE CASCADE;

CREATE TABLE "simbrief_flight_heads" (
  "flight_id" uuid PRIMARY KEY
    REFERENCES "flights"("id") ON DELETE CASCADE,
  "tenant_id" uuid NOT NULL
    REFERENCES "tenants"("id") ON DELETE CASCADE,
  "revision" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "simbrief_flight_heads_positive_revision_check"
    CHECK ("revision" > 0),
  CONSTRAINT "simbrief_flight_heads_tenant_flight_fk"
    FOREIGN KEY ("tenant_id", "flight_id")
    REFERENCES "flights" ("tenant_id", "id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "simbrief_flight_heads_tenant_flight_uidx"
  ON "simbrief_flight_heads" ("tenant_id", "flight_id");

INSERT INTO "simbrief_flight_heads" (
  "flight_id", "tenant_id", "revision", "created_at", "updated_at"
)
SELECT flight_id, tenant_id, max(revision), min(created_at), max(updated_at)
FROM "simbrief_dispatches"
GROUP BY flight_id, tenant_id;

COMMIT;

-- Roll-forward note: the new callback is valid for at most two hours from the
-- atomic prepared->pending transition. Sync failures may update updated_at but
-- never callback_expires_at. The head row is the compare-and-set linearization
-- point that makes simultaneous prepare/generate ordering deterministic under
-- PostgreSQL READ COMMITTED. Rollback would lose canonical prepared revisions
-- and immutable callback timing, so take an operational backup and complete or
-- cancel pending plans before any deliberate reverse migration.

-- Mandatory integration with issue #17: once flights.version exists, snapshot
-- that version at preparation, include it in the atomic launch predicate, and
-- carry the from/to version through any shared flight mutation/audit primitive.
-- Keep the material-field checks above as defense in depth. PR #29 also makes
-- dispatch_releases the canonical planning revision: bind the preparation to
-- the current release ID/revision and require that same release at launch.
-- Preserve its elevated planning workspace instead of retaining a second,
-- competing dispatcher route/remarks form when transplanting the UI.
