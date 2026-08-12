DO $$
DECLARE
  missing text[] := ARRAY[]::text[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'tenants') THEN
    missing := array_append(missing, 'tenants');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'memberships') THEN
    missing := array_append(missing, 'memberships');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'schedule_requests') THEN
    missing := array_append(missing, 'schedule_requests');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'flights') THEN
    missing := array_append(missing, 'flights');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'acars_messages') THEN
    missing := array_append(missing, 'acars_messages');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'audit_events') THEN
    missing := array_append(missing, 'audit_events');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'mock_acars_queue') THEN
    missing := array_append(missing, 'mock_acars_queue');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'navigraph_oauth_transactions') THEN
    missing := array_append(missing, 'navigraph_oauth_transactions');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'simbrief_dispatches') THEN
    missing := array_append(missing, 'simbrief_dispatches');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'dispatch_releases') THEN
    missing := array_append(missing, 'dispatch_releases');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'flight_operational_events') THEN
    missing := array_append(missing, 'flight_operational_events');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'simulator_devices') THEN
    missing := array_append(missing, 'simulator_devices');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'flight_telemetry_current') THEN
    missing := array_append(missing, 'flight_telemetry_current');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'privacy_subject_requests') THEN
    missing := array_append(missing, 'privacy_subject_requests');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'schedule_fulfillment_attempts') THEN
    missing := array_append(missing, 'schedule_fulfillment_attempts');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'memberships' AND column_name = 'navigraph_subject'
  ) THEN
    missing := array_append(missing, 'memberships.navigraph_subject');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM drizzle.__drizzle_migrations
    WHERE name = '20260812151552_pr29_baseline'
      AND hash = 'ca3807e188962556a39284c8d69aa1c9e0db5a6e283fe53d0845f9ae782fd142'
      AND created_at = 1786547752000
  ) THEN
    missing := array_append(missing, 'exact drizzle baseline ledger record');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM drizzle.__drizzle_migrations
    WHERE name = '20260812174040_dispatch_operations'
      AND hash = '2f832f8c67d532017435efe3de4d6d06bbc7f904b1660e06ad4e00a568e8d4e1'
      AND created_at = 1786556440000
  ) THEN
    missing := array_append(missing, 'exact dispatch operations ledger record');
  END IF;

  IF cardinality(missing) > 0 THEN
    RAISE EXCEPTION 'schema verification failed; missing %', array_to_string(missing, ', ');
  END IF;
END $$;
