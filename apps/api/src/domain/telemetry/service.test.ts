import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Flight,
  FlightOooiEvent,
  FlightTelemetryCurrent,
  SimulatorDevice,
} from "../../db/schema.js";

const mocks = vi.hoisted(() => ({
  createSimulatorDeviceAtomic: vi.fn(),
  listSimulatorDevices: vi.fn(),
  revokeSimulatorDeviceAtomic: vi.fn(),
  findSimulatorDeviceById: vi.fn(),
  ingestFlightTelemetryAtomic: vi.fn(),
  findCurrentFlightTelemetry: vi.fn(),
  correctOooiAtomic: vi.fn(),
  listFlightTrack: vi.fn(),
  listOooiEvents: vi.fn(),
  listCurrentFlightTelemetry: vi.fn(),
  findFlight: vi.fn(),
}));

vi.mock("../../db/repositories/telemetry.js", () => mocks);
vi.mock("../../db/repositories/flights.js", () => ({
  findFlight: mocks.findFlight,
}));
import { loadEnv, resetEnvCache } from "../../env.js";
import { createTokenMac } from "../../lib/crypto.js";
import {
  correctOooi,
  createDevice,
  getFlightTelemetry,
  ingestTelemetry,
  listLiveTelemetry,
  presenceState,
  revokeDevice,
} from "./service.js";

const now = new Date("2026-08-12T12:00:00.000Z");
const secretsKey = Buffer.alloc(32, 8).toString("base64");
const deviceId = "60000000-0000-4000-8000-000000000001";
const deviceSecret = "a".repeat(43);
const flightId = "30000000-0000-4000-8000-000000000001";
const tenantId = "20000000-0000-4000-8000-000000000001";
const membershipId = "10000000-0000-4000-8000-000000000001";

const device: SimulatorDevice = {
  id: deviceId,
  tenantId,
  membershipId,
  name: "Test cockpit",
  tokenMac: createTokenMac(deviceSecret, secretsKey, "simulator-device-token"),
  status: "active",
  lastSequence: null,
  lastIngestAt: null,
  lastSeenAt: null,
  revokedAt: null,
  createdAt: now,
  updatedAt: now,
};

const flight: Flight = {
  id: flightId,
  tenantId,
  scheduleRequestId: null,
  replacesFlightId: null,
  pilotMembershipId: membershipId,
  flightNumber: "SK101",
  depIcao: "EKCH",
  arrIcao: "ENGM",
  etd: now,
  eta: new Date(now.getTime() + 60 * 60_000),
  aircraftType: "A320",
  version: 1,
  status: "briefed",
  cancelReason: null,
  declinedReason: null,
  dispatcherNotes: null,
  assignmentRevision: 1,
  assignmentConfirmedRevision: 1,
  assignmentConfirmedAt: now,
  outAt: now,
  offAt: null,
  onAt: null,
  inAt: null,
  outManualOverride: false,
  offManualOverride: false,
  onManualOverride: false,
  inManualOverride: false,
  createdAt: now,
  updatedAt: now,
};

const current: FlightTelemetryCurrent = {
  flightId,
  tenantId,
  membershipId,
  deviceId,
  phase: "airborne",
  latitude: 55.618,
  longitude: 12.656,
  altitudeFeet: 3_000,
  groundSpeedKnots: 180,
  headingDegrees: 274,
  simulatorTime: now,
  sampleAt: now,
  sequence: 2,
  createdAt: now,
  updatedAt: now,
};

const oooiEvent: FlightOooiEvent = {
  id: "70000000-0000-4000-8000-000000000001",
  tenantId,
  flightId,
  eventType: "off",
  occurredAt: now,
  source: "telemetry",
  actorMembershipId: null,
  deviceId,
  reason: null,
  createdAt: now,
};

const sample = {
  flightId,
  sequence: 2,
  simulatorTime: now,
  phase: "airborne" as const,
  latitude: 55.618,
  longitude: 12.656,
  altitudeFeet: 3_000,
  groundSpeedKnots: 180,
  headingDegrees: 274,
};

describe("telemetry service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(now);
    resetEnvCache();
    loadEnv({ NODE_ENV: "test", TENANT_SECRETS_KEY: secretsKey });
    mocks.findSimulatorDeviceById.mockResolvedValue(device);
    mocks.findFlight.mockResolvedValue(flight);
    mocks.ingestFlightTelemetryAtomic.mockResolvedValue({
      status: "accepted",
      current,
      oooiEvent,
    });
    mocks.findCurrentFlightTelemetry.mockResolvedValue(current);
    mocks.correctOooiAtomic.mockResolvedValue(true);
    mocks.listOooiEvents.mockResolvedValue([oooiEvent]);
    mocks.listFlightTrack.mockResolvedValue([]);
    mocks.listCurrentFlightTelemetry.mockResolvedValue([]);
    mocks.revokeSimulatorDeviceAtomic.mockResolvedValue({
      ...device,
      status: "revoked",
      revokedAt: now,
    });
  });

  it("issues new simulator credentials only to pilots", async () => {
    await expect(
      createDevice(
        { tenantId, membershipId, role: "dispatcher" },
        "Dispatch workstation",
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.createSimulatorDeviceAtomic).not.toHaveBeenCalled();
  });

  it("authenticates and delegates ingestion, current/track, OOOI, provenance, and lease to one atomic write", async () => {
    const result = await ingestTelemetry(
      `Bearer v1.${deviceId}.${deviceSecret}`,
      sample,
    );

    expect(result).toMatchObject({
      presence: "online",
      current: { flightId, phase: "airborne", sequence: 2 },
      oooiEvents: [{ eventType: "off", source: "telemetry" }],
    });
    expect(mocks.ingestFlightTelemetryAtomic).toHaveBeenCalledWith({
      tenantId,
      membershipId,
      deviceId,
      flightId,
      minimumIntervalMs: 2_000,
      leaseMs: 120_000,
      sample: { ...sample, sampleAt: now },
    });
  });

  it("hides foreign or unassigned flight identities before any atomic write", async () => {
    mocks.findFlight.mockResolvedValue({
      ...flight,
      pilotMembershipId: "10000000-0000-4000-8000-000000000099",
    });

    await expect(
      ingestTelemetry(`Bearer v1.${deviceId}.${deviceSecret}`, sample),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.ingestFlightTelemetryAtomic).not.toHaveBeenCalled();
  });

  it("hides another pilot's flight and performs no telemetry reads", async () => {
    mocks.findFlight.mockResolvedValue({
      ...flight,
      pilotMembershipId: "10000000-0000-4000-8000-000000000099",
    });

    await expect(
      getFlightTelemetry(
        { tenantId, membershipId, role: "pilot" },
        flightId,
        100,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.findCurrentFlightTelemetry).not.toHaveBeenCalled();
    expect(mocks.listFlightTrack).not.toHaveBeenCalled();
    expect(mocks.listOooiEvents).not.toHaveBeenCalled();
  });

  it("reports a deterministic collision while another device owns the flight lease", async () => {
    mocks.ingestFlightTelemetryAtomic.mockResolvedValue({
      status: "lease_conflict",
      current: null,
      oooiEvent: null,
    });

    await expect(
      ingestTelemetry(`Bearer v1.${deviceId}.${deviceSecret}`, sample),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message:
        "Another simulator device holds the active writer lease for this flight",
    });
    expect(mocks.findCurrentFlightTelemetry).not.toHaveBeenCalled();
  });

  it("honors the atomic eligibility recheck when assignment state races", async () => {
    mocks.ingestFlightTelemetryAtomic.mockResolvedValue({
      status: "ineligible",
      current: null,
      oooiEvent: null,
    });

    await expect(
      ingestTelemetry(`Bearer v1.${deviceId}.${deviceSecret}`, sample),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message:
        "The assigned flight or pilot is no longer eligible for telemetry",
    });
  });

  it("fails generically when a credential is revoked after authentication", async () => {
    mocks.ingestFlightTelemetryAtomic.mockResolvedValue({
      status: "credential_invalid",
      current: null,
      oooiEvent: null,
    });

    await expect(
      ingestTelemetry(`Bearer v1.${deviceId}.${deviceSecret}`, sample),
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: "Simulator credential is no longer valid",
    });
  });

  it("rejects replayed or rate-limited samples before exposing current state", async () => {
    mocks.ingestFlightTelemetryAtomic.mockResolvedValue({
      status: "replay_or_rate",
      current: null,
      oooiEvent: null,
    });

    await expect(
      ingestTelemetry(`Bearer v1.${deviceId}.${deviceSecret}`, sample),
    ).rejects.toMatchObject({ status: 429 });
    expect(mocks.findCurrentFlightTelemetry).not.toHaveBeenCalled();
  });

  it("rejects revoked and malformed device credentials", async () => {
    mocks.findSimulatorDeviceById.mockResolvedValue({
      ...device,
      status: "revoked",
    });
    await expect(
      ingestTelemetry(`Bearer v1.${deviceId}.${deviceSecret}`, sample),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(ingestTelemetry("Bearer nope", sample)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("classifies online, stale, and disconnected heartbeats deterministically", () => {
    expect(presenceState(now, now)).toBe("online");
    expect(presenceState(new Date(now.getTime() - 60_000), now)).toBe("stale");
    expect(presenceState(new Date(now.getTime() - 180_000), now)).toBe(
      "disconnected",
    );
    expect(presenceState(null, now)).toBe("disconnected");
  });

  it("scopes the dispatcher monitoring snapshot to the authenticated tenant", async () => {
    mocks.listCurrentFlightTelemetry.mockResolvedValue([
      { ...current, sampleAt: new Date(now.getTime() - 60_000) },
    ]);

    const result = await listLiveTelemetry({
      tenantId,
      membershipId,
      role: "dispatcher",
    });

    expect(mocks.listCurrentFlightTelemetry).toHaveBeenCalledWith({ tenantId });
    expect(result).toMatchObject([{ flightId, presence: "stale" }]);
  });

  it("revokes only a device owned by the authenticated tenant member", async () => {
    const result = await revokeDevice(
      { tenantId, membershipId, role: "pilot" },
      deviceId,
    );

    expect(mocks.revokeSimulatorDeviceAtomic).toHaveBeenCalledWith({
      tenantId,
      membershipId,
      id: deviceId,
      revokedAt: now,
    });
    expect(result.status).toBe("revoked");
  });

  it("keeps manual correction, provenance, and audit inside the atomic repository operation", async () => {
    mocks.findFlight
      .mockResolvedValueOnce(flight)
      .mockResolvedValueOnce({ ...flight, onAt: now });

    const result = await correctOooi(
      { tenantId, membershipId, role: "dispatcher" },
      flightId,
      { onAt: now, reason: "Touchdown corrected from flight log" },
    );

    expect(mocks.correctOooiAtomic).toHaveBeenCalledWith({
      tenantId,
      flightId,
      actorMembershipId: membershipId,
      reason: "Touchdown corrected from flight log",
      outAt: undefined,
      offAt: undefined,
      onAt: now,
      inAt: undefined,
      operationAt: now,
    });
    expect(result.oooiEvents).toEqual([oooiEvent]);
  });

  it("surfaces a chronology conflict with no follow-up reads", async () => {
    mocks.correctOooiAtomic.mockResolvedValue(false);
    await expect(
      correctOooi({ tenantId, membershipId, role: "dispatcher" }, flightId, {
        onAt: new Date(now.getTime() - 5_000),
        reason: "Correction test",
      }),
    ).rejects.toMatchObject({ code: "UNPROCESSABLE" });
    expect(mocks.listOooiEvents).not.toHaveBeenCalled();
  });
});
