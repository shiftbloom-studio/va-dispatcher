import { Hono } from "hono";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../test/d1.js";
import { flights, memberships, simulatorDevices, tenants } from "../schema.js";
import { loadEnv, resetEnvCache } from "../../env.js";
import { createTokenMac } from "../../lib/crypto.js";
import { errorHandler } from "../../middleware/error.js";
import { telemetryClientRoutes } from "../../routes/telemetry.js";
import {
  correctOooiAtomic,
  createSimulatorDeviceAtomic,
  findCurrentFlightTelemetry,
  ingestFlightTelemetryAtomic,
  listCurrentFlightTelemetry,
  listFlightTrack,
  revokeSimulatorDeviceAtomic,
} from "./telemetry.js";

const tenantId = "20000000-0000-4000-8000-000000000001";
const membershipId = "10000000-0000-4000-8000-000000000001";
const flightA = "30000000-0000-4000-8000-000000000001";
const flightB = "30000000-0000-4000-8000-000000000002";
const deviceA = "60000000-0000-4000-8000-000000000001";
const deviceB = "60000000-0000-4000-8000-000000000002";
const otherTenantId = "20000000-0000-4000-8000-000000000099";
const otherMembershipId = "10000000-0000-4000-8000-000000000099";
const otherFlightId = "30000000-0000-4000-8000-000000000099";
const now = new Date("2026-08-12T12:00:00.000Z");
const secretsKey = Buffer.alloc(32, 7).toString("base64");
const routeDeviceSecret = "r".repeat(43);

const routeApp = new Hono();
routeApp.onError(errorHandler);
routeApp.route("/", telemetryClientRoutes);

function sample(input: {
  flightId?: string;
  phase: "preflight" | "taxi_out" | "airborne" | "taxi_in" | "parked";
  sequence: number;
  sampleAt: Date;
}) {
  return {
    flightId: input.flightId ?? flightA,
    phase: input.phase,
    sequence: input.sequence,
    sampleAt: input.sampleAt,
    simulatorTime: input.sampleAt,
    latitude: 55.618,
    longitude: 12.656,
    altitudeFeet: input.phase === "airborne" ? 10_000 : 0,
    groundSpeedKnots: input.phase === "airborne" ? 280 : 12,
    headingDegrees: 274,
  };
}

function ingest(input: {
  deviceId?: string;
  flightId?: string;
  phase: "preflight" | "taxi_out" | "airborne" | "taxi_in" | "parked";
  sequence: number;
  sampleAt: Date;
}) {
  const telemetry = sample(input);
  return ingestFlightTelemetryAtomic({
    tenantId,
    membershipId,
    deviceId: input.deviceId ?? deviceA,
    flightId: input.flightId ?? flightA,
    minimumIntervalMs: 2_000,
    leaseMs: 120_000,
    sample: telemetry,
  });
}

describe("telemetry D1 atomicity contracts", () => {
  let database: TestDatabase;
  const sql = <T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => database.sql<T>(strings, ...values);

  beforeAll(async () => {
    resetEnvCache();
    loadEnv({ NODE_ENV: "test", TENANT_SECRETS_KEY: secretsKey });
    database = await createTestDatabase();
  });

  afterAll(async () => {
    resetEnvCache();
    await database.dispose();
  });

  beforeEach(async () => {
    await database.reset();
    const { db } = database;
    await db.insert(tenants).values({
      id: tenantId,
      slug: "vsas",
      name: "Virtual SAS",
      clerkOrgId: "org_test",
    });
    await db.insert(memberships).values({
      id: membershipId,
      tenantId,
      clerkUserId: "user_test",
    });
    for (const flight of [
      {
        id: flightA,
        flightNumber: "SK901",
        depIcao: "EKCH",
        arrIcao: "ENGM",
        etd: "2026-08-12T12:00:00.000Z",
        eta: "2026-08-12T14:00:00.000Z",
      },
      {
        id: flightB,
        flightNumber: "SK902",
        depIcao: "ENGM",
        arrIcao: "EKCH",
        etd: "2026-08-12T15:00:00.000Z",
        eta: "2026-08-12T17:00:00.000Z",
      },
    ]) {
      await db.insert(flights).values({
        ...flight,
        tenantId,
        pilotMembershipId: membershipId,
        etd: new Date(flight.etd),
        eta: new Date(flight.eta),
        aircraftType: "A320",
        status: "briefed",
      });
    }
    await db.insert(simulatorDevices).values([
      {
        id: deviceA,
        tenantId,
        membershipId,
        name: "Device A",
        tokenMac: "mac-a",
      },
      {
        id: deviceB,
        tenantId,
        membershipId,
        name: "Device B",
        tokenMac: "mac-b",
      },
    ]);
  });

  it("rolls back device issuance when its audit record cannot be written", async () => {
    const issuedDevice = "60000000-0000-4000-8000-000000000003";
    await database.failInserts(
      "audit_events",
      "new.action = 'telemetry.device_create'",
    );

    await expect(
      createSimulatorDeviceAtomic({
        id: issuedDevice,
        tenantId,
        membershipId,
        name: "Audit failure test",
        tokenMac: "never-stored",
      }),
    ).rejects.toThrow();

    const [state] = await sql`
      SELECT
        (SELECT count(*) FROM simulator_devices
          WHERE id = ${issuedDevice}) AS device_count,
        (SELECT count(*) FROM audit_events
          WHERE entity_id = ${issuedDevice}) AS audit_count
    `;
    expect(state).toMatchObject({ device_count: 0, audit_count: 0 });
  });

  it("commits current, track, automatic OOOI, provenance, and audit together", async () => {
    const accepted = await ingest({
      phase: "preflight",
      sequence: 1,
      sampleAt: now,
    });
    expect(accepted).toMatchObject({
      status: "accepted",
      current: {
        flightId: flightA,
        deviceId: deviceA,
        phase: "preflight",
        sequence: 1,
        sampleAt: now,
      },
      oooiEvent: null,
    });
    const transitionAt = new Date(now.getTime() + 2_000);
    expect(
      await ingest({
        phase: "taxi_out",
        sequence: 2,
        sampleAt: transitionAt,
      }),
    ).toMatchObject({
      status: "accepted",
      oooiEvent: { eventType: "out", source: "telemetry" },
    });

    const [flight] = await sql`
      SELECT out_at, version FROM flights WHERE id = ${flightA}
    `;
    const [counts] = await sql`
      SELECT
        (SELECT count(*) FROM flight_telemetry_track) AS track_count,
        (SELECT count(*) FROM flight_oooi_events) AS event_count,
        (SELECT count(*) FROM audit_events
          WHERE action = 'flight.oooi_automatic') AS audit_count,
        (SELECT sequence FROM flight_telemetry_current
          WHERE flight_id = ${flightA}) AS current_sequence
    `;
    expect(new Date(Number(flight?.out_at))).toEqual(transitionAt);
    expect(flight?.version).toBe(2);
    expect(counts).toMatchObject({
      track_count: 2,
      event_count: 1,
      audit_count: 1,
      current_sequence: 2,
    });
    const [automaticAudit] = await sql`
      SELECT meta
      FROM audit_events
      WHERE action = 'flight.oooi_automatic'
    `;
    expect(JSON.parse(String(automaticAudit?.meta))).toMatchObject({
      fromVersion: 1,
      toVersion: 2,
    });
  });

  it("records the full deterministic OUT, OFF, ON, IN phase sequence", async () => {
    const phases = [
      ["preflight", null],
      ["taxi_out", "out"],
      ["airborne", "off"],
      ["taxi_in", "on"],
      ["parked", "in"],
    ] as const;
    const receipts = phases.map(
      (_, index) => new Date(now.getTime() + index * 2_000),
    );
    for (const [index, [phase, eventType]] of phases.entries()) {
      const result = await ingest({
        phase,
        sequence: index + 1,
        sampleAt: receipts[index]!,
      });
      expect(result.status).toBe("accepted");
      expect(result.oooiEvent?.eventType ?? null).toBe(eventType);
    }

    const [flight] = await sql`
      SELECT out_at, off_at, on_at, in_at FROM flights WHERE id = ${flightA}
    `;
    expect(
      [flight?.out_at, flight?.off_at, flight?.on_at, flight?.in_at].map(
        (value) => new Date(Number(value)).toISOString(),
      ),
    ).toEqual(receipts.slice(1).map((value) => value.toISOString()));
    const events = await sql`
      SELECT event_type, occurred_at, source
      FROM flight_oooi_events
      ORDER BY created_at, event_type
    `;
    expect(events.map((event) => event.event_type)).toEqual([
      "out",
      "off",
      "on",
      "in",
    ]);
    expect(events.every((event) => event.source === "telemetry")).toBe(true);
  });

  it("does not infer OOOI from duplicate, skipped, or reversed phases", async () => {
    await ingest({ phase: "preflight", sequence: 1, sampleAt: now });
    expect(
      await ingest({
        phase: "preflight",
        sequence: 2,
        sampleAt: new Date(now.getTime() + 2_000),
      }),
    ).toMatchObject({ oooiEvent: null });
    expect(
      await ingest({
        phase: "taxi_in",
        sequence: 3,
        sampleAt: new Date(now.getTime() + 4_000),
      }),
    ).toMatchObject({ oooiEvent: null });
    expect(
      await ingest({
        phase: "airborne",
        sequence: 4,
        sampleAt: new Date(now.getTime() + 6_000),
      }),
    ).toMatchObject({ oooiEvent: null });

    const [state] = await sql`
      SELECT out_at, off_at, on_at, in_at,
        (SELECT count(*) FROM flight_oooi_events) AS event_count
      FROM flights WHERE id = ${flightA}
    `;
    expect(state).toMatchObject({
      out_at: null,
      off_at: null,
      on_at: null,
      in_at: null,
      event_count: 0,
    });
  });

  it("rolls back every automatic OOOI and telemetry write when audit fails", async () => {
    await ingest({ phase: "preflight", sequence: 1, sampleAt: now });
    await database.failInserts(
      "audit_events",
      "new.action = 'flight.oooi_automatic'",
    );

    await expect(
      ingest({
        phase: "taxi_out",
        sequence: 2,
        sampleAt: new Date(now.getTime() + 2_000),
      }),
    ).rejects.toThrow();

    const [state] = await sql`
      SELECT
        (SELECT out_at FROM flights WHERE id = ${flightA}) AS out_at,
        (SELECT sequence FROM flight_telemetry_current
          WHERE flight_id = ${flightA}) AS current_sequence,
        (SELECT last_sequence FROM simulator_devices
          WHERE id = ${deviceA}) AS device_sequence,
        (SELECT count(*) FROM flight_telemetry_track) AS track_count,
        (SELECT count(*) FROM flight_oooi_events) AS event_count
    `;
    expect(state).toMatchObject({
      out_at: null,
      current_sequence: 1,
      device_sequence: 1,
      track_count: 1,
      event_count: 0,
    });
  });

  it("selects exactly one writer during a simultaneous first-device collision", async () => {
    const results = await Promise.all([
      ingest({
        deviceId: deviceA,
        phase: "preflight",
        sequence: 1,
        sampleAt: now,
      }),
      ingest({
        deviceId: deviceB,
        phase: "preflight",
        sequence: 1,
        sampleAt: now,
      }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([
      "accepted",
      "lease_conflict",
    ]);

    const [state] = await sql`
      SELECT
        (SELECT count(*) FROM flight_telemetry_current) AS current_count,
        (SELECT count(*) FROM flight_telemetry_track) AS track_count,
        (SELECT count(*) FROM simulator_devices
          WHERE last_sequence = 1) AS claimed_devices,
        (SELECT device_id FROM flight_telemetry_leases
          WHERE flight_id = ${flightA}) AS lease_device,
        (SELECT device_id FROM flight_telemetry_current
          WHERE flight_id = ${flightA}) AS current_device
    `;
    expect(state).toMatchObject({
      current_count: 1,
      track_count: 1,
      claimed_devices: 1,
    });
    expect(state?.lease_device).toBe(state?.current_device);
  });

  it("pairs one device to only one live flight at a time", async () => {
    expect(
      await ingest({
        deviceId: deviceA,
        flightId: flightA,
        phase: "preflight",
        sequence: 1,
        sampleAt: now,
      }),
    ).toMatchObject({ status: "accepted" });
    expect(
      await ingest({
        deviceId: deviceA,
        flightId: flightB,
        phase: "preflight",
        sequence: 2,
        sampleAt: new Date(now.getTime() + 2_000),
      }),
    ).toMatchObject({ status: "lease_conflict" });

    const [state] = await sql`
      SELECT
        (SELECT count(*) FROM flight_telemetry_leases
          WHERE device_id = ${deviceA}) AS lease_count,
        (SELECT count(*) FROM flight_telemetry_current
          WHERE flight_id = ${flightB}) AS second_flight_current,
        (SELECT last_sequence FROM simulator_devices
          WHERE id = ${deviceA}) AS device_sequence
    `;
    expect(state).toMatchObject({
      lease_count: 1,
      second_flight_current: 0,
      device_sequence: 1,
    });
  });

  it("rechecks flight and pilot eligibility inside the locked ingest statement", async () => {
    await sql`
      UPDATE flights SET status = 'completed' WHERE id = ${flightA}
    `;
    expect(
      await ingest({ phase: "preflight", sequence: 1, sampleAt: now }),
    ).toMatchObject({ status: "ineligible", current: null });

    await sql`
      UPDATE flights SET status = 'briefed' WHERE id = ${flightA}
    `;
    await sql`
      UPDATE memberships SET status = 'disabled' WHERE id = ${membershipId}
    `;
    expect(
      await ingest({ phase: "preflight", sequence: 1, sampleAt: now }),
    ).toMatchObject({ status: "ineligible", current: null });

    await sql`
      UPDATE memberships SET status = 'active', role = 'dispatcher'
      WHERE id = ${membershipId}
    `;
    expect(
      await ingest({ phase: "preflight", sequence: 1, sampleAt: now }),
    ).toMatchObject({ status: "ineligible", current: null });

    const [state] = await sql`
      SELECT
        (SELECT count(*) FROM flight_telemetry_track) AS track_count,
        (SELECT last_sequence FROM simulator_devices
          WHERE id = ${deviceA}) AS device_sequence
    `;
    expect(state).toMatchObject({ track_count: 0, device_sequence: null });
  });

  it("observes a concurrently committed terminal transition before accepting a sample", async () => {
    // D1 serializes writes: the terminal transition commits first.
    await sql`
      UPDATE flights SET status = 'completed' WHERE id = ${flightA}
    `;
    const pendingIngest = ingest({
      phase: "preflight",
      sequence: 1,
      sampleAt: now,
    });

    await expect(pendingIngest).resolves.toMatchObject({
      status: "ineligible",
      current: null,
    });
  });

  it("releases a revoked device pairing atomically with its audit", async () => {
    await ingest({ phase: "preflight", sequence: 1, sampleAt: now });

    const revoked = await revokeSimulatorDeviceAtomic({
      tenantId,
      membershipId,
      id: deviceA,
      revokedAt: new Date(now.getTime() + 1_000),
    });

    expect(revoked).toMatchObject({ id: deviceA, status: "revoked" });
    const [state] = await sql`
      SELECT
        (SELECT count(*) FROM flight_telemetry_leases
          WHERE device_id = ${deviceA}) AS lease_count,
        (SELECT count(*) FROM audit_events
          WHERE action = 'telemetry.device_revoke'
            AND entity_id = ${deviceA}) AS audit_count
    `;
    expect(state).toMatchObject({ lease_count: 0, audit_count: 1 });
    await expect(
      findCurrentFlightTelemetry(tenantId, flightA),
    ).resolves.toBeNull();
    await expect(
      ingest({
        phase: "preflight",
        sequence: 2,
        sampleAt: new Date(now.getTime() + 2_000),
      }),
    ).resolves.toMatchObject({ status: "credential_invalid", current: null });
  });

  it("does not present an old pilot's current sample after reassignment", async () => {
    const replacementMembershipId = "10000000-0000-4000-8000-000000000002";
    await ingest({ phase: "preflight", sequence: 1, sampleAt: now });
    await sql`
      INSERT INTO memberships (id, tenant_id, clerk_user_id)
      VALUES (${replacementMembershipId}, ${tenantId}, 'replacement_user')
    `;
    await sql`
      UPDATE flights SET pilot_membership_id = ${replacementMembershipId}
      WHERE id = ${flightA}
    `;

    await expect(
      findCurrentFlightTelemetry(tenantId, flightA),
    ).resolves.toBeNull();
    await expect(listCurrentFlightTelemetry({ tenantId })).resolves.toEqual([]);
  });

  it("rejects cross-tenant and wrong-member device resources without writes", async () => {
    await sql`
      INSERT INTO tenants (id, slug, name, clerk_org_id)
      VALUES (${otherTenantId}, 'other', 'Other VA', 'org_other')
    `;
    await sql`
      INSERT INTO memberships (id, tenant_id, clerk_user_id)
      VALUES (${otherMembershipId}, ${otherTenantId}, 'other_user')
    `;
    await sql`
      INSERT INTO flights (
        id, tenant_id, pilot_membership_id, flight_number, dep_icao, arr_icao,
        etd, eta, aircraft_type, status
      ) VALUES (
        ${otherFlightId}, ${otherTenantId}, ${otherMembershipId}, 'SK990',
        'ESSA', 'EFHK', '2026-08-12T12:00:00.000Z',
        '2026-08-12T14:00:00.000Z', 'A320', 'briefed'
      )
    `;

    expect(
      await ingestFlightTelemetryAtomic({
        tenantId: otherTenantId,
        membershipId: otherMembershipId,
        deviceId: deviceA,
        flightId: otherFlightId,
        minimumIntervalMs: 2_000,
        leaseMs: 120_000,
        sample: sample({
          flightId: otherFlightId,
          phase: "preflight",
          sequence: 1,
          sampleAt: now,
        }),
      }),
    ).toMatchObject({ status: "credential_invalid" });
    expect(
      await revokeSimulatorDeviceAtomic({
        tenantId: otherTenantId,
        membershipId: otherMembershipId,
        id: deviceA,
        revokedAt: now,
      }),
    ).toBeNull();

    const [state] = await sql`
      SELECT
        (SELECT count(*) FROM flight_telemetry_track) AS track_count,
        (SELECT status FROM simulator_devices WHERE id = ${deviceA}) AS status,
        (SELECT count(*) FROM audit_events) AS audit_count
    `;
    expect(state).toMatchObject({
      track_count: 0,
      status: "active",
      audit_count: 0,
    });
  });

  it("enforces tenant coherence for device, flight, member, and provenance edges", async () => {
    const otherDeviceId = "60000000-0000-4000-8000-000000000099";
    await sql`
      INSERT INTO tenants (id, slug, name, clerk_org_id)
      VALUES (${otherTenantId}, 'other', 'Other VA', 'org_other')
    `;
    await sql`
      INSERT INTO memberships (id, tenant_id, clerk_user_id)
      VALUES (${otherMembershipId}, ${otherTenantId}, 'other_user')
    `;
    await sql`
      INSERT INTO flights (
        id, tenant_id, pilot_membership_id, flight_number, dep_icao, arr_icao,
        etd, eta, aircraft_type, status
      ) VALUES (
        ${otherFlightId}, ${otherTenantId}, ${otherMembershipId}, 'SK990',
        'ESSA', 'EFHK', '2026-08-12T12:00:00.000Z',
        '2026-08-12T14:00:00.000Z', 'A320', 'briefed'
      )
    `;
    await sql`
      INSERT INTO simulator_devices (
        id, tenant_id, membership_id, name, token_mac
      ) VALUES (
        ${otherDeviceId}, ${otherTenantId}, ${otherMembershipId},
        'Other device', 'other-mac'
      )
    `;

    await expect(
      sql`
        INSERT INTO simulator_devices (
          id, tenant_id, membership_id, name, token_mac
        ) VALUES (
          '60000000-0000-4000-8000-000000000098', ${tenantId},
          ${otherMembershipId}, 'Mixed tenant', 'invalid'
        )
      `,
    ).rejects.toThrow(/FOREIGN KEY/);

    await expect(
      sql`
        INSERT INTO flight_telemetry_current (
          flight_id, tenant_id, membership_id, device_id, phase, latitude,
          longitude, altitude_feet, ground_speed_knots, heading_degrees,
          simulator_time, sample_at, sequence
        ) VALUES (
          ${flightA}, ${tenantId}, ${membershipId}, ${otherDeviceId},
          'preflight', 55, 12, 0, 0, 0, ${now.toISOString()},
          ${now.toISOString()}, 1
        )
      `,
    ).rejects.toThrow(/FOREIGN KEY/);

    await expect(
      sql`
        INSERT INTO flight_telemetry_track (
          tenant_id, flight_id, membership_id, device_id, phase, latitude,
          longitude, altitude_feet, ground_speed_knots, heading_degrees,
          simulator_time, sample_at, sequence
        ) VALUES (
          ${tenantId}, ${otherFlightId}, ${membershipId}, ${deviceA},
          'preflight', 55, 12, 0, 0, 0, ${now.toISOString()},
          ${now.toISOString()}, 1
        )
      `,
    ).rejects.toThrow(/FOREIGN KEY/);

    await expect(
      sql`
        INSERT INTO flight_oooi_events (
          tenant_id, flight_id, event_type, occurred_at, source,
          actor_membership_id
        ) VALUES (
          ${tenantId}, ${flightA}, 'out', ${now.toISOString()}, 'manual',
          ${otherMembershipId}
        )
      `,
    ).rejects.toThrow(/FOREIGN KEY/);
  });

  it("preserves OOOI provenance until actor and device references are explicitly anonymized", async () => {
    await sql`
      INSERT INTO flight_oooi_events (
        tenant_id, flight_id, event_type, occurred_at, source,
        actor_membership_id, device_id, reason
      ) VALUES (
        ${tenantId}, ${flightA}, 'out', ${now.toISOString()}, 'manual',
        ${membershipId}, ${deviceA}, 'Privacy lifecycle contract'
      )
    `;

    await expect(
      sql`DELETE FROM simulator_devices WHERE id = ${deviceA}`,
    ).rejects.toThrow(/FOREIGN KEY/);
    await expect(
      sql`DELETE FROM memberships WHERE id = ${membershipId}`,
    ).rejects.toThrow(/FOREIGN KEY/);

    await sql`
      UPDATE flight_oooi_events
      SET actor_membership_id = NULL, device_id = NULL
      WHERE flight_id = ${flightA}
    `;
    await sql`DELETE FROM simulator_devices WHERE id = ${deviceA}`;
    await sql`DELETE FROM memberships WHERE id = ${membershipId}`;

    const [state] = await sql`
      SELECT actor_membership_id, device_id,
        (SELECT count(*) FROM memberships
          WHERE id = ${membershipId}) AS member_count,
        (SELECT count(*) FROM simulator_devices
          WHERE id = ${deviceA}) AS device_count
      FROM flight_oooi_events
      WHERE reason = 'Privacy lifecycle contract'
    `;
    expect(state).toMatchObject({
      actor_membership_id: null,
      device_id: null,
      member_count: 0,
      device_count: 0,
    });
  });

  it("returns 404 at the real ingest route for a cross-tenant device-flight pair", async () => {
    await sql`
      UPDATE simulator_devices
      SET token_mac = ${createTokenMac(
        routeDeviceSecret,
        secretsKey,
        "simulator-device-token",
      )}
      WHERE id = ${deviceA}
    `;
    await sql`
      INSERT INTO tenants (id, slug, name, clerk_org_id)
      VALUES (${otherTenantId}, 'other', 'Other VA', 'org_other')
    `;
    await sql`
      INSERT INTO memberships (id, tenant_id, clerk_user_id)
      VALUES (${otherMembershipId}, ${otherTenantId}, 'other_user')
    `;
    await sql`
      INSERT INTO flights (
        id, tenant_id, pilot_membership_id, flight_number, dep_icao, arr_icao,
        etd, eta, aircraft_type, status
      ) VALUES (
        ${otherFlightId}, ${otherTenantId}, ${otherMembershipId}, 'SK990',
        'ESSA', 'EFHK', '2026-08-12T12:00:00.000Z',
        '2026-08-12T14:00:00.000Z', 'A320', 'briefed'
      )
    `;

    const receivedAt = new Date();
    const response = await routeApp.request("/telemetry/ingest", {
      method: "POST",
      headers: {
        Authorization: `Bearer v1.${deviceA}.${routeDeviceSecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        flightId: otherFlightId,
        sequence: 1,
        simulatorTime: receivedAt.toISOString(),
        phase: "preflight",
        latitude: 55,
        longitude: 12,
        altitudeFeet: 0,
        groundSpeedKnots: 0,
        headingDegrees: 0,
      }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: "NOT_FOUND", message: "Assigned flight not found" },
    });
    const [state] = await sql`
      SELECT
        (SELECT count(*) FROM flight_telemetry_track) AS track_count,
        (SELECT last_sequence FROM simulator_devices
          WHERE id = ${deviceA}) AS sequence
    `;
    expect(state).toMatchObject({ track_count: 0, sequence: null });
  });

  it("rejects replay and rate collisions without advancing stored state", async () => {
    expect(
      await ingest({ phase: "preflight", sequence: 1, sampleAt: now }),
    ).toMatchObject({ status: "accepted" });
    expect(
      await ingest({
        phase: "preflight",
        sequence: 1,
        sampleAt: new Date(now.getTime() + 2_000),
      }),
    ).toMatchObject({ status: "replay_or_rate" });
    expect(
      await ingest({
        phase: "preflight",
        sequence: 2,
        sampleAt: new Date(now.getTime() + 1_000),
      }),
    ).toMatchObject({ status: "replay_or_rate" });

    const [state] = await sql`
      SELECT
        (SELECT last_sequence FROM simulator_devices
          WHERE id = ${deviceA}) AS device_sequence,
        (SELECT count(*) FROM flight_telemetry_track) AS track_count
    `;
    expect(state).toMatchObject({ device_sequence: 1, track_count: 1 });
  });

  it("rolls back a manual correction and its provenance when audit fails", async () => {
    await sql`
      UPDATE flights
      SET out_at = ${now.toISOString()},
          off_at = ${new Date(now.getTime() + 10_000).toISOString()}
      WHERE id = ${flightA}
    `;
    await database.failInserts(
      "audit_events",
      "new.action = 'flight.oooi_correct'",
    );

    await expect(
      correctOooiAtomic({
        tenantId,
        flightId: flightA,
        actorMembershipId: membershipId,
        expectedVersion: 1,
        reason: "Corrected from the flight log",
        onAt: new Date(now.getTime() + 20_000),
        operationAt: new Date(now.getTime() + 30_000),
      }),
    ).rejects.toThrow();

    const [state] = await sql`
      SELECT
        (SELECT on_at FROM flights WHERE id = ${flightA}) AS on_at,
        (SELECT count(*) FROM flight_oooi_events) AS event_count,
        (SELECT count(*) FROM audit_events) AS audit_count
    `;
    expect(state).toMatchObject({
      on_at: null,
      event_count: 0,
      audit_count: 0,
    });
  });

  it("serializes automatic OOOI against a concurrent manual correction without a lost version", async () => {
    await ingest({ phase: "preflight", sequence: 1, sampleAt: now });
    const automaticAt = new Date(now.getTime() + 2_000);
    const manualAt = new Date(now.getTime() + 1_000);

    const [automatic, manual] = await Promise.all([
      ingest({ phase: "taxi_out", sequence: 2, sampleAt: automaticAt }),
      correctOooiAtomic({
        tenantId,
        flightId: flightA,
        actorMembershipId: membershipId,
        expectedVersion: 1,
        reason: "Dispatcher block time correction",
        outAt: manualAt,
        operationAt: new Date(now.getTime() + 3_000),
      }),
    ]);

    expect(automatic.status).toBe("accepted");
    const [flight] = await sql`
      SELECT out_at, out_manual_override, version FROM flights WHERE id = ${flightA}
    `;
    expect(flight?.version).toBe(2);
    expect(new Date(Number(flight?.out_at))).toEqual(
      manual ? manualAt : automaticAt,
    );
    expect(Boolean(flight?.out_manual_override)).toBe(manual);
    const events = await sql`
      SELECT event_type, source, occurred_at
      FROM flight_oooi_events
      WHERE flight_id = ${flightA}
      ORDER BY created_at, source
    `;
    expect(events.filter((event) => event.event_type === "out")).toHaveLength(
      1,
    );
    expect(events[0]?.source).toBe(manual ? "manual" : "telemetry");
    expect(new Date(Number(events[0]?.occurred_at))).toEqual(
      manual ? manualAt : automaticAt,
    );
  });

  it("observes a concurrently committed versioned dispatcher edit before automatic OOOI", async () => {
    await ingest({ phase: "preflight", sequence: 1, sampleAt: now });
    const automaticAt = new Date(now.getTime() + 2_000);
    // D1 serializes writes: the dispatcher edit commits first.
    await sql`
      UPDATE flights
      SET dispatcher_notes = 'Gate change confirmed',
          version = version + 1,
          updated_at = ${new Date(now.getTime() + 1_000)}
      WHERE id = ${flightA}
        AND tenant_id = ${tenantId}
        AND version = 1
    `;
    await sql`
      INSERT INTO audit_events (
        tenant_id, actor_membership_id, action, entity_type, entity_id, meta
      ) VALUES (
        ${tenantId}, ${membershipId}, 'flight.update', 'flight', ${flightA},
        json_object('fromVersion', 1, 'toVersion', 2)
      )
    `;
    const pendingAutomatic = ingest({
      phase: "taxi_out",
      sequence: 2,
      sampleAt: automaticAt,
    });

    await expect(pendingAutomatic).resolves.toMatchObject({
      status: "accepted",
      oooiEvent: { eventType: "out", source: "telemetry" },
    });
    const [state] = await sql`
      SELECT version, dispatcher_notes, out_at,
        (SELECT meta FROM audit_events
          WHERE action = 'flight.oooi_automatic') AS automatic_meta,
        (SELECT count(*) FROM audit_events
          WHERE action = 'flight.update') AS edit_audit_count
      FROM flights
      WHERE id = ${flightA}
    `;
    expect(new Date(Number(state?.out_at))).toEqual(automaticAt);
    expect(state?.version).toBe(3);
    expect(state?.dispatcher_notes).toBe("Gate change confirmed");
    expect(state?.edit_audit_count).toBe(1);
    expect(JSON.parse(String(state?.automatic_meta))).toMatchObject({
      fromVersion: 2,
      toVersion: 3,
    });
  });

  it("keeps a manual clear authoritative over later automatic phase transitions", async () => {
    await ingest({ phase: "preflight", sequence: 1, sampleAt: now });
    expect(
      await correctOooiAtomic({
        tenantId,
        flightId: flightA,
        actorMembershipId: membershipId,
        expectedVersion: 1,
        reason: "OUT not available from flight log",
        outAt: null,
        operationAt: new Date(now.getTime() + 1_000),
      }),
    ).toBe(true);
    expect(
      await ingest({
        phase: "taxi_out",
        sequence: 2,
        sampleAt: new Date(now.getTime() + 2_000),
      }),
    ).toMatchObject({ status: "accepted", oooiEvent: null });

    const [state] = await sql`
      SELECT out_at, out_manual_override, version,
        (SELECT count(*) FROM flight_oooi_events
          WHERE event_type = 'out' AND source = 'manual') AS manual_events,
        (SELECT count(*) FROM flight_oooi_events
          WHERE event_type = 'out' AND source = 'telemetry') AS auto_events,
        (SELECT meta FROM audit_events
          WHERE action = 'flight.oooi_correct') AS correction_meta
      FROM flights WHERE id = ${flightA}
    `;
    expect({
      ...state,
      correction_meta: JSON.parse(String(state?.correction_meta)),
    }).toMatchObject({
      out_at: null,
      out_manual_override: 1,
      version: 2,
      manual_events: 1,
      auto_events: 0,
      correction_meta: { fromVersion: 1, toVersion: 2 },
    });
  });

  it("rejects a stale manual OOOI correction without partial writes", async () => {
    await sql`
      UPDATE flights
      SET dispatcher_notes = 'Newer dispatcher edit', version = 2
      WHERE id = ${flightA}
    `;

    expect(
      await correctOooiAtomic({
        tenantId,
        flightId: flightA,
        actorMembershipId: membershipId,
        expectedVersion: 1,
        reason: "Stale block time",
        outAt: now,
        operationAt: new Date(now.getTime() + 1_000),
      }),
    ).toBe(false);

    const [state] = await sql`
      SELECT version, dispatcher_notes, out_at,
        (SELECT count(*) FROM flight_oooi_events) AS event_count,
        (SELECT count(*) FROM audit_events) AS audit_count
      FROM flights
      WHERE id = ${flightA}
    `;
    expect(state).toMatchObject({
      version: 2,
      dispatcher_notes: "Newer dispatcher edit",
      out_at: null,
      event_count: 0,
      audit_count: 0,
    });
  });

  it("never exposes retained track samples outside the 24-hour read window", async () => {
    const recentAt = new Date(now.getTime() - 60_000);
    const expiredAt = new Date(now.getTime() - 24 * 60 * 60_000 - 1);
    for (const [sampleAt, latitude, sequence] of [
      [recentAt, 55, 2],
      [expiredAt, 54, 1],
    ] as const) {
      await sql`
        INSERT INTO flight_telemetry_track (
          tenant_id, flight_id, membership_id, device_id, phase, latitude,
          longitude, altitude_feet, ground_speed_knots, heading_degrees,
          simulator_time, sample_at, sequence
        ) VALUES (
          ${tenantId}, ${flightA}, ${membershipId}, ${deviceA}, 'airborne',
          ${latitude}, 12, 10000, 280, 274, ${sampleAt}, ${sampleAt}, ${sequence}
        )
      `;
    }

    const rows = await listFlightTrack({
      tenantId,
      flightId: flightA,
      limit: 100,
      now,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sampleAt).toEqual(recentAt);
  });

  it("prunes expired rows and keeps the physical active-flight cap at exactly 5,000", async () => {
    const insertSeries = (count: number, offsetMs: number, sign: 1 | -1) => sql`
      WITH RECURSIVE series(value) AS (
        SELECT 1 UNION ALL SELECT value + 1 FROM series WHERE value < ${count}
      )
      INSERT INTO flight_telemetry_track (
        tenant_id, flight_id, membership_id, device_id, phase, latitude,
        longitude, altitude_feet, ground_speed_knots, heading_degrees,
        simulator_time, sample_at, sequence
      )
      SELECT
        ${tenantId}, ${flightA}, ${membershipId}, ${deviceA}, 'airborne',
        55, 12, 10000, 280, 274,
        ${now.getTime() - offsetMs} - value * 1000,
        ${now.getTime() - offsetMs} - value * 1000,
        ${sign} * value
      FROM series
    `;
    await insertSeries(5000, 0, 1);
    await insertSeries(10, 25 * 60 * 60_000, -1);

    expect(
      await ingest({
        phase: "airborne",
        sequence: 5001,
        sampleAt: new Date(now.getTime() + 2_000),
      }),
    ).toMatchObject({ status: "accepted" });
    const [state] = await sql`
      SELECT count(*) AS track_count,
        count(*) FILTER (
          WHERE sample_at < ${new Date(now.getTime() - 24 * 60 * 60_000)}
        ) AS expired_count
      FROM flight_telemetry_track
      WHERE flight_id = ${flightA}
    `;
    expect(state?.track_count).toBe(5_000);
    expect(state?.expired_count).toBe(0);
  });
});
