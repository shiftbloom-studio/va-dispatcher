-- Executable PostgreSQL contract test for the data-modifying CTE boundaries
-- used by schedule-request cancellation and fulfillment. Run only against a
-- disposable database after applying the current schema:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f drizzle-tests/schedule-lifecycle-atomicity.sql

BEGIN;

INSERT INTO tenants (id, slug, name, clerk_org_id)
VALUES (
  '30000000-0000-4000-8000-000000000003',
  'lifecycle-test',
  'Lifecycle Test',
  'org_lifecycle_test'
);

INSERT INTO memberships (id, tenant_id, clerk_user_id, role, status)
VALUES
  (
    '31000000-0000-4000-8000-000000000003',
    '30000000-0000-4000-8000-000000000003',
    'user_lifecycle_pilot',
    'pilot',
    'active'
  ),
  (
    '32000000-0000-4000-8000-000000000003',
    '30000000-0000-4000-8000-000000000003',
    'user_lifecycle_dispatcher',
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
  preferences,
  version,
  status
) VALUES
  (
    '33000000-0000-4000-8000-000000000003',
    '30000000-0000-4000-8000-000000000003',
    '31000000-0000-4000-8000-000000000003',
    '2026-09-10T08:00:00Z',
    '2026-09-10T12:00:00Z',
    1,
    '{"availability":[{"startAt":"2026-09-10T08:00:00.000Z","endAt":"2026-09-10T12:00:00.000Z"}]}'::jsonb,
    1,
    'in_review'
  ),
  (
    '34000000-0000-4000-8000-000000000003',
    '30000000-0000-4000-8000-000000000003',
    '31000000-0000-4000-8000-000000000003',
    '2026-09-11T08:00:00Z',
    '2026-09-11T14:00:00Z',
    2,
    '{"availability":[{"startAt":"2026-09-11T08:00:00.000Z","endAt":"2026-09-11T14:00:00.000Z"}]}'::jsonb,
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
  version,
  status
) VALUES (
  '35000000-0000-4000-8000-000000000003',
  '30000000-0000-4000-8000-000000000003',
  '33000000-0000-4000-8000-000000000003',
  '31000000-0000-4000-8000-000000000003',
  'SK931',
  'EKCH',
  'ENGM',
  '2026-09-10T08:30:00Z',
  '2026-09-10T10:00:00Z',
  1,
  'offered'
);

CREATE FUNCTION pg_temp.reject_selected_audit()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF current_setting('va_dispatch.test_reject_audit', true) = NEW.action THEN
    RAISE EXCEPTION 'synthetic audit failure';
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER reject_selected_audit
BEFORE INSERT ON audit_events
FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_selected_audit();

-- This is the cancellation repository's request -> flight -> audit CTE shape.
-- Failing the per-flight audit after the request audit has been selected must
-- roll back both versioned mutations and every audit fragment.
DO $test$
DECLARE
  affected_id uuid;
BEGIN
  PERFORM set_config(
    'va_dispatch.test_reject_audit',
    'flight.cancelled',
    true
  );
  BEGIN
    WITH request_updated AS (
      UPDATE schedule_requests
      SET
        status = 'cancelled',
        cancel_reason = 'Synthetic cancellation',
        version = version + 1,
        updated_at = NOW()
      WHERE
        tenant_id = '30000000-0000-4000-8000-000000000003'
        AND id = '33000000-0000-4000-8000-000000000003'
        AND version = 1
        AND status = 'in_review'
      RETURNING id
    ), eligible_flights AS (
      SELECT
        flights.id,
        flights.status AS from_status,
        flights.version AS from_version
      FROM flights
      INNER JOIN request_updated ON TRUE
      WHERE
        flights.tenant_id = '30000000-0000-4000-8000-000000000003'
        AND flights.schedule_request_id = '33000000-0000-4000-8000-000000000003'
        AND flights.status IN ('draft', 'offered', 'accepted', 'briefed')
      FOR UPDATE OF flights
    ), cancelled_flights AS (
      UPDATE flights
      SET
        status = 'cancelled',
        cancel_reason = 'Synthetic cancellation',
        version = version + 1,
        updated_at = NOW()
      FROM eligible_flights
      WHERE
        flights.tenant_id = '30000000-0000-4000-8000-000000000003'
        AND flights.id = eligible_flights.id
      RETURNING
        flights.id,
        eligible_flights.from_status,
        eligible_flights.from_version,
        flights.version AS to_version
    ), request_audited AS (
      INSERT INTO audit_events (
        tenant_id,
        actor_membership_id,
        action,
        entity_type,
        entity_id,
        meta
      )
      SELECT
        '30000000-0000-4000-8000-000000000003'::uuid,
        '32000000-0000-4000-8000-000000000003'::uuid,
        'schedule_request.cancelled',
        'schedule_request',
        request_updated.id,
        '{"from":"in_review","to":"cancelled","fromVersion":1,"toVersion":2}'::jsonb
      FROM request_updated
      RETURNING id
    ), flights_audited AS (
      INSERT INTO audit_events (
        tenant_id,
        actor_membership_id,
        action,
        entity_type,
        entity_id,
        meta
      )
      SELECT
        '30000000-0000-4000-8000-000000000003'::uuid,
        '32000000-0000-4000-8000-000000000003'::uuid,
        'flight.cancelled',
        'flight',
        cancelled_flights.id,
        jsonb_build_object(
          'from', cancelled_flights.from_status,
          'to', 'cancelled',
          'fromVersion', cancelled_flights.from_version,
          'toVersion', cancelled_flights.to_version
        )
      FROM cancelled_flights
      RETURNING id
    ), cancelled_totals AS (
      SELECT count(*)::integer AS count FROM cancelled_flights
    ), audit_totals AS (
      SELECT count(*)::integer AS count FROM flights_audited
    )
    SELECT request_updated.id
    INTO affected_id
    FROM request_updated
    INNER JOIN request_audited ON TRUE
    INNER JOIN cancelled_totals ON TRUE
    INNER JOIN audit_totals
      ON audit_totals.count = cancelled_totals.count;

    RAISE EXCEPTION 'expected cancellation audit failure was not raised';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'synthetic audit failure' THEN
      RAISE;
    END IF;
  END;

  PERFORM set_config('va_dispatch.test_reject_audit', '', true);

  IF NOT EXISTS (
    SELECT 1 FROM schedule_requests
    WHERE id = '33000000-0000-4000-8000-000000000003'
      AND status = 'in_review'
      AND version = 1
  ) THEN
    RAISE EXCEPTION 'failed cancellation changed the request';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM flights
    WHERE id = '35000000-0000-4000-8000-000000000003'
      AND status = 'offered'
      AND version = 1
  ) THEN
    RAISE EXCEPTION 'failed cancellation changed a linked flight';
  END IF;
  IF EXISTS (
    SELECT 1 FROM audit_events
    WHERE entity_id IN (
      '33000000-0000-4000-8000-000000000003',
      '35000000-0000-4000-8000-000000000003'
    )
  ) THEN
    RAISE EXCEPTION 'failed cancellation left an audit fragment';
  END IF;
END
$test$;

-- This is the fulfillment repository's locked capacity -> insert -> request
-- update -> audit CTE shape. Rejecting the second audit must roll back every
-- preceding CTE, including the newly inserted flight and request version.
DO $test$
DECLARE
  affected_id uuid;
BEGIN
  PERFORM set_config(
    'va_dispatch.test_reject_audit',
    'flight.bulk_create',
    true
  );
  BEGIN
    WITH request_locked AS (
      SELECT id, pilot_membership_id, desired_flight_count
      FROM schedule_requests
      WHERE
        tenant_id = '30000000-0000-4000-8000-000000000003'
        AND id = '34000000-0000-4000-8000-000000000003'
        AND version = 1
        AND status = 'in_review'
      FOR UPDATE OF schedule_requests
    ), capacity AS (
      SELECT
        request_locked.id,
        request_locked.pilot_membership_id,
        request_locked.desired_flight_count,
        count(flights.id) FILTER (
          WHERE flights.status <> 'cancelled'
        )::integer AS existing_flight_count
      FROM request_locked
      LEFT JOIN flights
        ON flights.tenant_id = '30000000-0000-4000-8000-000000000003'
        AND flights.schedule_request_id = request_locked.id
      GROUP BY
        request_locked.id,
        request_locked.pilot_membership_id,
        request_locked.desired_flight_count
      HAVING
        count(flights.id) FILTER (WHERE flights.status <> 'cancelled') + 1
          <= request_locked.desired_flight_count
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
        '36000000-0000-4000-8000-000000000003',
        '30000000-0000-4000-8000-000000000003',
        capacity.id,
        capacity.pilot_membership_id,
        'SK941',
        'EKCH',
        'ESSA',
        '2026-09-11T08:30:00Z',
        '2026-09-11T10:00:00Z',
        'offered',
        1
      FROM capacity
      RETURNING id
    ), batch_checked AS (
      SELECT
        capacity.id,
        capacity.desired_flight_count,
        capacity.existing_flight_count,
        capacity.existing_flight_count + count(inserted.id)::integer
          AS cumulative_flight_count
      FROM capacity
      LEFT JOIN inserted ON TRUE
      GROUP BY
        capacity.id,
        capacity.desired_flight_count,
        capacity.existing_flight_count
      HAVING count(inserted.id) = 1
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
        schedule_requests.tenant_id = '30000000-0000-4000-8000-000000000003'
        AND schedule_requests.id = batch_checked.id
        AND schedule_requests.version = 1
        AND schedule_requests.status = 'in_review'
      RETURNING schedule_requests.id, schedule_requests.status
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
        '30000000-0000-4000-8000-000000000003'::uuid,
        '32000000-0000-4000-8000-000000000003'::uuid,
        'schedule_request.fulfillment_progress',
        'schedule_request',
        request_updated.id,
        jsonb_build_object(
          'from', 'in_review',
          'to', request_updated.status,
          'fromVersion', 1,
          'toVersion', 2
        )
      FROM request_updated
      UNION ALL
      SELECT
        '30000000-0000-4000-8000-000000000003'::uuid,
        '32000000-0000-4000-8000-000000000003'::uuid,
        'flight.bulk_create',
        'schedule_request',
        request_updated.id,
        jsonb_build_object(
          'requestFromVersion', 1,
          'requestToVersion', 2,
          'createdFlightVersion', 1
        )
      FROM request_updated
      RETURNING id
    ), audit_totals AS (
      SELECT count(*)::integer AS count FROM audited
    )
    SELECT inserted.id
    INTO affected_id
    FROM inserted
    CROSS JOIN request_updated
    CROSS JOIN audit_totals
    WHERE audit_totals.count = 2;

    RAISE EXCEPTION 'expected fulfillment audit failure was not raised';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'synthetic audit failure' THEN
      RAISE;
    END IF;
  END;

  PERFORM set_config('va_dispatch.test_reject_audit', '', true);

  IF EXISTS (
    SELECT 1 FROM flights
    WHERE id = '36000000-0000-4000-8000-000000000003'
  ) THEN
    RAISE EXCEPTION 'failed fulfillment left an inserted flight';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM schedule_requests
    WHERE id = '34000000-0000-4000-8000-000000000003'
      AND status = 'in_review'
      AND version = 1
  ) THEN
    RAISE EXCEPTION 'failed fulfillment changed the request';
  END IF;
  IF EXISTS (
    SELECT 1 FROM audit_events
    WHERE entity_id = '34000000-0000-4000-8000-000000000003'
  ) THEN
    RAISE EXCEPTION 'failed fulfillment left an audit fragment';
  END IF;
END
$test$;

ROLLBACK;
