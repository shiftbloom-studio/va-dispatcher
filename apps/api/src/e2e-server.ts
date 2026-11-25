import { serve } from "@hono/node-server";

import app from "./app.js";
import { env } from "./env.js";
import { isE2eFixtureAuthorized } from "./lib/e2e-fixture.js";
import { createTestDatabase } from "./test/d1.js";
import { memberships, tenants } from "./db/schema.js";

const config = env();
if (
  config.NODE_ENV === "production" ||
  !config.E2E_FIXTURE_MODE ||
  !config.AUTH_DEV_BYPASS
) {
  throw new Error(
    "The integrated E2E server requires explicit non-production fixture configuration",
  );
}

// An in-memory local D1 database: disposable by construction, it exists only
// for the lifetime of this process.
const database = await createTestDatabase();
installProviderNetworkBoundary();

const fixtureIdentities = {
  pilot: {
    clerkUserId: "user_e2e_pilot",
    clerkOrgId: "org_e2e_vsas",
    role: "pilot",
    displayName: "Integrated Test Pilot",
  },
  dispatcher: {
    clerkUserId: "user_e2e_dispatcher",
    clerkOrgId: "org_e2e_vsas",
    role: "dispatcher",
    displayName: "Integrated Test Dispatcher",
  },
  admin: {
    clerkUserId: "user_e2e_admin",
    clerkOrgId: "org_e2e_vsas",
    role: "admin",
    displayName: "Integrated Test Administrator",
  },
  outsider: {
    clerkUserId: "user_e2e_outsider",
    clerkOrgId: "org_e2e_other",
    role: "pilot",
    displayName: "Outside Test Pilot",
  },
} as const;

type FixtureIdentity = keyof typeof fixtureIdentities;

const server = serve({
  fetch: fixtureFetch,
  hostname: "127.0.0.1",
  port: config.PORT,
});

console.log(
  `VA Dispatch integrated E2E API listening on http://127.0.0.1:${config.PORT}`,
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close(() => {
      void database.dispose().finally(() => process.exit(0));
    });
  });
}

async function fixtureFetch(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const normalizedPath = url.pathname.replace(/^\/v1\//, "/api/v1/");

  if (normalizedPath === "/api/v1/internal/e2e/reset") {
    if (request.method !== "POST") return fixtureNotFound();
    if (!fixtureAuthority(request)) return fixtureUnauthorized();
    const ids = await resetFixtureData();
    return fixtureJson({ ok: true, ids });
  }

  if (normalizedPath.startsWith("/api/v1/internal/e2e/")) {
    return fixtureNotFound();
  }
  if (normalizedPath === "/api/v1/internal/seed/vsas") {
    return fixtureNotFound();
  }
  if (url.pathname.startsWith("/__e2e/weather/")) {
    const product = url.pathname.split("/").at(-1);
    return fixtureJson(
      product === "metar"
        ? [{ icaoId: "EKCH", rawOb: "EKCH 121850Z 24008KT CAVOK" }]
        : [],
    );
  }

  if (isUnauthenticatedApiPath(normalizedPath)) {
    return app.fetch(request);
  }
  if (!normalizedPath.startsWith("/api/v1/")) {
    return app.fetch(request);
  }

  const identityName = request.headers.get(
    "X-E2E-Identity",
  ) as FixtureIdentity | null;
  const identity = identityName ? fixtureIdentities[identityName] : undefined;
  if (
    !identity ||
    !isE2eFixtureAuthorized(
      request.headers.get("X-E2E-Fixture-Token") ?? undefined,
    )
  ) {
    return fixtureUnauthorized();
  }

  const headers = new Headers(request.headers);
  headers.set("X-Dev-User-Id", identity.clerkUserId);
  headers.set("X-Dev-Org-Id", identity.clerkOrgId);
  headers.set("X-Dev-Role", identity.role);
  headers.set("X-Dev-Display-Name", identity.displayName);
  headers.delete("X-E2E-Identity");
  return app.fetch(new Request(request, { headers }));
}

function fixtureAuthority(request: Request): boolean {
  const authorization = request.headers.get("Authorization");
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : undefined;
  return isE2eFixtureAuthorized(token);
}

function isUnauthenticatedApiPath(path: string): boolean {
  return (
    path.startsWith("/api/v1/public/") ||
    path.startsWith("/api/v1/internal/cron/") ||
    path === "/api/v1/simbrief/callback" ||
    path === "/api/v1/simbrief/oauth/callback"
  );
}

async function resetFixtureData() {
  await database.reset();
  await database.db.insert(tenants).values([
    {
      id: FIXTURE_IDS.tenant,
      slug: "vsas",
      name: "Virtual SAS",
      clerkOrgId: "org_e2e_vsas",
      hoppieStation: "VSAS",
      brandSeedColor: "#e64646",
      brandPresence: "balanced",
      settings: {},
    },
    {
      id: FIXTURE_IDS.otherTenant,
      slug: "other-va",
      name: "Other Virtual Airline",
      clerkOrgId: "org_e2e_other",
      hoppieStation: "OTHER",
      brandSeedColor: "#3159a7",
      brandPresence: "restrained",
      settings: {},
    },
  ]);
  await database.db.insert(memberships).values([
    { id: FIXTURE_IDS.pilot, tenantId: FIXTURE_IDS.tenant, clerkUserId: "user_e2e_pilot", role: "pilot", displayName: "Integrated Test Pilot", pilotCallsign: "SAS101", status: "active" },
    { id: FIXTURE_IDS.dispatcher, tenantId: FIXTURE_IDS.tenant, clerkUserId: "user_e2e_dispatcher", role: "dispatcher", displayName: "Integrated Test Dispatcher", pilotCallsign: "VSASOPS", status: "active" },
    { id: FIXTURE_IDS.admin, tenantId: FIXTURE_IDS.tenant, clerkUserId: "user_e2e_admin", role: "admin", displayName: "Integrated Test Administrator", pilotCallsign: "VSASADM", status: "active" },
    { id: FIXTURE_IDS.outsider, tenantId: FIXTURE_IDS.otherTenant, clerkUserId: "user_e2e_outsider", role: "pilot", displayName: "Outside Test Pilot", pilotCallsign: "OTHER01", status: "active" },
  ]);
  return FIXTURE_IDS;
}

const FIXTURE_IDS = {
  tenant: "29000000-0000-4000-8000-000000000001",
  otherTenant: "29000000-0000-4000-8000-000000000002",
  pilot: "29000000-0000-4000-8000-000000000011",
  dispatcher: "29000000-0000-4000-8000-000000000012",
  admin: "29000000-0000-4000-8000-000000000013",
  outsider: "29000000-0000-4000-8000-000000000014",
} as const;

function installProviderNetworkBoundary(): void {
  const platformFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input
          : input.url,
    );
    if (["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
      return platformFetch(input, init);
    }
    if (
      url.hostname === "www.simbrief.com" &&
      url.pathname.endsWith("xml.fetcher.php")
    ) {
      return fixtureJson({
        params: {
          static_id: url.searchParams.get("static_id"),
          user_id: url.searchParams.get("userid"),
          request_id: "e2e-simbrief-request",
          time_generated: "1786561200",
        },
        origin: { icao_code: "EKCH" },
        destination: { icao_code: "ENGM" },
        general: { route: "NEXEN Z711 MONAK" },
      });
    }
    if (
      url.hostname === "identity.api.navigraph.com" &&
      url.pathname.endsWith("/connect/token")
    ) {
      return fixtureJson({
        access_token: "e2e-navigraph-access-token",
        token_type: "Bearer",
        expires_in: 300,
        scope: "openid userinfo",
      });
    }
    if (
      url.hostname === "identity.api.navigraph.com" &&
      url.pathname.endsWith("/connect/userinfo")
    ) {
      return fixtureJson({
        sub: "e2e-navigraph-subject",
        preferred_username: "synthetic-pilot",
      });
    }
    throw new Error(`Integrated E2E blocked external request to ${url.origin}`);
  };
}

function fixtureUnauthorized(): Response {
  return fixtureJson(
    { error: { code: "UNAUTHORIZED", message: "Invalid E2E authority" } },
    401,
  );
}

function fixtureNotFound(): Response {
  return fixtureJson(
    { error: { code: "NOT_FOUND", message: "Route not found" } },
    404,
  );
}

function fixtureJson(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
