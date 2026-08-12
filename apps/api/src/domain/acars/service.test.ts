import { beforeEach, describe, expect, it, vi } from "vitest";
import { AcarsProviderError } from "../../acars/types.js";
import type { Tenant } from "../../db/schema.js";

const mocks = vi.hoisted(() => ({
  sendTelex: vi.fn(),
  poll: vi.fn(),
  insertAcarsMessage: vi.fn(),
  updateAcarsDelivery: vi.fn(),
  findAcarsMessage: vi.fn(),
  listAcarsMessages: vi.fn(),
  enqueueMockAcars: vi.fn(),
  writeAudit: vi.fn(),
  findTenantById: vi.fn(),
  listHoppieTenants: vi.fn(),
  findFlight: vi.fn(),
  providerFactoryError: null as Error | null,
  assertOptionalProcessingAllowed: vi.fn(),
}));

vi.mock("../privacy/service.js", () => ({
  assertOptionalProcessingAllowed: mocks.assertOptionalProcessingAllowed,
}));

vi.mock("../../acars/factory.js", () => ({
  createAcarsProvider: () => {
    if (mocks.providerFactoryError) throw mocks.providerFactoryError;
    return {
      name: "hoppie",
      sendTelex: mocks.sendTelex,
      poll: mocks.poll,
    };
  },
  isMockAcarsEnabled: () => false,
}));
vi.mock("../../db/repositories/acars.js", () => ({
  insertAcarsMessage: mocks.insertAcarsMessage,
  updateAcarsDelivery: mocks.updateAcarsDelivery,
  findAcarsMessage: mocks.findAcarsMessage,
  listAcarsMessages: mocks.listAcarsMessages,
  enqueueMockAcars: mocks.enqueueMockAcars,
}));
vi.mock("../../db/repositories/audit.js", () => ({
  writeAudit: mocks.writeAudit,
}));
vi.mock("../../db/repositories/tenants.js", () => ({
  findTenantById: mocks.findTenantById,
  listHoppieTenants: mocks.listHoppieTenants,
}));
vi.mock("../../db/repositories/flights.js", () => ({
  findFlight: mocks.findFlight,
}));

import { sendTelex, simulateInbound } from "./service.js";

const tenant: Tenant = {
  id: "tenant_test",
  slug: "vsas",
  name: "Virtual SAS",
  clerkOrgId: "org_test",
  hoppieStation: "SAS",
  hoppieLogonEnc: "encrypted",
  brandSeedColor: "#e64646",
  brandPresence: "balanced",
  brandLogoUrl: null,
  brandLogoPathname: null,
  settings: {},
  createdAt: new Date("2026-08-12T00:00:00.000Z"),
  updatedAt: new Date("2026-08-12T00:00:00.000Z"),
};

describe("ACARS service outbound delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.providerFactoryError = null;
    mocks.assertOptionalProcessingAllowed.mockResolvedValue(undefined);
    mocks.findTenantById.mockResolvedValue(tenant);
    mocks.findFlight.mockResolvedValue({ id: "flight_test" });
    mocks.insertAcarsMessage.mockImplementation(async (input) => ({
      id: "message_test",
      ...input,
    }));
    mocks.updateAcarsDelivery.mockImplementation(async (input) => ({
      id: input.id,
      deliveryStatus: input.status,
    }));
  });

  it("fails safely before sending when Hoppie is not configured", async () => {
    mocks.providerFactoryError = new AcarsProviderError(
      "not_configured",
      "Hoppie ACARS is not configured for this Virtual Airline.",
    );

    await expect(
      sendTelex({
        tenantId: tenant.id,
        membershipId: "membership_test",
        to: "SAS123",
        body: "GATE 12",
      }),
    ).rejects.toMatchObject({
      code: "UNPROCESSABLE",
      status: 422,
      details: { provider: "hoppie", reason: "not_configured" },
    });
    expect(mocks.sendTelex).not.toHaveBeenCalled();
    expect(mocks.insertAcarsMessage).not.toHaveBeenCalled();
  });

  it("does not expose the inbound simulator outside mock development", async () => {
    await expect(
      simulateInbound({
        tenantId: tenant.id,
        from: "SAS123",
        body: "TEST",
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
    expect(mocks.enqueueMockAcars).not.toHaveBeenCalled();
  });

  it("records a rejected outbound result without asking the client to guess", async () => {
    mocks.sendTelex.mockRejectedValue(
      new AcarsProviderError(
        "authentication",
        "Hoppie rejected the logon code.",
      ),
    );

    await expect(
      sendTelex({
        tenantId: tenant.id,
        membershipId: "membership_test",
        to: "SAS123",
        body: "GATE 12",
      }),
    ).resolves.toMatchObject({
      id: "message_test",
      deliveryStatus: "rejected",
    });
    expect(mocks.insertAcarsMessage).toHaveBeenCalledWith(
      expect.objectContaining({ deliveryStatus: "pending" }),
    );
    expect(mocks.updateAcarsDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ status: "rejected" }),
    );
    expect(mocks.writeAudit).toHaveBeenCalledOnce();
  });

  it("stores pending before provider I/O and then records acceptance", async () => {
    mocks.sendTelex.mockResolvedValue({ ok: true, raw: "ok" });

    const result = await sendTelex({
      tenantId: tenant.id,
      membershipId: "membership_test",
      to: "sas123",
      body: "GATE 12",
    });

    expect(result.id).toBe("message_test");
    expect(mocks.insertAcarsMessage.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.sendTelex.mock.invocationCallOrder[0]!,
    );
    expect(mocks.insertAcarsMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        fromStation: "SAS",
        toStation: "SAS123",
        provider: "hoppie",
        deliveryStatus: "pending",
      }),
    );
    expect(mocks.updateAcarsDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ status: "accepted", hoppieRaw: "ok" }),
    );
    expect(mocks.writeAudit).toHaveBeenCalledOnce();
  });

  it("records a timeout as ambiguous and never retries automatically", async () => {
    mocks.sendTelex.mockRejectedValue(
      new AcarsProviderError("timeout", "Hoppie timed out"),
    );

    await expect(
      sendTelex({
        tenantId: tenant.id,
        membershipId: "membership_test",
        to: "SAS123",
        body: "GATE 12",
      }),
    ).resolves.toMatchObject({ deliveryStatus: "ambiguous" });
    expect(mocks.sendTelex).toHaveBeenCalledOnce();
    expect(mocks.updateAcarsDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ status: "ambiguous" }),
    );
  });

  it("rejects an unknown or cross-tenant flight before contacting Hoppie", async () => {
    mocks.findFlight.mockResolvedValue(null);

    await expect(
      sendTelex({
        tenantId: tenant.id,
        membershipId: "membership_test",
        to: "SAS123",
        body: "GATE 12",
        flightId: "11111111-1111-4111-8111-111111111111",
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
    expect(mocks.findFlight).toHaveBeenCalledWith(
      tenant.id,
      "11111111-1111-4111-8111-111111111111",
    );
    expect(mocks.sendTelex).not.toHaveBeenCalled();
    expect(mocks.insertAcarsMessage).not.toHaveBeenCalled();
  });
});
