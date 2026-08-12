-- Real PostgreSQL contract test for issue #20. It proves that the flight seek
-- predicate uses the complete `(etd DESC, id DESC)` ordering tuple while all
-- tenant, ownership, status, schedule-request, and time filters remain active.
--
-- Run only against a disposable PostgreSQL 17+ database after applying the
-- current schema:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f drizzle-tests/flight-pagination.sql

BEGIN;

INSERT INTO tenants (id, slug, name, clerk_org_id)
VALUES
  (
    '50000000-0000-4000-8000-000000000005',
    'pagination-a',
    'Pagination A',
    'org_pagination_a'
  ),
  (
    '60000000-0000-4000-8000-000000000006',
    'pagination-b',
    'Pagination B',
    'org_pagination_b'
  );

INSERT INTO memberships (id, tenant_id, clerk_user_id, role, status)
VALUES
  (
    '51000000-0000-4000-8000-000000000005',
    '50000000-0000-4000-8000-000000000005',
    'user_pagination_a_primary',
    'pilot',
    'active'
  ),
  (
    '52000000-0000-4000-8000-000000000005',
    '50000000-0000-4000-8000-000000000005',
    'user_pagination_a_other',
    'pilot',
    'active'
  ),
  (
    '61000000-0000-4000-8000-000000000006',
    '60000000-0000-4000-8000-000000000006',
    'user_pagination_b',
    'pilot',
    'active'
  );

INSERT INTO schedule_requests (
  id,
  tenant_id,
  pilot_membership_id,
  window_start,
  window_end,
  desired_flight_count,
  status
)
VALUES
  (
    '53000000-0000-4000-8000-000000000005',
    '50000000-0000-4000-8000-000000000005',
    '51000000-0000-4000-8000-000000000005',
    '2026-09-20T00:00:00Z',
    '2026-09-21T00:00:00Z',
    20,
    'in_review'
  ),
  (
    '54000000-0000-4000-8000-000000000005',
    '50000000-0000-4000-8000-000000000005',
    '52000000-0000-4000-8000-000000000005',
    '2026-09-20T00:00:00Z',
    '2026-09-21T00:00:00Z',
    20,
    'in_review'
  ),
  (
    '63000000-0000-4000-8000-000000000006',
    '60000000-0000-4000-8000-000000000006',
    '61000000-0000-4000-8000-000000000006',
    '2026-09-20T00:00:00Z',
    '2026-09-21T00:00:00Z',
    20,
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
  version,
  created_at,
  updated_at
)
VALUES
  -- Five matching rows. Their creation order deliberately disagrees with ETD
  -- order, and three share one ETD across a page boundary.
  (
    '53100000-0000-4000-8000-000000000005',
    '50000000-0000-4000-8000-000000000005',
    '53000000-0000-4000-8000-000000000005',
    '51000000-0000-4000-8000-000000000005',
    'SK501', 'EKCH', 'ENGM',
    '2026-09-20T14:00:00Z', '2026-09-20T15:00:00Z',
    'offered', 1,
    '2026-09-20T08:00:00Z', '2026-09-20T08:00:00Z'
  ),
  (
    '53200000-0000-4000-8000-000000000005',
    '50000000-0000-4000-8000-000000000005',
    '53000000-0000-4000-8000-000000000005',
    '51000000-0000-4000-8000-000000000005',
    'SK502', 'EKCH', 'ENGM',
    '2026-09-20T12:00:00Z', '2026-09-20T13:00:00Z',
    'accepted', 1,
    '2026-09-20T12:00:00Z', '2026-09-20T12:00:00Z'
  ),
  (
    '53300000-0000-4000-8000-000000000005',
    '50000000-0000-4000-8000-000000000005',
    '53000000-0000-4000-8000-000000000005',
    '51000000-0000-4000-8000-000000000005',
    'SK503', 'EKCH', 'ENGM',
    '2026-09-20T12:00:00Z', '2026-09-20T13:10:00Z',
    'offered', 1,
    '2026-09-20T11:00:00Z', '2026-09-20T11:00:00Z'
  ),
  (
    '53400000-0000-4000-8000-000000000005',
    '50000000-0000-4000-8000-000000000005',
    '53000000-0000-4000-8000-000000000005',
    '51000000-0000-4000-8000-000000000005',
    'SK504', 'EKCH', 'ENGM',
    '2026-09-20T12:00:00Z', '2026-09-20T13:20:00Z',
    'accepted', 1,
    '2026-09-20T10:00:00Z', '2026-09-20T10:00:00Z'
  ),
  (
    '53500000-0000-4000-8000-000000000005',
    '50000000-0000-4000-8000-000000000005',
    '53000000-0000-4000-8000-000000000005',
    '51000000-0000-4000-8000-000000000005',
    'SK505', 'EKCH', 'ENGM',
    '2026-09-20T10:00:00Z', '2026-09-20T11:00:00Z',
    'offered', 1,
    '2026-09-20T15:00:00Z', '2026-09-20T15:00:00Z'
  ),
  -- Filter distractors: status, upper/lower time bounds, pilot, request, tenant.
  (
    '53600000-0000-4000-8000-000000000005',
    '50000000-0000-4000-8000-000000000005',
    '53000000-0000-4000-8000-000000000005',
    '51000000-0000-4000-8000-000000000005',
    'SK506', 'EKCH', 'ENGM',
    '2026-09-20T13:00:00Z', '2026-09-20T14:00:00Z',
    'cancelled', 2,
    '2026-09-20T09:00:00Z', '2026-09-20T09:00:00Z'
  ),
  (
    '53700000-0000-4000-8000-000000000005',
    '50000000-0000-4000-8000-000000000005',
    '53000000-0000-4000-8000-000000000005',
    '51000000-0000-4000-8000-000000000005',
    'SK507', 'EKCH', 'ENGM',
    '2026-09-20T15:00:00Z', '2026-09-20T16:00:00Z',
    'offered', 1,
    '2026-09-20T09:05:00Z', '2026-09-20T09:05:00Z'
  ),
  (
    '53800000-0000-4000-8000-000000000005',
    '50000000-0000-4000-8000-000000000005',
    '53000000-0000-4000-8000-000000000005',
    '51000000-0000-4000-8000-000000000005',
    'SK508', 'EKCH', 'ENGM',
    '2026-09-20T09:00:00Z', '2026-09-20T09:45:00Z',
    'offered', 1,
    '2026-09-20T09:10:00Z', '2026-09-20T09:10:00Z'
  ),
  (
    '53900000-0000-4000-8000-000000000005',
    '50000000-0000-4000-8000-000000000005',
    '53000000-0000-4000-8000-000000000005',
    '52000000-0000-4000-8000-000000000005',
    'SK509', 'EKCH', 'ENGM',
    '2026-09-20T13:00:00Z', '2026-09-20T14:00:00Z',
    'offered', 1,
    '2026-09-20T09:15:00Z', '2026-09-20T09:15:00Z'
  ),
  (
    '54100000-0000-4000-8000-000000000005',
    '50000000-0000-4000-8000-000000000005',
    '54000000-0000-4000-8000-000000000005',
    '51000000-0000-4000-8000-000000000005',
    'SK510', 'EKCH', 'ENGM',
    '2026-09-20T13:00:00Z', '2026-09-20T14:00:00Z',
    'accepted', 1,
    '2026-09-20T09:20:00Z', '2026-09-20T09:20:00Z'
  ),
  (
    '63100000-0000-4000-8000-000000000006',
    '60000000-0000-4000-8000-000000000006',
    '63000000-0000-4000-8000-000000000006',
    '61000000-0000-4000-8000-000000000006',
    'SK601', 'EKCH', 'ENGM',
    '2026-09-20T16:00:00Z', '2026-09-20T17:00:00Z',
    'offered', 1,
    '2026-09-20T16:00:00Z', '2026-09-20T16:00:00Z'
  );

CREATE FUNCTION pg_temp.filtered_flight_page(
  p_cursor_etd timestamptz,
  p_cursor_id uuid,
  p_apply_detail_filters boolean
)
RETURNS TABLE (id uuid, etd timestamptz)
LANGUAGE sql
AS $function$
  SELECT flights.id, flights.etd
  FROM flights
  WHERE
    flights.tenant_id = '50000000-0000-4000-8000-000000000005'
    AND (
      NOT p_apply_detail_filters
      OR (
        flights.pilot_membership_id =
          '51000000-0000-4000-8000-000000000005'
        AND flights.status = ANY (
          ARRAY['offered', 'accepted']::flight_status[]
        )
        AND flights.etd >= '2026-09-20T10:00:00Z'
        AND flights.etd <= '2026-09-20T14:00:00Z'
        AND flights.schedule_request_id =
          '53000000-0000-4000-8000-000000000005'
      )
    )
    AND (
      p_cursor_etd IS NULL
      OR flights.etd < p_cursor_etd
      OR (flights.etd = p_cursor_etd AND flights.id < p_cursor_id)
    )
  ORDER BY flights.etd DESC, flights.id DESC
  LIMIT 2
$function$;

CREATE TEMP TABLE pagination_seen (
  position bigserial PRIMARY KEY,
  id uuid NOT NULL,
  etd timestamptz NOT NULL
);

CREATE TEMP TABLE pagination_page (
  id uuid NOT NULL,
  etd timestamptz NOT NULL
);

DO $test$
DECLARE
  cursor_etd timestamptz := NULL;
  cursor_id uuid := NULL;
  fetched integer;
  actual_ids uuid[];
  expected_ids uuid[];
  created_ids uuid[];
BEGIN
  LOOP
    TRUNCATE pagination_page;
    INSERT INTO pagination_page
    SELECT *
    FROM pg_temp.filtered_flight_page(cursor_etd, cursor_id, true);
    GET DIAGNOSTICS fetched = ROW_COUNT;
    EXIT WHEN fetched = 0;

    INSERT INTO pagination_seen (id, etd)
    SELECT id, etd
    FROM pagination_page
    ORDER BY etd DESC, id DESC;

    SELECT etd, id
    INTO cursor_etd, cursor_id
    FROM pagination_page
    ORDER BY etd ASC, id ASC
    LIMIT 1;

    EXIT WHEN fetched < 2;
  END LOOP;

  SELECT array_agg(id ORDER BY position)
  INTO actual_ids
  FROM pagination_seen;

  SELECT
    array_agg(id ORDER BY etd DESC, id DESC),
    array_agg(id ORDER BY created_at DESC, id DESC)
  INTO expected_ids, created_ids
  FROM flights
  WHERE
    tenant_id = '50000000-0000-4000-8000-000000000005'
    AND pilot_membership_id = '51000000-0000-4000-8000-000000000005'
    AND status = ANY (ARRAY['offered', 'accepted']::flight_status[])
    AND etd >= '2026-09-20T10:00:00Z'
    AND etd <= '2026-09-20T14:00:00Z'
    AND schedule_request_id = '53000000-0000-4000-8000-000000000005';

  IF expected_ids = created_ids THEN
    RAISE EXCEPTION 'test fixture did not disagree on creation and ETD order';
  END IF;
  IF actual_ids IS DISTINCT FROM expected_ids THEN
    RAISE EXCEPTION 'cursor pages skipped, repeated, or reordered flights';
  END IF;
  IF (
    SELECT count(*) FROM pagination_seen
  ) <> 5 OR (
    SELECT count(DISTINCT id) FROM pagination_seen
  ) <> 5 THEN
    RAISE EXCEPTION 'filtered pagination did not return every row exactly once';
  END IF;
  IF (
    SELECT count(DISTINCT ((position - 1) / 2))
    FROM pagination_seen
    WHERE etd = '2026-09-20T12:00:00Z'
  ) < 2 THEN
    RAISE EXCEPTION 'same-ETD fixture did not cross a page boundary';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pagination_seen
    WHERE id IN (
      '53600000-0000-4000-8000-000000000005',
      '53700000-0000-4000-8000-000000000005',
      '53800000-0000-4000-8000-000000000005',
      '53900000-0000-4000-8000-000000000005',
      '54100000-0000-4000-8000-000000000005',
      '63100000-0000-4000-8000-000000000006'
    )
  ) THEN
    RAISE EXCEPTION 'an active tenant or list filter was lost after page one';
  END IF;

  -- Repeat without optional filters. This makes tenant isolation independently
  -- observable rather than relying on globally unique pilot/request IDs.
  TRUNCATE pagination_seen RESTART IDENTITY;
  cursor_etd := NULL;
  cursor_id := NULL;
  LOOP
    TRUNCATE pagination_page;
    INSERT INTO pagination_page
    SELECT *
    FROM pg_temp.filtered_flight_page(cursor_etd, cursor_id, false);
    GET DIAGNOSTICS fetched = ROW_COUNT;
    EXIT WHEN fetched = 0;

    INSERT INTO pagination_seen (id, etd)
    SELECT id, etd
    FROM pagination_page
    ORDER BY etd DESC, id DESC;

    SELECT etd, id
    INTO cursor_etd, cursor_id
    FROM pagination_page
    ORDER BY etd ASC, id ASC
    LIMIT 1;

    EXIT WHEN fetched < 2;
  END LOOP;

  SELECT array_agg(id ORDER BY position)
  INTO actual_ids
  FROM pagination_seen;
  SELECT array_agg(id ORDER BY etd DESC, id DESC)
  INTO expected_ids
  FROM flights
  WHERE tenant_id = '50000000-0000-4000-8000-000000000005';

  IF actual_ids IS DISTINCT FROM expected_ids OR EXISTS (
    SELECT 1
    FROM pagination_seen
    WHERE id = '63100000-0000-4000-8000-000000000006'
  ) THEN
    RAISE EXCEPTION 'tenant isolation was not preserved across pages';
  END IF;
END
$test$;

ROLLBACK;
