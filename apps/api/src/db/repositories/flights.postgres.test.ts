import { drizzle } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { setDbForTests, type Db } from "../client.js";
import {
  findFlight,
  fulfillScheduleRequest,
  listBoardFlights,
  updateFlightWithOperationalEvent,
} from "./flights.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const postgresDescribe = databaseUrl ? describe : describe.skip;
const tenantId = "20000000-0000-4000-8000-000000000001";
const otherTenantId = "20000000-0000-4000-8000-000000000099";
const pilotMembershipId = "40000000-0000-4000-8000-000000000001";
const dispatcherMembershipId = "40000000-0000-4000-8000-000000000002";
const scheduleRequestId = "50000000-0000-4000-8000-000000000001";
const now = new Date("2026-08-12T12:00:00.000Z");

const ids = {
  stale: "30000000-0000-4000-8000-000000000001",
  overdueBoundary: "30000000-0000-4000-8000-000000000002",
  overdue: "30000000-0000-4000-8000-000000000003",
  upcoming: "30000000-0000-4000-8000-000000000004",
  horizonBoundary: "30000000-0000-4000-8000-000000000005",
  beyondHorizon: "30000000-0000-4000-8000-000000000006",
  activeOld: "30000000-0000-4000-8000-000000000007",
  terminal: "30000000-0000-4000-8000-000000000008",
  foreign: "30000000-0000-4000-8000-000000000099",
};

const baseSchemaSql = `
  CREATE TYPE flight_status AS ENUM (
    'draft', 'offered', 'accepted', 'declined', 'briefed', 'active',
    'completed', 'cancelled'
  );
  CREATE TYPE flight_event_kind AS ENUM ('manual_start', 'manual_finish');
  CREATE TYPE flight_event_source AS ENUM ('pilot_web', 'dispatcher');
  CREATE TYPE member_role AS ENUM ('pilot', 'dispatcher', 'admin');
  CREATE TYPE member_status AS ENUM ('active', 'invited', 'disabled');
  CREATE TYPE schedule_request_status AS ENUM (
    'pending', 'in_review', 'partially_fulfilled', 'fulfilled', 'rejected',
    'cancelled'
  );
  CREATE TABLE tenants (
    id uuid PRIMARY KEY,
    slug text NOT NULL,
    name text NOT NULL,
    clerk_org_id text NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL
  );
  CREATE TABLE memberships (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    role member_role NOT NULL,
    status member_status NOT NULL
  );
  CREATE TABLE schedule_requests (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    pilot_membership_id uuid NOT NULL REFERENCES memberships(id),
    desired_flight_count integer NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    status schedule_request_status NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL
  );
  CREATE TABLE flights (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    schedule_request_id uuid,
    replaces_flight_id uuid,
    pilot_membership_id uuid,
    flight_number text NOT NULL,
    dep_icao text NOT NULL,
    arr_icao text NOT NULL,
    etd timestamptz NOT NULL,
    eta timestamptz NOT NULL,
    aircraft_type text,
    version integer DEFAULT 1 NOT NULL,
    status flight_status DEFAULT 'draft' NOT NULL,
    cancel_reason text,
    declined_reason text,
    dispatcher_notes text,
    assignment_revision integer DEFAULT 1 NOT NULL,
    assignment_confirmed_revision integer,
    assignment_confirmed_at timestamptz,
    out_at timestamptz,
    off_at timestamptz,
    on_at timestamptz,
    in_at timestamptz,
    out_manual_override boolean DEFAULT false NOT NULL,
    off_manual_override boolean DEFAULT false NOT NULL,
    on_manual_override boolean DEFAULT false NOT NULL,
    in_manual_override boolean DEFAULT false NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL
  );
  CREATE TABLE audit_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    actor_membership_id uuid,
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    meta jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL
  );
  CREATE TABLE flight_operational_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    flight_id uuid NOT NULL REFERENCES flights(id) ON DELETE CASCADE,
    kind flight_event_kind NOT NULL,
    source flight_event_source NOT NULL,
    occurred_at timestamptz NOT NULL,
    actor_membership_id uuid,
    acars_message_id uuid,
    meta jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL
  );
  CREATE TABLE schedule_fulfillment_attempts (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    schedule_request_id uuid NOT NULL REFERENCES schedule_requests(id),
    idempotency_key text NOT NULL,
    payload_hash text NOT NULL,
    flight_ids uuid[] NOT NULL,
    request_status schedule_request_status NOT NULL,
    request_version integer NOT NULL,
    linked_flight_count integer NOT NULL,
    remaining_flight_count integer NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    UNIQUE (tenant_id, schedule_request_id, idempotency_key)
  );
`;

let sqlClient: Sql | undefined;
let schemaName = "";

function flightsDb(client: Sql): Db {
  const pgDb = drizzle({ client });
  return new Proxy(pgDb, {
    get(target, property, receiver) {
      if (property === "execute") {
        return async (query: Parameters<typeof pgDb.execute>[0]) => {
          const rows = await pgDb.execute(query);
          return { rows: Array.from(rows) };
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as unknown as Db;
}

function at(offsetMs: number): string {
  return new Date(now.getTime() + offsetMs).toISOString();
}

postgresDescribe("flight repository PostgreSQL contracts", () => {
  beforeAll(async () => {
    const admin = postgres(databaseUrl!, { max: 1, onnotice: () => undefined });
    schemaName = `dispatch_board_contract_${process.pid}_${Date.now()}`;
    await admin.unsafe(`CREATE SCHEMA "${schemaName}"`);
    await admin.end();

    sqlClient = postgres(databaseUrl!, {
      max: 3,
      onnotice: () => undefined,
      connection: { search_path: schemaName },
    });
    await sqlClient.unsafe(baseSchemaSql);
    setDbForTests(flightsDb(sqlClient));
  }, 30_000);

  afterAll(async () => {
    setDbForTests(null);
    await sqlClient?.end();
    if (databaseUrl && schemaName) {
      const admin = postgres(databaseUrl, {
        max: 1,
        onnotice: () => undefined,
      });
      await admin.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      await admin.end();
    }
  }, 30_000);

  beforeEach(async () => {
    await sqlClient!.unsafe(
      "TRUNCATE schedule_fulfillment_attempts, flight_operational_events, audit_events, flights, schedule_requests, memberships, tenants CASCADE",
    );
    await sqlClient!`
      INSERT INTO tenants (id, slug, name, clerk_org_id) VALUES
        (${tenantId}, 'vsas', 'Virtual SAS', 'org_vsas'),
        (${otherTenantId}, 'other', 'Other VA', 'org_other')
    `;
    await sqlClient!`
      INSERT INTO memberships (id, tenant_id, role, status) VALUES
        (${pilotMembershipId}, ${tenantId}, 'pilot', 'active'),
        (${dispatcherMembershipId}, ${tenantId}, 'dispatcher', 'active')
    `;
    await sqlClient!`
      INSERT INTO schedule_requests (
        id, tenant_id, pilot_membership_id, desired_flight_count, version, status
      ) VALUES (
        ${scheduleRequestId}, ${tenantId}, ${pilotMembershipId}, 2, 1,
        'in_review'
      )
    `;
    await sqlClient!`
      INSERT INTO flights (
        id, tenant_id, flight_number, dep_icao, arr_icao, etd, eta, status
      ) VALUES
        (${ids.stale}, ${tenantId}, 'SK001', 'EKCH', 'ENGM',
          ${at(-24 * 60 * 60_000 - 1)}, ${at(-22 * 60 * 60_000)},
          'accepted'),
        (${ids.overdueBoundary}, ${tenantId}, 'SK002', 'EKCH', 'ENGM',
          ${at(-24 * 60 * 60_000)}, ${at(-22 * 60 * 60_000)}, 'accepted'),
        (${ids.overdue}, ${tenantId}, 'SK003', 'EKCH', 'ENGM',
          ${at(-60 * 60_000)}, ${at(20 * 60_000)}, 'briefed'),
        (${ids.upcoming}, ${tenantId}, 'SK004', 'EKCH', 'ENGM',
          ${at(24 * 60 * 60_000)}, ${at(26 * 60 * 60_000)}, 'accepted'),
        (${ids.horizonBoundary}, ${tenantId}, 'SK005', 'EKCH', 'ENGM',
          ${at(7 * 24 * 60 * 60_000)},
          ${at(7 * 24 * 60 * 60_000 + 60 * 60_000)},
          'accepted'),
        (${ids.beyondHorizon}, ${tenantId}, 'SK006', 'EKCH', 'ENGM',
          ${at(7 * 24 * 60 * 60_000 + 1)},
          ${at(7 * 24 * 60 * 60_000 + 60 * 60_000)},
          'briefed'),
        (${ids.activeOld}, ${tenantId}, 'SK007', 'EKCH', 'ENGM',
          ${at(-30 * 24 * 60 * 60_000)},
          ${at(-30 * 24 * 60 * 60_000 + 60 * 60_000)},
          'active'),
        (${ids.terminal}, ${tenantId}, 'SK008', 'EKCH', 'ENGM',
          ${at(-30 * 60_000)}, ${at(30 * 60_000)}, 'completed'),
        (${ids.foreign}, ${otherTenantId}, 'OT001', 'EKCH', 'ENGM',
          ${at(60 * 60_000)}, ${at(2 * 60 * 60_000)}, 'accepted')
    `;
  });

  it("includes exact window boundaries, active flights, and current-month completions while excluding stale, future, and foreign rows", async () => {
    const rows = await listBoardFlights(tenantId, now);

    expect(rows.map((row) => row.id)).toEqual([
      ids.activeOld,
      ids.overdueBoundary,
      ids.overdue,
      ids.terminal,
      ids.upcoming,
      ids.horizonBoundary,
    ]);
  });

  it("keeps an old record directly accessible after it leaves the live board", async () => {
    const board = await listBoardFlights(tenantId, now);
    expect(board.some((row) => row.id === ids.stale)).toBe(false);

    await expect(findFlight(tenantId, ids.stale)).resolves.toMatchObject({
      id: ids.stale,
      tenantId,
      status: "accepted",
    });
    await expect(findFlight(otherTenantId, ids.stale)).resolves.toBeNull();
  });

  it("partially fulfills a request with exact timestamptz values atomically", async () => {
    const etd = new Date("2026-09-10T08:30:00.000Z");
    const eta = new Date("2026-09-10T10:00:00.000Z");

    const result = await fulfillScheduleRequest({
      tenantId,
      scheduleRequestId,
      idempotencyKey: "partial-batch-001",
      payloadHash: "a".repeat(64),
      expectedRequestVersion: 1,
      expectedRequestStatus: "in_review",
      actorMembershipId: dispatcherMembershipId,
      flights: [
        {
          flightNumber: "SK901",
          depIcao: "EKCH",
          arrIcao: "ENGM",
          etd,
          eta,
          aircraftType: "A320",
        },
      ],
    });

    expect(result).toMatchObject({
      flights: [
        {
          scheduleRequestId,
          pilotMembershipId,
          flightNumber: "SK901",
          status: "offered",
        },
      ],
      fulfillment: {
        scheduleRequestId,
        requestStatus: "partially_fulfilled",
        requestVersion: 2,
        linkedFlightCount: 1,
        remainingFlightCount: 1,
      },
    });
    expect(result?.flights[0]?.etd.toISOString()).toBe(etd.toISOString());
    expect(result?.flights[0]?.eta.toISOString()).toBe(eta.toISOString());

    const [stored] = await sqlClient!<
      Array<{
        status: string;
        version: number;
        attempt_count: number;
        audit_count: number;
      }>
    >`
      SELECT
        request.status,
        request.version,
        (SELECT count(*)::integer FROM schedule_fulfillment_attempts
          WHERE schedule_request_id = ${scheduleRequestId}) AS attempt_count,
        (SELECT count(*)::integer FROM audit_events
          WHERE entity_id = ${scheduleRequestId}) AS audit_count
      FROM schedule_requests request
      WHERE request.id = ${scheduleRequestId}
    `;
    expect(stored).toEqual({
      status: "partially_fulfilled",
      version: 2,
      attempt_count: 1,
      audit_count: 2,
    });
  });

  it("allows exactly one concurrent manual start for one expected version", async () => {
    const occurredAt = new Date("2026-08-12T12:05:00.000Z");
    const command = () =>
      updateFlightWithOperationalEvent({
        tenantId,
        id: ids.overdue,
        expectedVersion: 1,
        actorMembershipId: dispatcherMembershipId,
        action: "flight.progress",
        auditMeta: {
          kind: "manual_start",
          fromVersion: 1,
          toVersion: 2,
        },
        patch: { status: "active", outAt: occurredAt },
        event: {
          kind: "manual_start",
          source: "dispatcher",
          occurredAt,
        },
      });

    const results = await Promise.all([command(), command()]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.filter((result) => result === null)).toHaveLength(1);

    const [flight] = await sqlClient!<
      Array<{ status: string; version: number; out_at: string }>
    >`
      SELECT status, version, out_at
      FROM flights
      WHERE tenant_id = ${tenantId} AND id = ${ids.overdue}
    `;
    expect(flight).toMatchObject({ status: "active", version: 2 });
    expect(new Date(flight!.out_at).toISOString()).toBe(
      occurredAt.toISOString(),
    );

    const [counts] = await sqlClient!<
      Array<{ audit_count: number; event_count: number }>
    >`
      SELECT
        (SELECT count(*)::integer FROM audit_events
          WHERE entity_id = ${ids.overdue}) AS audit_count,
        (SELECT count(*)::integer FROM flight_operational_events
          WHERE flight_id = ${ids.overdue}) AS event_count
    `;
    expect(counts).toEqual({ audit_count: 1, event_count: 1 });
  });

  it("rolls back manual finish state and audit when event insertion fails", async () => {
    await sqlClient!.unsafe(`
      CREATE FUNCTION reject_manual_progress_event() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'synthetic manual event failure';
      END;
      $$;
      CREATE TRIGGER reject_manual_progress_event
      BEFORE INSERT ON flight_operational_events
      FOR EACH ROW EXECUTE FUNCTION reject_manual_progress_event();
    `);

    try {
      await expect(
        updateFlightWithOperationalEvent({
          tenantId,
          id: ids.activeOld,
          expectedVersion: 1,
          actorMembershipId: dispatcherMembershipId,
          action: "flight.progress",
          auditMeta: {
            kind: "manual_finish",
            fromVersion: 1,
            toVersion: 2,
          },
          patch: {
            status: "completed",
            inAt: new Date("2026-08-12T12:10:00.000Z"),
          },
          event: {
            kind: "manual_finish",
            source: "dispatcher",
            occurredAt: new Date("2026-08-12T12:10:00.000Z"),
          },
        }),
      ).rejects.toThrow();
    } finally {
      await sqlClient!.unsafe(`
        DROP TRIGGER IF EXISTS reject_manual_progress_event
          ON flight_operational_events;
        DROP FUNCTION IF EXISTS reject_manual_progress_event();
      `);
    }

    const [flight] = await sqlClient!<
      Array<{ status: string; version: number; in_at: Date | null }>
    >`
      SELECT status, version, in_at
      FROM flights
      WHERE tenant_id = ${tenantId} AND id = ${ids.activeOld}
    `;
    expect(flight).toEqual({ status: "active", version: 1, in_at: null });

    const [counts] = await sqlClient!<
      Array<{ audit_count: number; event_count: number }>
    >`
      SELECT
        (SELECT count(*)::integer FROM audit_events
          WHERE entity_id = ${ids.activeOld}) AS audit_count,
        (SELECT count(*)::integer FROM flight_operational_events
          WHERE flight_id = ${ids.activeOld}) AS event_count
    `;
    expect(counts).toEqual({ audit_count: 0, event_count: 0 });
  });
});
