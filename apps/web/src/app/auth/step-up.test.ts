import { webcrypto } from "node:crypto";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { NextRequest } from "next/server";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { GET as callback } from "./callback/route";
import { GET as login } from "./login/route";
import { authConfig } from "@/lib/auth/config";
import {
  readTransaction,
  sealSession,
  SESSION_COOKIE,
  TRANSACTION_COOKIE,
} from "@/lib/auth/session";

const ISSUER = "https://stem-step-up.example.test";
const ORIGIN = "https://va.example.test";

let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let idTokenSub = "user-1";

beforeAll(async () => {
  vi.stubGlobal("crypto", webcrypto);
  keys = await generateKeyPair("Ed25519");
});

function unsignedJwt(payload: Record<string, unknown>) {
  const part = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "none" })}.${part(payload)}.`;
}

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith("/.well-known/openid-configuration")) {
        return Response.json({
          authorization_endpoint: `${ISSUER}/api/auth/oauth2/authorize`,
          token_endpoint: `${ISSUER}/api/auth/oauth2/token`,
          jwks_uri: `${ISSUER}/api/auth/jwks`,
        });
      }
      if (url === `${ISSUER}/api/auth/jwks`) {
        const jwk = { ...(await exportJWK(keys.publicKey)), kid: "k1" };
        return Response.json({ keys: [{ ...jwk, alg: "EdDSA" }] });
      }
      if (url === `${ISSUER}/api/auth/oauth2/token`) {
        const body = new URLSearchParams(String(init?.body));
        const nonce = body.get("code");
        const idToken = await new SignJWT({ nonce })
          .setProtectedHeader({ alg: "EdDSA", kid: "k1" })
          .setIssuer(ISSUER)
          .setAudience("va-client")
          .setSubject(idTokenSub)
          .setIssuedAt()
          .setExpirationTime("5m")
          .sign(keys.privateKey);
        return Response.json({
          access_token: unsignedJwt({
            exp: Math.floor(Date.now() / 1000) + 600,
          }),
          id_token: idToken,
          refresh_token: "refresh-2",
        });
      }
      return new Response(null, { status: 404 });
    }),
  );
  vi.stubEnv("AUTH_ISSUER", ISSUER);
  vi.stubEnv("AUTH_CLIENT_ID", "va-client");
  vi.stubEnv("AUTH_CLIENT_SECRET", "va-secret");
  vi.stubEnv("AUTH_AUDIENCE", `${ORIGIN}/api`);
  vi.stubEnv(
    "AUTH_SESSION_SECRET",
    "a-session-secret-that-is-long-enough-for-tests",
  );
  vi.stubEnv("APP_ORIGIN", ORIGIN);
  idTokenSub = "user-1";
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function sessionCookie() {
  const sealed = await sealSession(
    {
      sub: "user-1",
      name: null,
      email: null,
      accessToken: "access-1",
      accessTokenExpiresAt: Math.floor(Date.now() / 1000) + 600,
      refreshToken: "refresh-1",
      idToken: "id-1",
    },
    authConfig(),
  );
  return `${SESSION_COOKIE}=${sealed}`;
}

/** Starts a step-up and returns the callback request stem would send back. */
async function stepUp() {
  const started = await login(
    new NextRequest(`${ORIGIN}/auth/login?step_up=1&returnTo=%2Fvsas%2Fadmin`, {
      headers: { cookie: await sessionCookie() },
    }),
  );
  const location = new URL(started.headers.get("location")!);
  const txValue = started.cookies.get(TRANSACTION_COOKIE)!.value;
  const tx = (await readTransaction(txValue, authConfig()))!;
  // The fake token endpoint echoes the code as the ID token nonce.
  const back = new NextRequest(
    `${ORIGIN}/auth/callback?code=${tx.nonce}&state=${tx.state}`,
    {
      headers: {
        cookie: `${TRANSACTION_COOKIE}=${txValue}; ${await sessionCookie()}`,
      },
    },
  );
  return { location, tx, back };
}

describe("passkey step-up sign-in", () => {
  it("asks stem to confirm the signed-in person, passkey first", async () => {
    const { location, tx } = await stepUp();
    expect(location.searchParams.get("prompt")).toBe("login");
    expect(location.searchParams.get("acr_values")).toBe("phr");
    expect(tx.stepUpSub).toBe("user-1");
    expect(tx.returnTo).toBe("/vsas/admin");
  });

  it("is a normal sign-in without a session", async () => {
    const started = await login(
      new NextRequest(`${ORIGIN}/auth/login?step_up=1`),
    );
    const location = new URL(started.headers.get("location")!);
    expect(location.searchParams.has("prompt")).toBe(false);
    expect(location.searchParams.has("acr_values")).toBe(false);
  });

  it("returns to the action with a new session for the same person", async () => {
    const { back } = await stepUp();
    const response = await callback(back);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/vsas/admin`);
    expect(response.cookies.get(SESSION_COOKIE)?.value).toBeTruthy();
  });

  it("keeps the session when someone else confirms", async () => {
    const { back } = await stepUp();
    idTokenSub = "user-2";
    const response = await callback(back);
    expect(response.headers.get("location")).toBe(
      `${ORIGIN}/auth/error?reason=account`,
    );
    expect(response.cookies.get(SESSION_COOKIE)).toBeUndefined();
  });
});
