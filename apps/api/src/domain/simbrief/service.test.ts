import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Flight, Membership, SimbriefDispatch } from "../../db/schema.js";

const mocks = vi.hoisted(() => ({
  findFlight: vi.fn(),
  findMembershipById: vi.fn(),
  updateMembership: vi.fn(),
  markSimbriefVerified: vi.fn(),
  createSimbriefDispatch: vi.fn(),
  startSimbriefDispatch: vi.fn(),
  listSimbriefDispatches: vi.fn(),
  findSimbriefDispatch: vi.fn(),
  findLatestSimbriefDispatch: vi.fn(),
  findSimbriefDispatchForCallback: vi.fn(),
  completeSimbriefDispatch: vi.fn(),
  recordSimbriefSyncError: vi.fn(),
  writeAudit: vi.fn(),
  buildDispatchUrl: vi.fn(),
  fetchFlightPlan: vi.fn(),
}));

vi.mock("../../db/repositories/flights.js", () => ({
  findFlight: mocks.findFlight,
}));
vi.mock("../../db/repositories/memberships.js", () => ({
  findMembershipById: mocks.findMembershipById,
  updateMembership: mocks.updateMembership,
  markSimbriefVerified: mocks.markSimbriefVerified,
}));
vi.mock("../../db/repositories/simbrief.js", () => ({
  createSimbriefDispatch: mocks.createSimbriefDispatch,
  startSimbriefDispatch: mocks.startSimbriefDispatch,
  listSimbriefDispatches: mocks.listSimbriefDispatches,
  findSimbriefDispatch: mocks.findSimbriefDispatch,
  findLatestSimbriefDispatch: mocks.findLatestSimbriefDispatch,
  findSimbriefDispatchForCallback: mocks.findSimbriefDispatchForCallback,
  completeSimbriefDispatch: mocks.completeSimbriefDispatch,
  recordSimbriefSyncError: mocks.recordSimbriefSyncError,
}));
vi.mock("../../db/repositories/audit.js", () => ({
  writeAudit: mocks.writeAudit,
}));
vi.mock("../../simbrief/adapter.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../simbrief/adapter.js")>();
  return {
    ...actual,
    buildSimbriefDispatchUrl: mocks.buildDispatchUrl,
    SimbriefAdapter: class {
      fetchFlightPlan = mocks.fetchFlightPlan;
    },
  };
});

import { loadEnv, resetEnvCache } from "../../env.js";
import { simbriefDispatchOptionsSchema } from "./validation.js";
import {
  completeDispatchCallback,
  disconnectAccount,
  generateDispatch,
  prepareDispatch,
} from "./service.js";

const now = new Date("2026-08-12T12:00:00.000Z");

const membership: Membership = {
  id: "10000000-0000-4000-8000-000000000001",
  tenantId: "20000000-0000-4000-8000-000000000001",
  clerkUserId: "user_test",
  role: "pilot",
  displayName: "Test Pilot",
  pilotCallsign: "SAS123",
  simbriefUserId: "123456",
  simbriefVerifiedAt: null,
  navigraphSubject: null,
  navigraphUsername: null,
  navigraphConnectedAt: null,
  status: "active",
  createdAt: now,
  updatedAt: now,
};

const flight: Flight = {
  id: "30000000-0000-4000-8000-000000000001",
  tenantId: membership.tenantId,
  scheduleRequestId: null,
  replacesFlightId: null,
  pilotMembershipId: membership.id,
  flightNumber: "SK935",
  depIcao: "EKCH",
  arrIcao: "KSFO",
  etd: new Date("2026-08-13T10:05:00.000Z"),
  eta: new Date("2026-08-13T21:35:00.000Z"),
  aircraftType: "A359",
  version: 1,
  status: "accepted",
  cancelReason: null,
  declinedReason: null,
  dispatcherNotes: null,
  assignmentRevision: 1,
  assignmentConfirmedRevision: 1,
  assignmentConfirmedAt: now,
  outAt: null,
  offAt: null,
  onAt: null,
  inAt: null,
  createdAt: now,
  updatedAt: now,
};

function preparedDispatch(
  overrides: Partial<SimbriefDispatch> = {},
): SimbriefDispatch {
  return {
    id: "40000000-0000-4000-8000-000000000001",
    tenantId: membership.tenantId,
    flightId: flight.id,
    createdByMembershipId: membership.id,
    generatedByMembershipId: null,
    simbriefUserId: null,
    staticId: "VAD_40000000000040008000000000000001",
    callbackTokenMac: null,
    status: "prepared",
    request: {
      orig: "EKCH",
      dest: "KSFO",
      type: "A359",
      dxname: "Test Pilot",
      manualrmk: "Use runway 28",
    },
    ofp: null,
    simbriefRequestId: null,
    generatedAt: null,
    syncedAt: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

afterEach(() => vi.useRealTimers());

describe("SimBrief dispatch service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(now);
    resetEnvCache();
    loadEnv({
      NODE_ENV: "test",
      TENANT_SECRETS_KEY: Buffer.alloc(32, 7).toString("base64"),
      SIMBRIEF_API_KEY: "server-secret",
      SIMBRIEF_CALLBACK_URL: "https://api.example.com/api/v1/simbrief/callback",
    });
    mocks.findFlight.mockResolvedValue(flight);
    mocks.findMembershipById.mockResolvedValue(membership);
    mocks.buildDispatchUrl.mockReturnValue(
      "https://www.simbrief.com/ofp/ofp.loader.api.php?signed=1",
    );
    mocks.createSimbriefDispatch.mockImplementation(
      async (input: Parameters<typeof preparedDispatch>[0]) =>
        preparedDispatch(input),
    );
  });

  it("lets dispatch save canonical inputs with trusted attribution but no pilot account side effect", async () => {
    const result = await prepareDispatch(
      {
        tenantId: membership.tenantId,
        membershipId: membership.id,
        role: "dispatcher",
      },
      flight.id,
      simbriefDispatchOptionsSchema.parse({
        route: "NIKDA DCT",
        passengers: 250,
        notams: true,
        customRemarks: "Use runway 28",
      }),
    );

    expect(result.status).toBe("prepared");
    expect(mocks.createSimbriefDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: membership.tenantId,
        flightId: flight.id,
        createdByMembershipId: membership.id,
        simbriefUserId: null,
        callbackTokenMac: null,
        status: "prepared",
        request: expect.objectContaining({
          orig: "EKCH",
          dest: "KSFO",
          route: "NIKDA DCT",
          pax: "250",
          notams: "1",
          dxname: "Test Pilot",
          manualrmk: "Use runway 28",
        }),
      }),
    );
    expect(mocks.buildDispatchUrl).not.toHaveBeenCalled();
  });

  it("does not accept a forgeable dispatcher name option", () => {
    expect(
      simbriefDispatchOptionsSchema.safeParse({ dispatcherName: "Attacker" })
        .success,
    ).toBe(false);
  });

  it("lets only the assigned pilot launch a prepared plan in their account", async () => {
    const prepared = preparedDispatch();
    mocks.findSimbriefDispatch.mockResolvedValue(prepared);
    mocks.startSimbriefDispatch.mockImplementation(async (input) =>
      preparedDispatch({
        status: "pending",
        generatedByMembershipId: input.generatedByMembershipId,
        simbriefUserId: input.simbriefUserId,
        callbackTokenMac: input.callbackTokenMac,
        request: input.request,
      }),
    );

    const result = await generateDispatch(
      {
        tenantId: membership.tenantId,
        membershipId: membership.id,
        role: "pilot",
      },
      flight.id,
      prepared.id,
    );

    expect(result.dispatchUrl).toContain("signed=1");
    expect(mocks.startSimbriefDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: membership.tenantId,
        flightId: flight.id,
        generatedByMembershipId: membership.id,
        simbriefUserId: "123456",
        request: expect.objectContaining({
          userid: "123456",
          pid: "123456",
          dxname: "Test Pilot",
        }),
      }),
    );
    const outputPage = new URL(
      String(mocks.buildDispatchUrl.mock.calls[0]?.[0].outputPage),
    );
    expect(outputPage.searchParams.get("dispatchId")).toBe(prepared.id);
    expect(outputPage.searchParams.get("token")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("prevents a dispatcher from generating into their account for another pilot", async () => {
    const prepared = preparedDispatch();
    mocks.findFlight.mockResolvedValue({
      ...flight,
      pilotMembershipId: "10000000-0000-4000-8000-000000000099",
    });
    mocks.findSimbriefDispatch.mockResolvedValue(prepared);

    await expect(
      generateDispatch(
        {
          tenantId: membership.tenantId,
          membershipId: membership.id,
          role: "dispatcher",
        },
        flight.id,
        prepared.id,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.startSimbriefDispatch).not.toHaveBeenCalled();
  });

  it("requires the assigned pilot to connect a SimBrief Pilot ID", async () => {
    mocks.findMembershipById.mockResolvedValue({
      ...membership,
      simbriefUserId: null,
    });
    mocks.findSimbriefDispatch.mockResolvedValue(preparedDispatch());

    await expect(
      generateDispatch(
        {
          tenantId: membership.tenantId,
          membershipId: membership.id,
          role: "pilot",
        },
        flight.id,
        preparedDispatch().id,
      ),
    ).rejects.toMatchObject({ code: "UNPROCESSABLE" });
  });

  it("disconnects both the numeric Pilot ID and Navigraph OAuth identity", async () => {
    mocks.updateMembership.mockResolvedValue({
      ...membership,
      simbriefUserId: null,
      simbriefVerifiedAt: null,
      navigraphSubject: null,
      navigraphUsername: null,
      navigraphConnectedAt: null,
    });

    await disconnectAccount({
      tenantId: membership.tenantId,
      membershipId: membership.id,
      role: "pilot",
    });

    expect(mocks.updateMembership).toHaveBeenCalledWith(
      membership.tenantId,
      membership.id,
      {
        simbriefUserId: null,
        simbriefVerifiedAt: null,
        navigraphSubject: null,
        navigraphUsername: null,
        navigraphConnectedAt: null,
      },
    );
  });

  it("accepts the one-time callback and verifies the generating pilot", async () => {
    const callbackToken = "callback-token";
    const { createTokenMac } = await import("../../lib/crypto.js");
    const generated = preparedDispatch({
      status: "pending",
      generatedByMembershipId: membership.id,
      simbriefUserId: "123456",
      callbackTokenMac: createTokenMac(
        callbackToken,
        Buffer.alloc(32, 7).toString("base64"),
        "simbrief-dispatch-callback",
      ),
    });
    mocks.findSimbriefDispatchForCallback.mockResolvedValue(generated);
    const ofp = { params: { request_id: "request_123" } };
    mocks.fetchFlightPlan.mockResolvedValue({
      ofp,
      requestId: "request_123",
      generatedAt: now,
    });
    const ready = preparedDispatch({
      ...generated,
      status: "ready",
      ofp,
      callbackTokenMac: null,
      simbriefRequestId: "request_123",
      generatedAt: now,
      syncedAt: now,
    });
    mocks.completeSimbriefDispatch.mockResolvedValue(ready);

    await expect(
      completeDispatchCallback(generated.id, callbackToken),
    ).resolves.toEqual(ready);
    expect(mocks.markSimbriefVerified).toHaveBeenCalledWith({
      tenantId: membership.tenantId,
      membershipId: membership.id,
      simbriefUserId: "123456",
      verifiedAt: now,
    });
  });

  it("rejects a leaked callback authenticator before fetching an OFP", async () => {
    const generated = preparedDispatch({
      status: "pending",
      simbriefUserId: "123456",
      callbackTokenMac: "a".repeat(43),
    });
    mocks.findSimbriefDispatchForCallback.mockResolvedValue(generated);

    await expect(
      completeDispatchCallback(generated.id, generated.callbackTokenMac!),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(mocks.fetchFlightPlan).not.toHaveBeenCalled();
  });
});
