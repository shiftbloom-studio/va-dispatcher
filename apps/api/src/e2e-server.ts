import { serve } from "@hono/node-server";
import { defineRelations, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { PgDialect } from "drizzle-orm/pg-core";
import pg from "pg";

import app from "./app.js";
import { setDbForTests, type Db } from "./db/client.js";
import * as schema from "./db/schema.js";
import { env } from "./env.js";
import { isE2eFixtureAuthorized } from "./lib/e2e-fixture.js";

const config = env();
if (
  config.NODE_ENV === "production" ||
  !config.E2E_FIXTURE_MODE ||
  !config.AUTH_DEV_BYPASS ||
  !config.DATABASE_URL ||
  !config.E2E_CONFIRM_DATABASE
) {
  throw new Error(
    "The integrated E2E server requires explicit non-production fixture configuration",
  );
}

const { Pool } = pg;
const pool = new Pool({ connectionString: config.DATABASE_URL, max: 10 });
const database = await pool.query<{ currentDatabase: string }>(
  'select current_database() as "currentDatabase"',
);
if (database.rows[0]?.currentDatabase !== config.E2E_CONFIRM_DATABASE) {
  await pool.end();
  throw new Error(
    "E2E_CONFIRM_DATABASE must match the connected PostgreSQL database",
  );
}
if (!/(?:^|[_-])(?:e2e|test)(?:[_-]|$)/i.test(config.E2E_CONFIRM_DATABASE)) {
  await pool.end();
  throw new Error(
    "E2E_CONFIRM_DATABASE must identify a disposable test database",
  );
}

setDbForTests(createLocalPostgresDatabase(pool));
installProviderNetworkBoundary();

const fixtureIdentities = {
  pilot: {
    clerkUserId: "user_e2e_pilot",
    clerkOrgId: "org_e2e_vsas",
    role: "pilot",
  },
  dispatcher: {
    clerkUserId: "user_e2e_dispatcher",
    clerkOrgId: "org_e2e_vsas",
    role: "dispatcher",
  },
  admin: {
    clerkUserId: "user_e2e_admin",
    clerkOrgId: "org_e2e_vsas",
    role: "admin",
  },
  outsider: {
    clerkUserId: "user_e2e_outsider",
    clerkOrgId: "org_e2e_other",
    role: "pilot",
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
      void pool.end().finally(() => process.exit(0));
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
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      "delete from tenants where clerk_org_id = any($1::text[])",
      [["org_e2e_vsas", "org_e2e_other"]],
    );
    await client.query(
      `insert into tenants (
        id, slug, name, clerk_org_id, hoppie_station, brand_seed_color,
        brand_presence, settings
      ) values
        ($1, 'vsas', 'Virtual SAS', 'org_e2e_vsas', 'VSAS', '#e64646', 'balanced', '{}'::jsonb),
        ($2, 'other-va', 'Other Virtual Airline', 'org_e2e_other', 'OTHER', '#3159a7', 'restrained', '{}'::jsonb)`,
      [FIXTURE_IDS.tenant, FIXTURE_IDS.otherTenant],
    );
    await client.query(
      `insert into memberships (
        id, tenant_id, clerk_user_id, role, display_name, pilot_callsign,
        status
      ) values
        ($1, $5, 'user_e2e_pilot', 'pilot', 'Integrated Test Pilot', 'SAS101', 'active'),
        ($2, $5, 'user_e2e_dispatcher', 'dispatcher', 'Integrated Test Dispatcher', 'VSASOPS', 'active'),
        ($3, $5, 'user_e2e_admin', 'admin', 'Integrated Test Administrator', 'VSASADM', 'active'),
        ($4, $6, 'user_e2e_outsider', 'pilot', 'Outside Test Pilot', 'OTHER01', 'active')`,
      [
        FIXTURE_IDS.pilot,
        FIXTURE_IDS.dispatcher,
        FIXTURE_IDS.admin,
        FIXTURE_IDS.outsider,
        FIXTURE_IDS.tenant,
        FIXTURE_IDS.otherTenant,
      ],
    );
    await client.query("commit");
    return FIXTURE_IDS;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

const FIXTURE_IDS = {
  tenant: "29000000-0000-4000-8000-000000000001",
  otherTenant: "29000000-0000-4000-8000-000000000002",
  pilot: "29000000-0000-4000-8000-000000000011",
  dispatcher: "29000000-0000-4000-8000-000000000012",
  admin: "29000000-0000-4000-8000-000000000013",
  outsider: "29000000-0000-4000-8000-000000000014",
} as const;

type DeferredExecution = PromiseLike<pg.QueryResult> & { query: SQL };

function createLocalPostgresDatabase(databasePool: pg.Pool): Db {
  const relations = defineRelations(schema);
  const nodeDatabase = drizzle({ client: databasePool, relations });
  const dialect = new PgDialect();
  return new Proxy(nodeDatabase, {
    get(target, property, receiver) {
      if (property === "execute") {
        return (query: SQL): DeferredExecution => ({
          query,
          then: (onFulfilled, onRejected) =>
            (target.execute(query) as unknown as Promise<pg.QueryResult>).then(
              onFulfilled,
              onRejected,
            ),
        });
      }
      if (property === "batch") {
        return async (queries: readonly DeferredExecution[]) => {
          const client = await databasePool.connect();
          try {
            await client.query("begin");
            const results: pg.QueryResult[] = [];
            for (const item of queries) {
              const compiled = dialect.sqlToQuery(item.query);
              results.push(await client.query(compiled.sql, compiled.params));
            }
            await client.query("commit");
            return results;
          } catch (error) {
            await client.query("rollback");
            throw error;
          } finally {
            client.release();
          }
        };
      }
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as unknown as Db;
}

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
