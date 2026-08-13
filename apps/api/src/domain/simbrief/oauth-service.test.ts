import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Membership, NavigraphOauthTransaction } from "../../db/schema.js";
import { decryptSecret } from "../../lib/crypto.js";

const mocks = vi.hoisted(() => ({
  findMembershipById: vi.fn(),
  updateMembership: vi.fn(),
  createTransaction: vi.fn(),
  consumeTransaction: vi.fn(),
  deleteExpiredTransactions: vi.fn(),
  writeAudit: vi.fn(),
  exchangeAuthorizationCode: vi.fn(),
  fetchUserInfo: vi.fn(),
  assertOptionalProcessingAllowed: vi.fn(),
}));

vi.mock("../privacy/service.js", () => ({
  assertOptionalProcessingAllowed: mocks.assertOptionalProcessingAllowed,
}));

vi.mock("../../db/repositories/memberships.js", () => ({
  findMembershipById: mocks.findMembershipById,
  updateMembership: mocks.updateMembership,
}));
vi.mock("../../db/repositories/navigraph-oauth.js", () => ({
  createNavigraphOauthTransaction: mocks.createTransaction,
  consumeNavigraphOauthTransaction: mocks.consumeTransaction,
  deleteExpiredNavigraphOauthTransactions: mocks.deleteExpiredTransactions,
}));
vi.mock("../../db/repositories/audit.js", () => ({
  writeAudit: mocks.writeAudit,
}));
vi.mock("../../navigraph/oauth-adapter.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../navigraph/oauth-adapter.js")>();
  return {
    ...actual,
    NavigraphOauthAdapter: class {
      exchangeAuthorizationCode = mocks.exchangeAuthorizationCode;
      fetchUserInfo = mocks.fetchUserInfo;
    },
  };
});

import { loadEnv, resetEnvCache } from "../../env.js";
import {
  completeNavigraphOauth,
  startNavigraphOauth,
} from "./oauth-service.js";

const now = new Date("2026-08-12T12:00:00.000Z");
const encryptionKey = Buffer.alloc(32, 7).toString("base64");
const redirectUri =
  "https://www.va-dispatcher.world/api/v1/simbrief/oauth/callback";
const actor = {
  tenantId: "20000000-0000-4000-8000-000000000001",
  membershipId: "10000000-0000-4000-8000-000000000001",
  role: "pilot" as const,
};
const membership: Membership = {
  id: actor.membershipId,
  tenantId: actor.tenantId,
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

afterEach(() => {
  vi.useRealTimers();
});

describe("Navigraph OAuth service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(now);
    resetEnvCache();
    loadEnv({
      NODE_ENV: "test",
      TENANT_SECRETS_KEY: encryptionKey,
      NAVIGRAPH_CLIENT_ID: "client-id",
      NAVIGRAPH_CLIENT_SECRET: "client-secret",
      NAVIGRAPH_REDIRECT_URI: redirectUri,
    });
    mocks.findMembershipById.mockResolvedValue(membership);
    mocks.assertOptionalProcessingAllowed.mockResolvedValue(undefined);
    mocks.updateMembership.mockImplementation(
      async (_tenantId: string, _membershipId: string, patch: object) => ({
        ...membership,
        ...patch,
      }),
    );
    mocks.exchangeAuthorizationCode.mockResolvedValue({
      accessToken: "short-lived-access-token",
      tokenType: "Bearer",
      expiresIn: 3_600,
      scope: "openid userinfo",
    });
    mocks.fetchUserInfo.mockResolvedValue({
      subject: "02d8aa80-d17f-4424-a85d-a42329217cb3",
      username: "TestPilot",
    });
  });

  it("creates sealed server-authenticated state with a valid S256 PKCE challenge", async () => {
    const result = await startNavigraphOauth(actor);
    const authorizationUrl = new URL(result.authorizationUrl);
    const state = authorizationUrl.searchParams.get("state")!;
    const [version] = state.split(".");
    const transactionInput = mocks.createTransaction.mock.calls[0]?.[0] as {
      tenantId: string;
      membershipId: string;
      stateId: string;
      codeVerifierEnc: string;
      expiresAt: Date;
    };
    const codeVerifier = decryptSecret(
      transactionInput.codeVerifierEnc,
      encryptionKey,
    );
    const expectedChallenge = createHash("sha256")
      .update(codeVerifier)
      .digest("base64url");

    expect(state).toMatch(
      /^v2\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{58}$/,
    );
    expect(version).toBe("v2");
    expect(transactionInput).toMatchObject({
      tenantId: actor.tenantId,
      membershipId: actor.membershipId,
      expiresAt: new Date("2026-08-12T12:10:00.000Z"),
    });
    expect(transactionInput.stateId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(state).not.toContain(transactionInput.stateId);
    expect(transactionInput.codeVerifierEnc).not.toContain(codeVerifier);
    expect(codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(authorizationUrl.searchParams.get("code_challenge")).toBe(
      expectedChallenge,
    );
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(redirectUri);
    expect(result.redirectUri).toBe(redirectUri);
    expect(result.expiresAt).toEqual(new Date("2026-08-12T12:10:00.000Z"));
  });

  it("consumes state, exchanges the code, and persists identity without tokens", async () => {
    const started = await startNavigraphOauth(actor);
    const authorizationUrl = new URL(started.authorizationUrl);
    const state = authorizationUrl.searchParams.get("state")!;
    const transactionInput = mocks.createTransaction.mock.calls.at(-1)?.[0] as {
      stateId: string;
      codeVerifierEnc: string;
      expiresAt: Date;
    };
    const transaction: NavigraphOauthTransaction = {
      id: "30000000-0000-4000-8000-000000000001",
      tenantId: actor.tenantId,
      membershipId: actor.membershipId,
      stateId: transactionInput.stateId,
      codeVerifierEnc: transactionInput.codeVerifierEnc,
      expiresAt: transactionInput.expiresAt,
      consumedAt: now,
      createdAt: now,
    };
    mocks.consumeTransaction.mockResolvedValue(transaction);

    const result = await completeNavigraphOauth({
      state,
      code: "authorization-code",
    });

    expect(mocks.consumeTransaction).toHaveBeenCalledWith(
      transactionInput.stateId,
      now,
    );
    expect(mocks.exchangeAuthorizationCode).toHaveBeenCalledWith({
      clientId: "client-id",
      clientSecret: "client-secret",
      redirectUri,
      code: "authorization-code",
      codeVerifier: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    });
    expect(mocks.fetchUserInfo).toHaveBeenCalledWith(
      "short-lived-access-token",
    );
    expect(mocks.updateMembership).toHaveBeenCalledWith(
      actor.tenantId,
      actor.membershipId,
      {
        navigraphSubject: "02d8aa80-d17f-4424-a85d-a42329217cb3",
        navigraphUsername: "TestPilot",
        navigraphConnectedAt: now,
      },
    );
    const persisted = mocks.updateMembership.mock.calls[0]?.[2];
    expect(persisted).not.toHaveProperty("accessToken");
    expect(persisted).not.toHaveProperty("refreshToken");
    expect(result.navigraphUsername).toBe("TestPilot");
  });

  it("rejects a replayed or expired state before contacting Navigraph", async () => {
    const started = await startNavigraphOauth(actor);
    const state = new URL(started.authorizationUrl).searchParams.get("state")!;
    mocks.consumeTransaction.mockResolvedValue(null);

    await expect(
      completeNavigraphOauth({ state, code: "code" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(mocks.exchangeAuthorizationCode).not.toHaveBeenCalled();
  });

  it("rejects tampered state before querying the transaction store", async () => {
    const started = await startNavigraphOauth(actor);
    const state = new URL(started.authorizationUrl).searchParams.get("state")!;
    const tamperIndex = state.length - 2;
    const replacement = state[tamperIndex] === "A" ? "B" : "A";
    const tampered =
      state.slice(0, tamperIndex) + replacement + state.slice(tamperIndex + 1);
    mocks.consumeTransaction.mockClear();

    await expect(
      completeNavigraphOauth({ state: tampered, code: "code" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(mocks.consumeTransaction).not.toHaveBeenCalled();
    expect(mocks.exchangeAuthorizationCode).not.toHaveBeenCalled();
  });

  it("rejects an insecure production redirect before creating state", async () => {
    resetEnvCache();
    loadEnv({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://user:pass@localhost/va_dispatch",
      CLERK_SECRET_KEY: "sk_test_configured",
      TENANT_SECRETS_KEY: encryptionKey,
      CRON_SECRET: "production-cron-secret",
      NAVIGRAPH_CLIENT_ID: "client-id",
      NAVIGRAPH_CLIENT_SECRET: "client-secret",
      NAVIGRAPH_REDIRECT_URI:
        "http://www.va-dispatcher.world/api/v1/simbrief/oauth/callback",
    });

    await expect(startNavigraphOauth(actor)).rejects.toMatchObject({
      code: "INTERNAL",
      status: 503,
    });
    expect(mocks.createTransaction).not.toHaveBeenCalled();
  });
});
