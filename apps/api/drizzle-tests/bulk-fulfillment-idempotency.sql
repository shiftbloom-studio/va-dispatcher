-- Real PostgreSQL contract test for issue #19. It exercises the same
-- request-lock -> cumulative-capacity -> idempotency-claim -> flights ->
-- request-progress -> audit dependency graph as the repository and uses
-- dblink sessions for actual concurrent submissions.
--
-- Run only against a disposable PostgreSQL 17+ database after applying the
-- current schema:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f drizzle-tests/bulk-fulfillment-idempotency.sql

CREATE EXTENSION IF NOT EXISTS dblink;

CREATE OR REPLACE FUNCTION va_test_fulfill(
  p_request_id uuid,
  p_idempotency_key text,
  p_payload_hash text,
  p_expected_version integer,
  p_flight_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
  stored schedule_fulfillment_attempts%ROWTYPE;
  result jsonb;
  batch_count integer := cardinality(p_flight_ids);
BEGIN
  SELECT *
  INTO stored
  FROM schedule_fulfillment_attempts
  WHERE
    tenant_id = '40000000-0000-4000-8000-000000000004'
    AND schedule_request_id = p_request_id
    AND idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF stored.payload_hash <> p_payload_hash THEN
      RAISE EXCEPTION 'idempotency payload mismatch'
        USING ERRCODE = '23514';
    END IF;
    RETURN jsonb_build_object(
      'flightIds', stored.flight_ids,
      'requestStatus', stored.request_status,
      'requestVersion', stored.request_version,
      'linkedFlightCount', stored.linked_flight_count,
      'remainingFlightCount', stored.remaining_flight_count
    );
  END IF;

  WITH request_locked AS (
    SELECT
      schedule_requests.id,
      schedule_requests.pilot_membership_id,
      schedule_requests.desired_flight_count,
      schedule_requests.status
    FROM schedule_requests
    WHERE
      schedule_requests.tenant_id =
        '40000000-0000-4000-8000-000000000004'
      AND schedule_requests.id = p_request_id
      AND schedule_requests.version = p_expected_version
      AND schedule_requests.status IN (
        'in_review',
        'partially_fulfilled'
      )
    FOR UPDATE OF schedule_requests
  ), capacity AS (
    SELECT
      request_locked.id,
      request_locked.pilot_membership_id,
      request_locked.desired_flight_count,
      request_locked.status AS from_status,
      count(flights.id) FILTER (
        WHERE flights.status <> 'cancelled'
      )::integer AS existing_flight_count
    FROM request_locked
    LEFT JOIN flights
      ON flights.tenant_id = '40000000-0000-4000-8000-000000000004'
      AND flights.schedule_request_id = request_locked.id
    GROUP BY
      request_locked.id,
      request_locked.pilot_membership_id,
      request_locked.desired_flight_count,
      request_locked.status
    HAVING
      count(flights.id) FILTER (WHERE flights.status <> 'cancelled')
        + batch_count <= request_locked.desired_flight_count
  ), claimed AS (
    INSERT INTO schedule_fulfillment_attempts (
      tenant_id,
      schedule_request_id,
      idempotency_key,
      payload_hash,
      flight_ids,
      request_status,
      request_version,
      linked_flight_count,
      remaining_flight_count
    )
    SELECT
      '40000000-0000-4000-8000-000000000004',
      capacity.id,
      p_idempotency_key,
      p_payload_hash,
      p_flight_ids,
      CASE
        WHEN capacity.existing_flight_count + batch_count
          >= capacity.desired_flight_count
          THEN 'fulfilled'::schedule_request_status
        ELSE 'partially_fulfilled'::schedule_request_status
      END,
      p_expected_version + 1,
      capacity.existing_flight_count + batch_count,
      greatest(
        0,
        capacity.desired_flight_count
          - capacity.existing_flight_count
          - batch_count
      )
    FROM capacity
    ON CONFLICT (
      tenant_id,
      schedule_request_id,
      idempotency_key
    ) DO NOTHING
    RETURNING id
  ), proposed AS (
    SELECT id, ordinal
    FROM unnest(p_flight_ids) WITH ORDINALITY AS item(id, ordinal)
  ), inserted AS (
    INSERT INTO flights (
      id,
      tenant_id,
      schedule_request_id,
      pilot_membership_id,
      flight_number,
      dep_icao,
      arr_icao,
      etd,
      eta,
      status,
      version
    )
    SELECT
      proposed.id,
      '40000000-0000-4000-8000-000000000004',
      capacity.id,
      capacity.pilot_membership_id,
      'SK' || (950 + proposed.ordinal)::text,
      'EKCH',
      'ENGM',
      '2026-09-20T08:00:00Z'::timestamptz
        + proposed.ordinal * interval '2 hours',
      '2026-09-20T09:30:00Z'::timestamptz
        + proposed.ordinal * interval '2 hours',
      'offered',
      1
    FROM proposed
    CROSS JOIN capacity
    CROSS JOIN claimed
    RETURNING flights.id
  ), batch_checked AS (
    SELECT
      capacity.id,
      capacity.from_status,
      capacity.desired_flight_count,
      capacity.existing_flight_count,
      capacity.existing_flight_count + count(inserted.id)::integer
        AS cumulative_flight_count
    FROM capacity
    LEFT JOIN inserted ON TRUE
    GROUP BY
      capacity.id,
      capacity.from_status,
      capacity.desired_flight_count,
      capacity.existing_flight_count
    HAVING count(inserted.id) = batch_count
  ), request_updated AS (
    UPDATE schedule_requests
    SET
      status = CASE
        WHEN batch_checked.cumulative_flight_count
          >= batch_checked.desired_flight_count
          THEN 'fulfilled'::schedule_request_status
        ELSE 'partially_fulfilled'::schedule_request_status
      END,
      version = version + 1,
      updated_at = NOW()
    FROM batch_checked
    WHERE
      schedule_requests.tenant_id =
        '40000000-0000-4000-8000-000000000004'
      AND schedule_requests.id = batch_checked.id
      AND schedule_requests.version = p_expected_version
      AND schedule_requests.status = batch_checked.from_status
    RETURNING
      schedule_requests.id,
      schedule_requests.status,
      schedule_requests.version,
      batch_checked.cumulative_flight_count,
      batch_checked.desired_flight_count
  ), audited AS (
    INSERT INTO audit_events (
      tenant_id,
      actor_membership_id,
      action,
      entity_type,
      entity_id,
      meta
    )
    SELECT
      '40000000-0000-4000-8000-000000000004'::uuid,
      '42000000-0000-4000-8000-000000000004'::uuid,
      'schedule_request.fulfillment_progress',
      'schedule_request',
      request_updated.id,
      jsonb_build_object(
        'fromVersion', p_expected_version,
        'toVersion', request_updated.version
      )
    FROM request_updated
    UNION ALL
    SELECT
      '40000000-0000-4000-8000-000000000004'::uuid,
      '42000000-0000-4000-8000-000000000004'::uuid,
      'flight.bulk_create',
      'schedule_request',
      request_updated.id,
      jsonb_build_object('flightIds', p_flight_ids)
    FROM request_updated
    RETURNING id
  ), audit_totals AS (
    SELECT count(*)::integer AS count FROM audited
  )
  SELECT jsonb_build_object(
    'flightIds', p_flight_ids,
    'requestStatus', request_updated.status,
    'requestVersion', request_updated.version,
    'linkedFlightCount', request_updated.cumulative_flight_count,
    'remainingFlightCount', greatest(
      0,
      request_updated.desired_flight_count
        - request_updated.cumulative_flight_count
    )
  )
  INTO result
  FROM request_updated
  CROSS JOIN audit_totals
  WHERE audit_totals.count = 2;

  IF result IS NOT NULL THEN
    RETURN result;
  END IF;

  -- A same-key contender may have waited for the winner's row lock. This new
  -- statement snapshot discovers the committed original outcome.
  SELECT *
  INTO stored
  FROM schedule_fulfillment_attempts
  WHERE
    tenant_id = '40000000-0000-4000-8000-000000000004'
    AND schedule_request_id = p_request_id
    AND idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF stored.payload_hash <> p_payload_hash THEN
      RAISE EXCEPTION 'idempotency payload mismatch'
        USING ERRCODE = '23514';
    END IF;
    RETURN jsonb_build_object(
      'flightIds', stored.flight_ids,
      'requestStatus', stored.request_status,
      'requestVersion', stored.request_version,
      'linkedFlightCount', stored.linked_flight_count,
      'remainingFlightCount', stored.remaining_flight_count
    );
  END IF;

  RETURN NULL;
END
$function$;

BEGIN;

INSERT INTO tenants (id, slug, name, clerk_org_id)
VALUES (
  '40000000-0000-4000-8000-000000000004',
  'fulfillment-test',
  'Fulfillment Test',
  'org_fulfillment_test'
);

INSERT INTO memberships (id, tenant_id, clerk_user_id, role, status)
VALUES
  (
    '41000000-0000-4000-8000-000000000004',
    '40000000-0000-4000-8000-000000000004',
    'user_fulfillment_pilot',
    'pilot',
    'active'
  ),
  (
    '42000000-0000-4000-8000-000000000004',
    '40000000-0000-4000-8000-000000000004',
    'user_fulfillment_dispatcher',
    'dispatcher',
    'active'
  );

INSERT INTO schedule_requests (
  id,
  tenant_id,
  pilot_membership_id,
  window_start,
  window_end,
  desired_flight_count,
  version,
  status
) VALUES
  (
    '43000000-0000-4000-8000-000000000004',
    '40000000-0000-4000-8000-000000000004',
    '41000000-0000-4000-8000-000000000004',
    '2026-09-20T08:00:00Z',
    '2026-09-21T08:00:00Z',
    2,
    1,
    'in_review'
  ),
  (
    '44000000-0000-4000-8000-000000000004',
    '40000000-0000-4000-8000-000000000004',
    '41000000-0000-4000-8000-000000000004',
    '2026-09-20T08:00:00Z',
    '2026-09-21T08:00:00Z',
    1,
    1,
    'in_review'
  ),
  (
    '45000000-0000-4000-8000-000000000004',
    '40000000-0000-4000-8000-000000000004',
    '41000000-0000-4000-8000-000000000004',
    '2026-09-20T08:00:00Z',
    '2026-09-21T08:00:00Z',
    1,
    1,
    'cancelled'
  ),
  (
    '46000000-0000-4000-8000-000000000004',
    '40000000-0000-4000-8000-000000000004',
    '41000000-0000-4000-8000-000000000004',
    '2026-09-20T08:00:00Z',
    '2026-09-21T08:00:00Z',
    2,
    2,
    'partially_fulfilled'
  ),
  (
    '47000000-0000-4000-8000-000000000004',
    '40000000-0000-4000-8000-000000000004',
    '41000000-0000-4000-8000-000000000004',
    '2026-09-20T08:00:00Z',
    '2026-09-21T08:00:00Z',
    1,
    1,
    'in_review'
  );

INSERT INTO flights (
  id,
  tenant_id,
  schedule_request_id,
  pilot_membership_id,
  flight_number,
  dep_icao,
  arr_icao,
  etd,
  eta,
  status,
  version
) VALUES (
  '46100000-0000-4000-8000-000000000004',
  '40000000-0000-4000-8000-000000000004',
  '46000000-0000-4000-8000-000000000004',
  '41000000-0000-4000-8000-000000000004',
  'SK946',
  'EKCH',
  'ENGM',
  '2026-09-20T08:30:00Z',
  '2026-09-20T10:00:00Z',
  'offered',
  1
);

COMMIT;

CREATE TEMP TABLE fulfillment_race_results (
  race text NOT NULL,
  contender text NOT NULL,
  result jsonb
);

-- Same key and canonical payload: exactly one batch commits and both callers
-- receive that winner's exact ordered IDs and request outcome.
SELECT dblink_connect('same_a', 'dbname=' || current_database());
SELECT dblink_connect('same_b', 'dbname=' || current_database());
SELECT dblink_send_query(
  'same_a',
  $$SELECT va_test_fulfill(
    '43000000-0000-4000-8000-000000000004',
    'same-key',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    1,
    ARRAY[
      '43100000-0000-4000-8000-000000000004',
      '43200000-0000-4000-8000-000000000004'
    ]::uuid[]
  ) AS result$$
);
SELECT dblink_send_query(
  'same_b',
  $$SELECT va_test_fulfill(
    '43000000-0000-4000-8000-000000000004',
    'same-key',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    1,
    ARRAY[
      '43300000-0000-4000-8000-000000000004',
      '43400000-0000-4000-8000-000000000004'
    ]::uuid[]
  ) AS result$$
);
INSERT INTO fulfillment_race_results
SELECT 'same-key', 'a', result
FROM dblink_get_result('same_a') AS response(result jsonb);
INSERT INTO fulfillment_race_results
SELECT 'same-key', 'b', result
FROM dblink_get_result('same_b') AS response(result jsonb);
SELECT dblink_disconnect('same_a');
SELECT dblink_disconnect('same_b');

DO $test$
DECLARE
  first_result jsonb;
  second_result jsonb;
BEGIN
  SELECT result INTO first_result
  FROM fulfillment_race_results
  WHERE race = 'same-key' AND contender = 'a';
  SELECT result INTO second_result
  FROM fulfillment_race_results
  WHERE race = 'same-key' AND contender = 'b';

  IF first_result IS NULL OR first_result <> second_result THEN
    RAISE EXCEPTION 'same-key contenders did not receive one exact result';
  END IF;
  IF jsonb_array_length(first_result -> 'flightIds') <> 2
    OR first_result ->> 'requestStatus' <> 'fulfilled'
    OR (first_result ->> 'requestVersion')::integer <> 2
  THEN
    RAISE EXCEPTION 'same-key replay lost ordered IDs or status outcome';
  END IF;
  IF (
    SELECT count(*) FROM schedule_fulfillment_attempts
    WHERE schedule_request_id = '43000000-0000-4000-8000-000000000004'
  ) <> 1 OR (
    SELECT count(*) FROM flights
    WHERE schedule_request_id = '43000000-0000-4000-8000-000000000004'
  ) <> 2 THEN
    RAISE EXCEPTION 'same-key race committed duplicate canonical records';
  END IF;
END
$test$;

-- Reusing that key for a different canonical payload is a clear conflict.
DO $test$
BEGIN
  BEGIN
    PERFORM va_test_fulfill(
      '43000000-0000-4000-8000-000000000004',
      'same-key',
      'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      1,
      ARRAY['43500000-0000-4000-8000-000000000004']::uuid[]
    );
    RAISE EXCEPTION 'mismatched idempotency payload was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END
$test$;

-- Different keys compete on one request row and cumulative capacity. One wins;
-- the loser reserves no key and cannot exceed desired_flight_count.
SELECT dblink_connect('different_a', 'dbname=' || current_database());
SELECT dblink_connect('different_b', 'dbname=' || current_database());
SELECT dblink_send_query(
  'different_a',
  $$SELECT va_test_fulfill(
    '44000000-0000-4000-8000-000000000004',
    'different-key-a',
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    1,
    ARRAY['44100000-0000-4000-8000-000000000004']::uuid[]
  ) AS result$$
);
SELECT dblink_send_query(
  'different_b',
  $$SELECT va_test_fulfill(
    '44000000-0000-4000-8000-000000000004',
    'different-key-b',
    'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    1,
    ARRAY['44200000-0000-4000-8000-000000000004']::uuid[]
  ) AS result$$
);
INSERT INTO fulfillment_race_results
SELECT 'different-key', 'a', result
FROM dblink_get_result('different_a') AS response(result jsonb);
INSERT INTO fulfillment_race_results
SELECT 'different-key', 'b', result
FROM dblink_get_result('different_b') AS response(result jsonb);
SELECT dblink_disconnect('different_a');
SELECT dblink_disconnect('different_b');

DO $test$
BEGIN
  IF (
    SELECT count(*) FROM fulfillment_race_results
    WHERE race = 'different-key' AND result IS NOT NULL
  ) <> 1 OR (
    SELECT count(*) FROM fulfillment_race_results
    WHERE race = 'different-key' AND result IS NULL
  ) <> 1 THEN
    RAISE EXCEPTION 'different-key capacity race did not have one winner';
  END IF;
  IF (
    SELECT count(*) FROM schedule_fulfillment_attempts
    WHERE schedule_request_id = '44000000-0000-4000-8000-000000000004'
  ) <> 1 OR (
    SELECT count(*) FROM flights
    WHERE schedule_request_id = '44000000-0000-4000-8000-000000000004'
  ) <> 1 THEN
    RAISE EXCEPTION 'different-key race exceeded cumulative capacity';
  END IF;
END
$test$;

-- Terminal precheck: neither an attempt nor a canonical flight is inserted.
DO $test$
BEGIN
  IF va_test_fulfill(
    '45000000-0000-4000-8000-000000000004',
    'terminal-key',
    'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    1,
    ARRAY['45100000-0000-4000-8000-000000000004']::uuid[]
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'terminal fulfillment unexpectedly returned a result';
  END IF;
  IF EXISTS (
    SELECT 1 FROM schedule_fulfillment_attempts
    WHERE schedule_request_id = '45000000-0000-4000-8000-000000000004'
  ) OR EXISTS (
    SELECT 1 FROM flights
    WHERE schedule_request_id = '45000000-0000-4000-8000-000000000004'
  ) THEN
    RAISE EXCEPTION 'terminal fulfillment reserved or inserted data';
  END IF;
END
$test$;

-- A partially fulfilled request counts the existing non-cancelled offer and
-- may append only its exact remainder.
DO $test$
DECLARE
  append_result jsonb;
BEGIN
  append_result := va_test_fulfill(
    '46000000-0000-4000-8000-000000000004',
    'append-key',
    'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    2,
    ARRAY['46200000-0000-4000-8000-000000000004']::uuid[]
  );
  IF append_result ->> 'requestStatus' <> 'fulfilled'
    OR (append_result ->> 'linkedFlightCount')::integer <> 2
    OR (append_result ->> 'remainingFlightCount')::integer <> 0
  THEN
    RAISE EXCEPTION 'partial append did not use cumulative capacity';
  END IF;
END
$test$;

-- Reject the late flight audit. PostgreSQL must roll back the attempt claim,
-- flight insert, request mutation, and earlier request audit together.
CREATE FUNCTION pg_temp.reject_bulk_audit()
RETURNS trigger
LANGUAGE plpgsql
AS $trigger$
BEGIN
  IF current_setting('va_dispatch.test_reject_bulk_audit', true) = NEW.action
  THEN
    RAISE EXCEPTION 'synthetic bulk audit failure';
  END IF;
  RETURN NEW;
END
$trigger$;

CREATE TRIGGER reject_bulk_audit
BEFORE INSERT ON audit_events
FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_bulk_audit();

DO $test$
BEGIN
  PERFORM set_config(
    'va_dispatch.test_reject_bulk_audit',
    'flight.bulk_create',
    true
  );
  BEGIN
    PERFORM va_test_fulfill(
      '47000000-0000-4000-8000-000000000004',
      'rollback-key',
      '9999999999999999999999999999999999999999999999999999999999999999',
      1,
      ARRAY['47100000-0000-4000-8000-000000000004']::uuid[]
    );
    RAISE EXCEPTION 'expected late audit failure was not raised';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'synthetic bulk audit failure' THEN
      RAISE;
    END IF;
  END;
  PERFORM set_config('va_dispatch.test_reject_bulk_audit', '', true);

  IF EXISTS (
    SELECT 1 FROM schedule_fulfillment_attempts
    WHERE schedule_request_id = '47000000-0000-4000-8000-000000000004'
  ) OR EXISTS (
    SELECT 1 FROM flights
    WHERE schedule_request_id = '47000000-0000-4000-8000-000000000004'
  ) OR EXISTS (
    SELECT 1 FROM audit_events
    WHERE entity_id = '47000000-0000-4000-8000-000000000004'
  ) OR NOT EXISTS (
    SELECT 1 FROM schedule_requests
    WHERE id = '47000000-0000-4000-8000-000000000004'
      AND status = 'in_review'
      AND version = 1
  ) THEN
    RAISE EXCEPTION 'late audit failure left a fulfillment fragment';
  END IF;
END
$test$;

DROP TRIGGER reject_bulk_audit ON audit_events;
DELETE FROM tenants
WHERE id = '40000000-0000-4000-8000-000000000004';
DROP FUNCTION va_test_fulfill(uuid, text, text, integer, uuid[]);
DROP EXTENSION dblink;
