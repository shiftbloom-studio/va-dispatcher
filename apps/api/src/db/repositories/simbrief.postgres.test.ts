import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { setDbForTests, type Db } from "../client.js";
import {
  completeSimbriefDispatchAtomic,
  createSimbriefDispatchAtomic,
  recordSimbriefSyncError,
  startSimbriefDispatchAtomic,
  type SimbriefFlightSnapshot,
} from "./simbrief.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const postgresDescribe = databaseUrl ? describe : describe.skip;
const tenantId = "20000000-0000-4000-8000-000000000001";
const otherTenantId = "20000000-0000-4000-8000-000000000099";
const dispatcherId = "10000000-0000-4000-8000-000000000001";
const pilotId = "10000000-0000-4000-8000-000000000002";
const flightId = "30000000-0000-4000-8000-000000000001";
const dispatchA = "40000000-0000-4000-8000-000000000001";
const dispatchB = "40000000-0000-4000-8000-000000000002";
const now = new Date("2026-08-12T12:00:00.000Z");

const baseSchemaSql = `
  CREATE TYPE member_role AS ENUM ('pilot', 'dispatcher', 'admin');
  CREATE TYPE member_status AS ENUM ('active', 'invited', 'disabled');
  CREATE TYPE flight_status AS ENUM (
    'draft', 'offered', 'accepted', 'declined', 'briefed', 'active',
    'completed', 'cancelled'
  );
  CREATE TYPE simbrief_dispatch_status AS ENUM ('pending', 'ready');

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
    clerk_user_id text NOT NULL,
    role member_role DEFAULT 'pilot' NOT NULL,
    display_name text,
    pilot_callsign text,
    simbrief_user_id text,
    simbrief_verified_at timestamptz,
    navigraph_subject text,
    navigraph_username text,
    navigraph_connected_at timestamptz,
    status member_status DEFAULT 'active' NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL
  );
  CREATE TABLE flights (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    schedule_request_id uuid,
    pilot_membership_id uuid REFERENCES memberships(id) ON DELETE SET NULL,
    flight_number text NOT NULL,
    dep_icao text NOT NULL,
    arr_icao text NOT NULL,
    etd timestamptz NOT NULL,
    eta timestamptz NOT NULL,
    aircraft_type text,
    status flight_status DEFAULT 'draft' NOT NULL,
    cancel_reason text,
    declined_reason text,
    dispatcher_notes text,
    out_at timestamptz,
    off_at timestamptz,
    on_at timestamptz,
    in_at timestamptz,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL
  );
  CREATE TABLE simbrief_dispatches (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    flight_id uuid NOT NULL REFERENCES flights(id) ON DELETE CASCADE,
    created_by_membership_id uuid REFERENCES memberships(id) ON DELETE SET NULL,
    simbrief_user_id text NOT NULL,
    static_id text NOT NULL UNIQUE,
    callback_token_mac text,
    status simbrief_dispatch_status DEFAULT 'pending' NOT NULL,
    request jsonb DEFAULT '{}'::jsonb NOT NULL,
    ofp jsonb,
    simbrief_request_id text,
    generated_at timestamptz,
    synced_at timestamptz,
    last_error text,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL
  );
  CREATE TABLE audit_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    actor_membership_id uuid REFERENCES memberships(id) ON DELETE SET NULL,
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    meta jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL
  );
`;

let sqlClient: Sql | undefined;
let schemaName = "";
let migratedHistoricalState: Record<string, unknown> | undefined;

function simbriefDb(client: Sql): Db {
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

function snapshot(): SimbriefFlightSnapshot {
  return {
    pilotMembershipId: pilotId,
    flightNumber: "SK935",
    depIcao: "EKCH",
    arrIcao: "KSFO",
    etd: "2026-08-13T10:05:00.000Z",
    eta: "2026-08-13T21:35:00.000Z",
    aircraftType: "A359",
  };
}

function request() {
  return {
    orig: "EKCH",
    dest: "KSFO",
    type: "A359",
    fltnum: "SK935",
    dxname: "Untrusted caller value",
    manualrmk: "Synthetic dispatcher remarks",
  };
}

function prepare(id: string, preparedAt = now) {
  return createSimbriefDispatchAtomic({
    id,
    tenantId,
    flightId,
    createdByMembershipId: dispatcherId,
    staticId: `VAD_${id.replaceAll("-", "")}`,
    request: request(),
    flightSnapshot: snapshot(),
    preparedAt,
  });
}

function start(id: string, startedAt = new Date(now.getTime() + 2_000)) {
  return startSimbriefDispatchAtomic({
    id,
    tenantId,
    flightId,
    generatedByMembershipId: pilotId,
    simbriefUserId: "123456",
    callbackTokenMac: "callback-mac",
    callbackExpiresAt: new Date(startedAt.getTime() + 2 * 60 * 60_000),
    startedAt,
  });
}

postgresDescribe("SimBrief PostgreSQL atomicity contracts", () => {
  beforeAll(async () => {
    const admin = postgres(databaseUrl!, { max: 1, onnotice: () => undefined });
    schemaName = `simbrief_contract_${process.pid}_${Date.now()}`;
    await admin.unsafe(`CREATE SCHEMA "${schemaName}"`);
    await admin.end();

    const setupClient = postgres(databaseUrl!, {
      max: 1,
      onnotice: () => undefined,
      connection: { search_path: schemaName },
    });
    await setupClient.unsafe(baseSchemaSql);
    await setupClient.unsafe(`
      INSERT INTO tenants (id, slug, name, clerk_org_id)
      VALUES ('${tenantId}', 'migration', 'Migration tenant', 'org_migration');
      INSERT INTO memberships (
        id, tenant_id, clerk_user_id, role, simbrief_user_id
      ) VALUES (
        '${pilotId}', '${tenantId}', 'migration_pilot', 'pilot', '123456'
      );
      INSERT INTO flights (
        id, tenant_id, pilot_membership_id, flight_number, dep_icao, arr_icao,
        etd, eta, aircraft_type, status
      ) VALUES (
        '${flightId}', '${tenantId}', '${pilotId}', 'SK935', 'EKCH', 'KSFO',
        '2026-08-13T10:05:00.000Z', '2026-08-13T21:35:00.000Z',
        'A359', 'accepted'
      );
      INSERT INTO simbrief_dispatches (
        id, tenant_id, flight_id, created_by_membership_id,
        simbrief_user_id, static_id, callback_token_mac, request
      ) VALUES (
        '${dispatchA}', '${tenantId}', '${flightId}', '${pilotId}',
        '123456', 'VAD_MIGRATION', 'legacy-mac', '{}'::jsonb
      );
    `);
    const deltaPath = fileURLToPath(
      new URL(
        "../../../../../docs/schema-deltas/issue-21-simbrief-workflow.sql",
        import.meta.url,
      ),
    );
    await setupClient.unsafe(readFileSync(deltaPath, "utf8"));
    const [migrationState] = await setupClient.unsafe<
      Record<string, unknown>[]
    >(`
      SELECT generated_by_membership_id, callback_token_mac, flight_snapshot,
             revision,
             (SELECT revision FROM simbrief_flight_heads
              WHERE flight_id = '${flightId}') AS head_revision
      FROM simbrief_dispatches WHERE id = '${dispatchA}'
    `);
    migratedHistoricalState = migrationState;
    await setupClient.end();

    sqlClient = postgres(databaseUrl!, {
      max: 10,
      onnotice: () => undefined,
      connection: { search_path: schemaName },
    });
    setDbForTests(simbriefDb(sqlClient));
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
      "ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS reject_simbrief_audit",
    );
    await sqlClient!.unsafe(`
      TRUNCATE simbrief_dispatches, audit_events, flights, memberships,
        tenants CASCADE
    `);
    await sqlClient!`
      INSERT INTO tenants (id, slug, name, clerk_org_id)
      VALUES
        (${tenantId}, 'vsas', 'Virtual SAS', 'org_test'),
        (${otherTenantId}, 'other', 'Other VA', 'org_other')
    `;
    await sqlClient!`
      INSERT INTO memberships (
        id, tenant_id, clerk_user_id, role, display_name, pilot_callsign,
        simbrief_user_id, status
      ) VALUES
        (${dispatcherId}, ${tenantId}, 'dispatcher', 'dispatcher',
          'Trusted Dispatcher', 'DISPATCH', NULL, 'active'),
        (${pilotId}, ${tenantId}, 'pilot', 'pilot',
          'Synthetic Pilot', 'SAS123', '123456', 'active')
    `;
    await sqlClient!`
      INSERT INTO flights (
        id, tenant_id, pilot_membership_id, flight_number, dep_icao, arr_icao,
        etd, eta, aircraft_type, status
      ) VALUES (
        ${flightId}, ${tenantId}, ${pilotId}, 'SK935', 'EKCH', 'KSFO',
        '2026-08-13T10:05:00.000Z', '2026-08-13T21:35:00.000Z',
        'A359', 'accepted'
      )
    `;
  });

  it("migrates legacy plans while invalidating callbacks with no immutable expiry", () => {
    expect(migratedHistoricalState).toMatchObject({
      generated_by_membership_id: pilotId,
      callback_token_mac: null,
      revision: 1,
      head_revision: 1,
      flight_snapshot: {
        pilotMembershipId: pilotId,
        flightNumber: "SK935",
        depIcao: "EKCH",
        arrIcao: "KSFO",
        etd: "2026-08-13T10:05:00.000Z",
        eta: "2026-08-13T21:35:00.000Z",
        aircraftType: "A359",
      },
    });
  });

  it("atomically prepares and audits a trusted dispatcher-attributed revision", async () => {
    const created = await prepare(dispatchA);

    expect(created).toMatchObject({
      id: dispatchA,
      status: "prepared",
      createdByMembershipId: dispatcherId,
      request: {
        dxname: "Trusted Dispatcher",
        manualrmk: "Synthetic dispatcher remarks",
      },
      flightSnapshot: snapshot(),
    });
    const [state] = await sqlClient!`
      SELECT
        (SELECT count(*)::int FROM audit_events
          WHERE action = 'simbrief.dispatch_prepare'
            AND actor_membership_id = ${dispatcherId}) AS audit_count,
        (SELECT meta->>'hasRemarks' FROM audit_events
          WHERE action = 'simbrief.dispatch_prepare') AS has_remarks
    `;
    expect(state).toMatchObject({ audit_count: 1, has_remarks: "true" });
  });

  it("rolls preparation back when its audit insert fails", async () => {
    await sqlClient!.unsafe(`
      ALTER TABLE audit_events ADD CONSTRAINT reject_simbrief_audit
      CHECK (action <> 'simbrief.dispatch_prepare')
    `);

    await expect(prepare(dispatchA)).rejects.toMatchObject({
      cause: { code: "23514" },
    });
    const [state] = await sqlClient!`
      SELECT
        (SELECT count(*)::int FROM simbrief_dispatches) AS dispatch_count,
        (SELECT count(*)::int FROM audit_events) AS audit_count,
        (SELECT count(*)::int FROM simbrief_flight_heads) AS head_count
    `;
    expect(state).toMatchObject({
      dispatch_count: 0,
      audit_count: 0,
      head_count: 0,
    });
  });

  it("atomically launches the newest revision with a fixed callback expiry", async () => {
    await prepare(dispatchA);
    const startedAt = new Date(now.getTime() + 2_000);
    const result = await start(dispatchA, startedAt);

    expect(result).toMatchObject({
      status: "started",
      latestId: dispatchA,
      dispatch: {
        status: "pending",
        generatedByMembershipId: pilotId,
        simbriefUserId: "123456",
        callbackExpiresAt: new Date("2026-08-12T14:00:02.000Z"),
        request: {
          dxname: "Trusted Dispatcher",
          manualrmk: "Synthetic dispatcher remarks",
          userid: "123456",
          pid: "123456",
        },
      },
    });
    const [state] = await sqlClient!`
      SELECT count(*)::int AS audit_count
      FROM audit_events WHERE action = 'simbrief.dispatch_generate'
    `;
    expect(state?.audit_count).toBe(1);
  });

  it("rolls generation back when its audit insert fails", async () => {
    await prepare(dispatchA);
    await sqlClient!.unsafe(`
      ALTER TABLE audit_events ADD CONSTRAINT reject_simbrief_audit
      CHECK (action <> 'simbrief.dispatch_generate')
    `);

    await expect(start(dispatchA)).rejects.toMatchObject({
      cause: { code: "23514" },
    });
    const [state] = await sqlClient!`
      SELECT status, generated_by_membership_id, callback_token_mac,
             callback_expires_at,
             (SELECT revision FROM simbrief_flight_heads
              WHERE flight_id = ${flightId}) AS head_revision
      FROM simbrief_dispatches WHERE id = ${dispatchA}
    `;
    expect(state).toMatchObject({
      status: "prepared",
      generated_by_membership_id: null,
      callback_token_mac: null,
      callback_expires_at: null,
      head_revision: 1,
    });
  });

  it("assigns gap-free canonical revisions to simultaneous preparations", async () => {
    const [first, second] = await Promise.all([
      prepare(dispatchA, now),
      prepare(dispatchB, now),
    ]);

    expect([first?.revision, second?.revision].sort()).toEqual([1, 2]);
    const [state] = await sqlClient!`
      SELECT
        (SELECT revision FROM simbrief_flight_heads
          WHERE flight_id = ${flightId}) AS head_revision,
        (SELECT count(*)::int FROM audit_events
          WHERE action = 'simbrief.dispatch_prepare') AS prepare_audits
    `;
    expect(state).toMatchObject({ head_revision: 2, prepare_audits: 2 });
  });

  it("rejects a direct launch of an obsolete revision", async () => {
    await prepare(dispatchA, now);
    await prepare(dispatchB, new Date(now.getTime() + 1_000));

    await expect(start(dispatchA)).resolves.toMatchObject({
      status: "superseded",
      latestId: dispatchB,
      dispatch: null,
    });
    const [state] = await sqlClient!`
      SELECT
        (SELECT status FROM simbrief_dispatches WHERE id = ${dispatchA})
          AS old_status,
        (SELECT count(*)::int FROM audit_events
          WHERE action = 'simbrief.dispatch_generate') AS generation_audits
    `;
    expect(state).toMatchObject({
      old_status: "prepared",
      generation_audits: 0,
    });
  });

  it("serializes a concurrent prepare/generate race to the newer revision", async () => {
    await prepare(dispatchA, now);
    const blocker = postgres(databaseUrl!, {
      max: 1,
      onnotice: () => undefined,
      connection: { search_path: schemaName },
    });
    let preparing: ReturnType<typeof prepare> | undefined;
    let generating: ReturnType<typeof start> | undefined;

    await blocker.begin(async (transaction) => {
      await transaction`SELECT id FROM flights WHERE id = ${flightId} FOR UPDATE`;
      preparing = prepare(dispatchB, new Date(now.getTime() + 1_000));
      await new Promise((resolve) => setTimeout(resolve, 25));
      generating = start(dispatchA);
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
    await blocker.end();

    await expect(preparing).resolves.toMatchObject({ id: dispatchB });
    await expect(generating).resolves.toMatchObject({
      status: "superseded",
      latestId: dispatchB,
      dispatch: null,
    });
  });

  it("rejects launch after a material flight edit", async () => {
    await prepare(dispatchA);
    await sqlClient!`
      UPDATE flights SET arr_icao = 'ESSA' WHERE id = ${flightId}
    `;

    await expect(start(dispatchA)).resolves.toMatchObject({
      status: "stale",
      latestId: dispatchA,
      dispatch: null,
    });
  });

  it("does not let sync failures extend the callback lifetime", async () => {
    await prepare(dispatchA);
    const started = await start(dispatchA);
    const expiry = started.dispatch?.callbackExpiresAt;

    await recordSimbriefSyncError(dispatchA, "OFP not ready yet");
    await recordSimbriefSyncError(dispatchA, "Still waiting for OFP");

    const [state] = await sqlClient!`
      SELECT callback_expires_at, updated_at, last_error
      FROM simbrief_dispatches WHERE id = ${dispatchA}
    `;
    expect(new Date(String(state?.callback_expires_at))).toEqual(expiry);
    expect(state?.last_error).toBe("Still waiting for OFP");
    expect(
      new Date(String(state?.updated_at)).getTime(),
    ).toBeGreaterThanOrEqual(now.getTime());
  });

  it("atomically stores the OFP, verifies the pilot, and audits readiness", async () => {
    await prepare(dispatchA);
    await start(dispatchA);
    const syncedAt = new Date(now.getTime() + 5_000);
    const completed = await completeSimbriefDispatchAtomic({
      id: dispatchA,
      tenantId,
      flightId,
      simbriefUserId: "123456",
      ofp: { params: { request_id: "request_123" } },
      simbriefRequestId: "request_123",
      generatedAt: new Date(now.getTime() + 4_000),
      syncedAt,
    });

    expect(completed).toMatchObject({
      status: "ready",
      callbackTokenMac: null,
      simbriefRequestId: "request_123",
    });
    const [state] = await sqlClient!`
      SELECT
        (SELECT simbrief_verified_at FROM memberships WHERE id = ${pilotId})
          AS verified_at,
        (SELECT count(*)::int FROM audit_events
          WHERE action = 'simbrief.dispatch_ready') AS ready_audits
    `;
    expect(new Date(String(state?.verified_at))).toEqual(syncedAt);
    expect(state?.ready_audits).toBe(1);
  });

  it("rolls OFP state and pilot verification back when ready audit fails", async () => {
    await prepare(dispatchA);
    await start(dispatchA);
    await sqlClient!.unsafe(`
      ALTER TABLE audit_events ADD CONSTRAINT reject_simbrief_audit
      CHECK (action <> 'simbrief.dispatch_ready')
    `);

    await expect(
      completeSimbriefDispatchAtomic({
        id: dispatchA,
        tenantId,
        flightId,
        simbriefUserId: "123456",
        ofp: { params: { request_id: "request_123" } },
        simbriefRequestId: "request_123",
        generatedAt: now,
        syncedAt: new Date(now.getTime() + 5_000),
      }),
    ).rejects.toMatchObject({ cause: { code: "23514" } });

    const [state] = await sqlClient!`
      SELECT
        (SELECT status FROM simbrief_dispatches WHERE id = ${dispatchA})
          AS dispatch_status,
        (SELECT ofp FROM simbrief_dispatches WHERE id = ${dispatchA}) AS ofp,
        (SELECT simbrief_verified_at FROM memberships WHERE id = ${pilotId})
          AS verified_at,
        (SELECT count(*)::int FROM audit_events
          WHERE action = 'simbrief.dispatch_ready') AS ready_audits
    `;
    expect(state).toMatchObject({
      dispatch_status: "pending",
      ofp: null,
      verified_at: null,
      ready_audits: 0,
    });
  });

  it("does not prepare for an inactive dispatcher or a cross-tenant flight", async () => {
    await sqlClient!`
      UPDATE memberships SET status = 'disabled' WHERE id = ${dispatcherId}
    `;
    await expect(prepare(dispatchA)).resolves.toBeNull();

    await sqlClient!`
      UPDATE memberships SET status = 'active' WHERE id = ${dispatcherId}
    `;
    await expect(
      createSimbriefDispatchAtomic({
        id: dispatchB,
        tenantId: otherTenantId,
        flightId,
        createdByMembershipId: dispatcherId,
        staticId: "VAD_CROSS_TENANT",
        request: request(),
        flightSnapshot: snapshot(),
        preparedAt: now,
      }),
    ).resolves.toBeNull();
  });
});
