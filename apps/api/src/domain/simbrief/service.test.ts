import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Flight, Membership, SimbriefDispatch } from "../../db/schema.js";

const mocks = vi.hoisted(() => ({
  findFlight: vi.fn(),
  findMembershipById: vi.fn(),
  updateMembership: vi.fn(),
  markSimbriefVerified: vi.fn(),
  createSimbriefDispatch: vi.fn(),
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
  createDispatch,
  disconnectAccount,
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
  pilotMembershipId: membership.id,
  flightNumber: "SK935",
  depIcao: "EKCH",
  arrIcao: "KSFO",
  etd: new Date("2026-08-13T10:05:00.000Z"),
  eta: new Date("2026-08-13T21:35:00.000Z"),
  aircraftType: "A359",
  status: "accepted",
  cancelReason: null,
  declinedReason: null,
  dispatcherNotes: null,
  outAt: null,
  offAt: null,
  onAt: null,
  inAt: null,
  createdAt: now,
  updatedAt: now,
};

afterEach(() => {
  vi.useRealTimers();
});

describe("SimBrief dispatch service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(now);
    resetEnvCache();
    loadEnv({
      NODE_ENV: "test",
      SIMBRIEF_API_KEY: "server-secret",
      SIMBRIEF_CALLBACK_URL: "https://api.example.com/api/v1/simbrief/callback",
    });
    mocks.findFlight.mockResolvedValue(flight);
    mocks.findMembershipById.mockResolvedValue(membership);
    mocks.buildDispatchUrl.mockReturnValue(
      "https://www.simbrief.com/ofp/ofp.loader.api.php?signed=1",
    );
    mocks.createSimbriefDispatch.mockImplementation(
      async (input: {
        id: string;
        tenantId: string;
        flightId: string;
        createdByMembershipId: string;
        simbriefUserId: string;
        staticId: string;
        callbackTokenHash: string;
        request: Record<string, string>;
      }): Promise<SimbriefDispatch> => ({
        ...input,
        status: "pending",
        ofp: null,
        simbriefRequestId: null,
        generatedAt: null,
        syncedAt: null,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      }),
    );
  });

  it("lets the assigned pilot create a signed dispatch from the stored flight", async () => {
    const result = await createDispatch(
      {
        tenantId: membership.tenantId,
        membershipId: membership.id,
        role: "pilot",
      },
      flight.id,
      simbriefDispatchOptionsSchema.parse({
        route: "NIKDA DCT",
        passengers: 250,
        notams: true,
      }),
    );

    expect(result.dispatchUrl).toContain("signed=1");
    expect(mocks.createSimbriefDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: membership.tenantId,
        flightId: flight.id,
        createdByMembershipId: membership.id,
        simbriefUserId: "123456",
        callbackTokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        request: expect.objectContaining({
          orig: "EKCH",
          dest: "KSFO",
          type: "A359",
          fltnum: "SK935",
          date: "13AUG26",
          deph: "10",
          depm: "05",
          steh: "11",
          stem: "30",
          route: "NIKDA DCT",
          pax: "250",
          notams: "1",
          units: "KGS",
        }),
      }),
    );
    const signingInput = mocks.buildDispatchUrl.mock.calls[0]?.[0];
    const outputPage = new URL(String(signingInput.outputPage));
    expect(outputPage.origin + outputPage.pathname).toBe(
      "https://api.example.com/api/v1/simbrief/callback",
    );
    expect(outputPage.searchParams.get("dispatchId")).toBe(result.dispatch.id);
    expect(outputPage.searchParams.get("token")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.dispatch.request).not.toHaveProperty("outputpage");
    expect(result.dispatch.request).not.toHaveProperty("apicode");
  });

  it("lets a dispatcher create a plan for another member's flight", async () => {
    mocks.findFlight.mockResolvedValue({
      ...flight,
      pilotMembershipId: "10000000-0000-4000-8000-000000000099",
    });

    await expect(
      createDispatch(
        {
          tenantId: membership.tenantId,
          membershipId: membership.id,
          role: "dispatcher",
        },
        flight.id,
        simbriefDispatchOptionsSchema.parse({}),
      ),
    ).resolves.toMatchObject({
      dispatch: { status: "pending" },
    });
  });

  it("does not let a pilot create a plan for another member's flight", async () => {
    mocks.findFlight.mockResolvedValue({
      ...flight,
      pilotMembershipId: "10000000-0000-4000-8000-000000000099",
    });

    await expect(
      createDispatch(
        {
          tenantId: membership.tenantId,
          membershipId: membership.id,
          role: "pilot",
        },
        flight.id,
        simbriefDispatchOptionsSchema.parse({}),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.createSimbriefDispatch).not.toHaveBeenCalled();
  });

  it("requires the actor to connect a SimBrief Pilot ID", async () => {
    mocks.findMembershipById.mockResolvedValue({
      ...membership,
      simbriefUserId: null,
    });

    await expect(
      createDispatch(
        {
          tenantId: membership.tenantId,
          membershipId: membership.id,
          role: "pilot",
        },
        flight.id,
        simbriefDispatchOptionsSchema.parse({}),
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

  it("accepts the one-time callback and verifies the linked account after a matching OFP", async () => {
    const created = await createDispatch(
      {
        tenantId: membership.tenantId,
        membershipId: membership.id,
        role: "pilot",
      },
      flight.id,
      simbriefDispatchOptionsSchema.parse({}),
    );
    const signingInput = mocks.buildDispatchUrl.mock.calls[0]?.[0];
    const token = new URL(String(signingInput.outputPage)).searchParams.get(
      "token",
    )!;
    mocks.findSimbriefDispatchForCallback.mockResolvedValue(created.dispatch);
    const ofp = {
      params: { request_id: "request_123" },
      origin: { icao_code: "EKCH" },
      destination: { icao_code: "KSFO" },
    };
    mocks.fetchFlightPlan.mockResolvedValue({
      ofp,
      requestId: "request_123",
      generatedAt: new Date("2026-08-12T12:01:00.000Z"),
    });
    const ready = {
      ...created.dispatch,
      status: "ready" as const,
      ofp,
      callbackTokenHash: null,
      simbriefRequestId: "request_123",
      generatedAt: new Date("2026-08-12T12:01:00.000Z"),
      syncedAt: now,
    };
    mocks.completeSimbriefDispatch.mockResolvedValue(ready);

    await expect(
      completeDispatchCallback(created.dispatch.id, token),
    ).resolves.toEqual(ready);
    expect(mocks.fetchFlightPlan).toHaveBeenCalledWith({
      userId: "123456",
      staticId: created.dispatch.staticId,
      origin: "EKCH",
      destination: "KSFO",
    });
    expect(mocks.markSimbriefVerified).toHaveBeenCalledWith({
      tenantId: membership.tenantId,
      membershipId: membership.id,
      simbriefUserId: "123456",
      verifiedAt: now,
    });
  });
});
