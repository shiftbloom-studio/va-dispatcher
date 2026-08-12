INSERT INTO tenants (id, slug, name, clerk_org_id)
VALUES (
  '31000000-0000-4000-8000-000000000001',
  'upgrade-pr29',
  'Upgrade PR29',
  'org_upgrade_pr29'
);

INSERT INTO memberships (
  id, tenant_id, clerk_user_id, role, status, simbrief_user_id
)
VALUES (
  '31000000-0000-4000-8000-000000000011',
  '31000000-0000-4000-8000-000000000001',
  'user_upgrade_pilot',
  'pilot',
  'active',
  '123456'
);

INSERT INTO flights (
  id, tenant_id, pilot_membership_id, flight_number, dep_icao, arr_icao,
  etd, eta, aircraft_type, status
)
VALUES (
  '31000000-0000-4000-8000-000000000021',
  '31000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000011',
  'SK901',
  'EKCH',
  'ENGM',
  '2026-08-13T10:00:00Z',
  '2026-08-13T11:10:00Z',
  'A320',
  'briefed'
);

INSERT INTO dispatch_releases (
  id, tenant_id, flight_id, revision, operational_route, cruise_level,
  alternate_icao, fuel_unit, payload_unit, taxi_fuel, trip_fuel,
  contingency_fuel, alternate_fuel, final_reserve_fuel, additional_fuel,
  block_fuel, planned_payload
)
VALUES (
  '31000000-0000-4000-8000-000000000031',
  '31000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000021',
  1,
  'NEXEN DCT',
  350,
  'ESGG',
  'kg',
  'kg',
  200,
  2000,
  100,
  300,
  400,
  0,
  3000,
  12000
);

INSERT INTO simbrief_dispatches (
  id, tenant_id, flight_id, created_by_membership_id, simbrief_user_id,
  static_id, callback_token_mac, status, request, created_at
)
VALUES
  (
    '31000000-0000-4000-8000-000000000041',
    '31000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000021',
    '31000000-0000-4000-8000-000000000011',
    '123456',
    'upgrade-one',
    'legacy-token',
    'pending',
    '{}',
    '2026-08-12T10:00:00Z'
  ),
  (
    '31000000-0000-4000-8000-000000000042',
    '31000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000021',
    '31000000-0000-4000-8000-000000000011',
    '123456',
    'upgrade-two',
    NULL,
    'ready',
    '{}',
    '2026-08-12T11:00:00Z'
  );

INSERT INTO acars_messages (
  id, tenant_id, direction, msg_type, from_station, to_station, body,
  provider, sent_at
)
VALUES (
  '31000000-0000-4000-8000-000000000051',
  '31000000-0000-4000-8000-000000000001',
  'outbound',
  'telex',
  'UPGRADE',
  'SK901',
  'LEGACY MESSAGE',
  'hoppie',
  '2026-08-12T11:30:00Z'
);
