import { beforeEach, describe, expect, it, vi } from "vitest";
import { AcarsProviderError } from "../../acars/types.js";
import type { Tenant } from "../../db/schema.js";

const mocks = vi.hoisted(() => ({
  sendTelex: vi.fn(),
  poll: vi.fn(),
  insertAcarsMessage: vi.fn(),
  findAcarsMessage: vi.fn(),
  listAcarsMessages: vi.fn(),
  enqueueMockAcars: vi.fn(),
  writeAudit: vi.fn(),
  findTenantById: vi.fn(),
  listHoppieTenants: vi.fn(),
}));

vi.mock("../../acars/factory.js", () => ({
  createAcarsProvider: () => ({
    name: "hoppie",
    sendTelex: mocks.sendTelex,
    poll: mocks.poll,
  }),
  tenantAcarsProviderName: () => "hoppie",
}));
vi.mock("../../db/repositories/acars.js", () => ({
  insertAcarsMessage: mocks.insertAcarsMessage,
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

import { sendTelex } from "./service.js";

const tenant: Tenant = {
  id: "tenant_test",
  slug: "vsas",
  name: "Virtual SAS",
  clerkOrgId: "org_test",
  hoppieStation: "SAS",
  hoppieLogonEnc: "encrypted",
  settings: {},
  createdAt: new Date("2026-08-12T00:00:00.000Z"),
  updatedAt: new Date("2026-08-12T00:00:00.000Z"),
};

describe("ACARS service outbound delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findTenantById.mockResolvedValue(tenant);
  });

  it("does not store an outbound record when Hoppie rejects it", async () => {
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
    ).rejects.toMatchObject({
      code: "UPSTREAM",
      status: 502,
      details: { provider: "hoppie", reason: "authentication" },
    });
    expect(mocks.insertAcarsMessage).not.toHaveBeenCalled();
    expect(mocks.writeAudit).not.toHaveBeenCalled();
  });

  it("stores the message only after provider acceptance", async () => {
    mocks.sendTelex.mockResolvedValue({ ok: true, raw: "ok" });
    mocks.insertAcarsMessage.mockImplementation(async (input) => ({
      id: "message_test",
      ...input,
    }));

    const result = await sendTelex({
      tenantId: tenant.id,
      membershipId: "membership_test",
      to: "sas123",
      body: "GATE 12",
    });

    expect(result.id).toBe("message_test");
    expect(mocks.insertAcarsMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        fromStation: "SAS",
        toStation: "SAS123",
        provider: "hoppie",
        hoppieRaw: "ok",
      }),
    );
    expect(mocks.writeAudit).toHaveBeenCalledOnce();
  });
});
