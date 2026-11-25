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
  options: {
    issuer?: string;
    audience?: string;
    subject?: string | null;
    typ?: string;
  } = {},
) {
  const jwt = new SignJWT(claims)
    .setProtectedHeader({
      alg: "ES256",
      kid: "test",
      typ: options.typ ?? "at+jwt",
    })
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

  it("returns the user, profile claims, and organization roles", async () => {
    await expect(
      verifyAccessToken(
        await token({
          orgs: { org_1: "dispatcher", org_2: "owner", org_3: 7 },
          email: "pilot@example.test",
          email_verified: true,
          name: "Test Pilot",
        }),
      ),
    ).resolves.toEqual({
      userId: "user_1",
      orgs: { org_1: "dispatcher", org_2: "owner" },
      email: "pilot@example.test",
      emailVerified: true,
      name: "Test Pilot",
    });
  });

  it("accepts a token without organizations", async () => {
    await expect(verifyAccessToken(await token({ orgs: {} }))).resolves.toEqual(
      {
        userId: "user_1",
        orgs: {},
        email: null,
        emailVerified: false,
        name: null,
      },
    );
  });

  it.each([
    ["a foreign issuer", { issuer: "https://evil.example.test" }],
    ["a foreign audience", { audience: "another-api" }],
    ["no subject", { subject: null }],
    ["an ID token type", { typ: "JWT" }],
  ])("rejects a token with %s", async (_label, options) => {
    const result = verifyAccessToken(
      await token({ orgs: { org_1: "member" } }, options),
    );
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
