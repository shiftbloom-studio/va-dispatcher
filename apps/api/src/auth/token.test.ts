import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { loadEnv, resetEnvCache } from "../env.js";
import { AppError } from "../lib/errors.js";
import { setAccessTokenKeysForTests, verifyAccessToken } from "./token.js";

const ISSUER = "https://auth.example.test";
const AUDIENCE = "va-dispatch-api";
const CLIENT_ID = "va-client";

let privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];

async function token(
  claims: Record<string, unknown>,
  options: {
    issuer?: string;
    audience?: string;
    subject?: string | null;
    typ?: string;
    clientId?: string;
  } = {},
) {
  const jwt = new SignJWT({ azp: options.clientId ?? CLIENT_ID, ...claims })
    .setProtectedHeader({
      alg: "EdDSA",
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
    const pair = await generateKeyPair("Ed25519");
    privateKey = pair.privateKey;
    const jwk = {
      ...(await exportJWK(pair.publicKey)),
      kid: "test",
      alg: "EdDSA",
    };
    setAccessTokenKeysForTests(createLocalJWKSet({ keys: [jwk] }));
  });

  beforeEach(() => {
    resetEnvCache();
    loadEnv({
      NODE_ENV: "test",
      AUTH_ISSUER: ISSUER,
      AUTH_AUDIENCE: AUDIENCE,
      AUTH_CLIENT_ID: CLIENT_ID,
    });
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
      signIn: { method: "unknown", at: null },
    });
  });

  it("reads how and when the person signed in", async () => {
    const signedInAt = Math.floor(Date.now() / 1000) - 30;
    await expect(
      verifyAccessToken(
        await token({ auth_method: "passkey", signed_in_at: signedInAt }),
      ),
    ).resolves.toMatchObject({
      signIn: { method: "passkey", at: signedInAt },
    });
    await expect(
      verifyAccessToken(
        await token({ auth_method: "webauthn", signed_in_at: "yesterday" }),
      ),
    ).resolves.toMatchObject({ signIn: { method: "unknown", at: null } });
  });

  it("accepts a token without organizations", async () => {
    await expect(verifyAccessToken(await token({ orgs: {} }))).resolves.toEqual(
      {
        userId: "user_1",
        orgs: {},
        email: null,
        emailVerified: false,
        name: null,
        signIn: { method: "unknown", at: null },
      },
    );
  });

  it.each([
    ["a foreign issuer", { issuer: "https://evil.example.test" }],
    ["a foreign audience", { audience: "another-api" }],
    ["no subject", { subject: null }],
    ["an ID token type", { typ: "JWT" }],
    ["another client", { clientId: "other-client" }],
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
