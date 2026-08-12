import { drizzle } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { setDbForTests, type Db } from "../client.js";
import { findFlight, listBoardFlights } from "./flights.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const postgresDescribe = databaseUrl ? describe : describe.skip;
const tenantId = "20000000-0000-4000-8000-000000000001";
const otherTenantId = "20000000-0000-4000-8000-000000000099";
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
  CREATE TABLE tenants (
    id uuid PRIMARY KEY,
    slug text NOT NULL,
    name text NOT NULL,
    clerk_org_id text NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
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
`;

let sqlClient: Sql | undefined;
let schemaName = "";

function flightsDb(client: Sql): Db {
  const pgDb = drizzle({ client });
  return new Proxy(pgDb, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as unknown as Db;
}

function at(offsetMs: number): string {
  return new Date(now.getTime() + offsetMs).toISOString();
}

postgresDescribe("dispatch board PostgreSQL window contracts", () => {
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
    await sqlClient!.unsafe("TRUNCATE flights, tenants CASCADE");
    await sqlClient!`
      INSERT INTO tenants (id, slug, name, clerk_org_id) VALUES
        (${tenantId}, 'vsas', 'Virtual SAS', 'org_vsas'),
        (${otherTenantId}, 'other', 'Other VA', 'org_other')
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
});
