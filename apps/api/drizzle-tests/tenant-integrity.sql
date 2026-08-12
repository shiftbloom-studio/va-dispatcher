-- PostgreSQL negative integration test for the composite tenant references.
-- Run against a disposable database after applying the schema, for example:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle-tests/tenant-integrity.sql

BEGIN;

INSERT INTO tenants (id, slug, name, clerk_org_id)
VALUES
  ('10000000-0000-4000-8000-000000000001', 'test-one', 'Test One', 'org_test_one'),
  ('20000000-0000-4000-8000-000000000002', 'test-two', 'Test Two', 'org_test_two');

INSERT INTO memberships (id, tenant_id, clerk_user_id, role, status)
VALUES
  ('11000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'user_one', 'pilot', 'active'),
  ('12000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'user_nullable', 'pilot', 'active'),
  ('21000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'user_two', 'pilot', 'active');

DO $test$
BEGIN
  BEGIN
    INSERT INTO schedule_requests (
      id,
      tenant_id,
      pilot_membership_id,
      window_start,
      window_end,
      desired_flight_count
    ) VALUES (
      '13000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      '21000000-0000-4000-8000-000000000002',
      '2026-09-10T08:00:00Z',
      '2026-09-10T12:00:00Z',
      1
    );
    RAISE EXCEPTION 'cross-tenant schedule request owner was accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;
END
$test$;

INSERT INTO schedule_requests (
  id,
  tenant_id,
  pilot_membership_id,
  window_start,
  window_end,
  desired_flight_count
) VALUES (
  '13000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001',
  '2026-09-10T08:00:00Z',
  '2026-09-10T12:00:00Z',
  1
);

INSERT INTO schedule_requests (
  id,
  tenant_id,
  pilot_membership_id,
  window_start,
  window_end,
  desired_flight_count
) VALUES (
  '23000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000002',
  '21000000-0000-4000-8000-000000000002',
  '2026-09-10T08:00:00Z',
  '2026-09-10T12:00:00Z',
  1
);

DO $test$
BEGIN
  BEGIN
    INSERT INTO flights (
      id,
      tenant_id,
      pilot_membership_id,
      flight_number,
      dep_icao,
      arr_icao,
      etd,
      eta
    ) VALUES (
      '14000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      '21000000-0000-4000-8000-000000000002',
      'SK901',
      'EKCH',
      'ENGM',
      '2026-09-10T08:00:00Z',
      '2026-09-10T09:30:00Z'
    );
    RAISE EXCEPTION 'cross-tenant flight pilot was accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO flights (
      id,
      tenant_id,
      schedule_request_id,
      flight_number,
      dep_icao,
      arr_icao,
      etd,
      eta
    ) VALUES (
      '15000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      '23000000-0000-4000-8000-000000000002',
      'SK902',
      'EKCH',
      'ENGM',
      '2026-09-10T10:00:00Z',
      '2026-09-10T11:30:00Z'
    );
    RAISE EXCEPTION 'cross-tenant flight request was accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;
END
$test$;

-- The original single-column ON DELETE actions still work alongside the
-- tenant-pair constraints: nullable links are cleared, never cross-linked.
INSERT INTO flights (
  id,
  tenant_id,
  schedule_request_id,
  pilot_membership_id,
  flight_number,
  dep_icao,
  arr_icao,
  etd,
  eta
) VALUES (
  '16000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '13000000-0000-4000-8000-000000000001',
  '12000000-0000-4000-8000-000000000001',
  'SK903',
  'EKCH',
  'ENGM',
  '2026-09-10T12:00:00Z',
  '2026-09-10T13:30:00Z'
);

DELETE FROM memberships
WHERE id = '12000000-0000-4000-8000-000000000001';

DO $test$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM flights
    WHERE id = '16000000-0000-4000-8000-000000000001'
      AND pilot_membership_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'flight pilot ON DELETE SET NULL behavior regressed';
  END IF;
END
$test$;

DELETE FROM schedule_requests
WHERE id = '13000000-0000-4000-8000-000000000001';

DO $test$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM flights
    WHERE id = '16000000-0000-4000-8000-000000000001'
      AND schedule_request_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'flight request ON DELETE SET NULL behavior regressed';
  END IF;
END
$test$;

ROLLBACK;
