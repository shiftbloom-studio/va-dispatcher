import { drizzle } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { setDbForTests, type Db } from "../client.js";
import { publishDispatchReleaseAtomic } from "./dispatch-releases.js";
import {
  completeSimbriefDispatchAtomic,
  createSimbriefDispatchAtomic,
  recordSimbriefSyncError,
  startSimbriefDispatchAtomic,
  type SimbriefFlightSnapshot,
} from "./simbrief.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const confirmedDatabase = process.env.TEST_CONFIRM_DATABASE;
const postgresDescribe = databaseUrl ? describe : describe.skip;
const tenantId = "20000000-0000-4000-8000-000000000001";
const otherTenantId = "20000000-0000-4000-8000-000000000099";
const dispatcherId = "10000000-0000-4000-8000-000000000001";
const pilotId = "10000000-0000-4000-8000-000000000002";
const flightId = "30000000-0000-4000-8000-000000000001";
const releaseId = "35000000-0000-4000-8000-000000000001";
const dispatchA = "40000000-0000-4000-8000-000000000001";
const dispatchB = "40000000-0000-4000-8000-000000000002";
const now = new Date("2026-08-12T12:00:00.000Z");

let sqlClient: Sql | undefined;

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
    flightVersion: 1,
    assignmentRevision: 1,
    dispatchReleaseId: releaseId,
    dispatchReleaseRevision: 1,
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
    expectedFlightVersion: 1,
    expectedAssignmentRevision: 1,
    releaseId,
    releaseRevision: 1,
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

function publishRelease() {
  return publishDispatchReleaseAtomic({
    tenantId,
    flightId,
    expectedFlightVersion: 1,
    operationalRoute: "NIKDA DCT GIMLI",
    sid: null,
    star: null,
    cruiseLevel: 400,
    alternateIcao: "KSEA",
    fuelUnit: "kg",
    payloadUnit: "kg",
    taxiFuel: 1_000,
    tripFuel: 50_000,
    contingencyFuel: 2_500,
    alternateFuel: 6_000,
    finalReserveFuel: 3_000,
    additionalFuel: 0,
    blockFuel: 62_500,
    plannedPayload: 25_000,
    weatherSnapshot: { unavailable: [] },
    releaseNotes: null,
    dispatcherRemarks: "New release remarks",
    releasedByMembershipId: dispatcherId,
    publishedAt: now,
  });
}

postgresDescribe("SimBrief PostgreSQL atomicity contracts", () => {
  beforeAll(async () => {
    sqlClient = postgres(databaseUrl!, {
      max: 10,
      onnotice: () => undefined,
    });
    const [database] = await sqlClient<{ currentDatabase: string }[]>`
      SELECT current_database() AS "currentDatabase"
    `;
    expect(database?.currentDatabase).toBe(confirmedDatabase);
    setDbForTests(simbriefDb(sqlClient));
  }, 30_000);

  afterAll(async () => {
    setDbForTests(null);
    await sqlClient?.end();
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
    await sqlClient!`
      INSERT INTO dispatch_releases (
        id, tenant_id, flight_id, revision, operational_route, cruise_level,
        alternate_icao, fuel_unit, payload_unit, taxi_fuel, trip_fuel,
        contingency_fuel, alternate_fuel, final_reserve_fuel, additional_fuel,
        block_fuel, planned_payload, weather_snapshot,
        released_by_membership_id
      ) VALUES (
        ${releaseId}, ${tenantId}, ${flightId}, 1, 'NIKDA DCT', 390,
        'KORD', 'kg', 'kg', 1000, 50000, 2500, 6000, 3000, 0,
        62500, 25000, '{}'::jsonb, ${dispatcherId}
      )
    `;
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

  it("serializes a notes-only version update without invalidating the prepared plan", async () => {
    await prepare(dispatchA);
    const editor = postgres(databaseUrl!, {
      max: 1,
      onnotice: () => undefined,
    });
    let generating: ReturnType<typeof start> | undefined;

    await editor.begin(async (transaction) => {
      await transaction`
        UPDATE flights
        SET dispatcher_notes = 'Gate changed to C12',
            version = version + 1
        WHERE id = ${flightId}
      `;
      generating = start(dispatchA);
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
    await editor.end();

    await expect(generating).resolves.toMatchObject({
      status: "started",
      latestId: dispatchA,
      dispatch: { status: "pending" },
    });
    const [state] = await sqlClient!`
      SELECT version, dispatcher_notes,
        (SELECT count(*)::int FROM audit_events
          WHERE action = 'simbrief.dispatch_generate') AS generation_audits
      FROM flights WHERE id = ${flightId}
    `;
    expect(state).toMatchObject({
      version: 2,
      dispatcher_notes: "Gate changed to C12",
      generation_audits: 1,
    });
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
      UPDATE flights
      SET arr_icao = 'ESSA', version = version + 1
      WHERE id = ${flightId}
    `;

    await expect(start(dispatchA)).resolves.toMatchObject({
      status: "stale",
      latestId: dispatchA,
      dispatch: null,
    });
  });

  it("rejects launch after the pilot assignment revision changes", async () => {
    await prepare(dispatchA);
    await sqlClient!`
      UPDATE flights
      SET assignment_revision = assignment_revision + 1,
          version = version + 1
      WHERE id = ${flightId}
    `;

    await expect(start(dispatchA)).resolves.toMatchObject({
      status: "stale",
      dispatch: null,
    });
  });

  it("atomically publishes a new release, advances flight version, and invalidates the old preparation", async () => {
    await prepare(dispatchA);

    const published = await publishRelease();
    expect(published).toMatchObject({
      flight: { version: 2, status: "briefed" },
      release: { revision: 2, dispatcherRemarks: "New release remarks" },
    });
    await expect(start(dispatchA)).resolves.toMatchObject({
      status: "stale",
      dispatch: null,
    });
    const [state] = await sqlClient!`
      SELECT
        (SELECT count(*)::int FROM dispatch_releases
          WHERE flight_id = ${flightId}) AS release_count,
        (SELECT count(*)::int FROM audit_events
          WHERE action = 'flight.release_publish') AS audit_count
    `;
    expect(state).toMatchObject({ release_count: 2, audit_count: 1 });
  });

  it("allows only one same-version release publisher", async () => {
    const results = await Promise.all([publishRelease(), publishRelease()]);

    expect(results.filter(Boolean)).toHaveLength(1);
    const [state] = await sqlClient!`
      SELECT
        (SELECT version FROM flights WHERE id = ${flightId}) AS version,
        (SELECT count(*)::int FROM dispatch_releases
          WHERE flight_id = ${flightId}) AS release_count,
        (SELECT count(*)::int FROM audit_events
          WHERE action = 'flight.release_publish') AS audit_count
    `;
    expect(state).toMatchObject({
      version: 2,
      release_count: 2,
      audit_count: 1,
    });
  });

  it("rolls flight and release publication back when its audit fails", async () => {
    await sqlClient!.unsafe(`
      ALTER TABLE audit_events ADD CONSTRAINT reject_simbrief_audit
      CHECK (action <> 'flight.release_publish')
    `);

    await expect(publishRelease()).rejects.toMatchObject({
      cause: { code: "23514" },
    });
    const [state] = await sqlClient!`
      SELECT
        (SELECT version FROM flights WHERE id = ${flightId}) AS version,
        (SELECT status FROM flights WHERE id = ${flightId}) AS status,
        (SELECT count(*)::int FROM dispatch_releases
          WHERE flight_id = ${flightId}) AS release_count,
        (SELECT count(*)::int FROM audit_events
          WHERE action = 'flight.release_publish') AS audit_count
    `;
    expect(state).toMatchObject({
      version: 1,
      status: "accepted",
      release_count: 1,
      audit_count: 0,
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
        expectedFlightVersion: 1,
        expectedAssignmentRevision: 1,
        releaseId,
        releaseRevision: 1,
        preparedAt: now,
      }),
    ).resolves.toBeNull();
  });
});
