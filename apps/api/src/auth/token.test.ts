import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { loadEnv, resetEnvCache } from "../env.js";
import { AppError } from "../lib/errors.js";
import { setAccessTokenKeysForTests, verifyAccessToken } from "./token.js";

const ISSUER = "https://auth.example.test";
const AUDIENCE = "va-dispatch-api";

let privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];

async function token(
  claims: Record<string, unknown>,
  options: { issuer?: string; audience?: string; subject?: string | null } = {},
) {
  const jwt = new SignJWT(claims)
    .setProtectedHeader({ alg: "ES256", kid: "test" })
    .setIssuer(options.issuer ?? ISSUER)
    .setAudience(options.audience ?? AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("5m");
  if (options.subject !== null) jwt.setSubject(options.subject ?? "user_1");
  return jwt.sign(privateKey);
}

describe("access token verification", () => {
  beforeAll(async () => {
    const pair = await generateKeyPair("ES256");
    privateKey = pair.privateKey;
    const jwk = {
      ...(await exportJWK(pair.publicKey)),
      kid: "test",
      alg: "ES256",
    };
    setAccessTokenKeysForTests(createLocalJWKSet({ keys: [jwk] }));
  });

  beforeEach(() => {
    resetEnvCache();
    loadEnv({ NODE_ENV: "test", AUTH_ISSUER: ISSUER, AUTH_AUDIENCE: AUDIENCE });
  });

  afterEach(() => resetEnvCache());

  it("returns the user, active organization, and role", async () => {
    await expect(
      verifyAccessToken(
        await token({ org_id: "org_1", org_role: "org:dispatcher" }),
      ),
    ).resolves.toEqual({
      userId: "user_1",
      orgId: "org_1",
      orgRole: "org:dispatcher",
    });
  });

  it("accepts a token without an active organization", async () => {
    await expect(verifyAccessToken(await token({}))).resolves.toEqual({
      userId: "user_1",
      orgId: null,
      orgRole: null,
    });
  });

  it.each([
    ["a foreign issuer", { issuer: "https://evil.example.test" }],
    ["a foreign audience", { audience: "another-api" }],
    ["no subject", { subject: null }],
  ])("rejects a token with %s", async (_label, options) => {
    const result = verifyAccessToken(await token({ org_id: "org_1" }, options));
    await expect(result).rejects.toBeInstanceOf(AppError);
    await expect(result).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("fails closed when the identity provider is not configured", async () => {
    resetEnvCache();
    loadEnv({ NODE_ENV: "test" });
    await expect(verifyAccessToken(await token({}))).rejects.toMatchObject({
      code: "INTERNAL",
    });
  });
});
