# Local Development

## Prerequisites

- Node.js 26 or newer; `.nvmrc` pins the version CI uses.
- pnpm 11.21.0, as declared by `packageManager`.
- Optional Clerk development keys when testing real authentication.
- Chromium installed through Playwright when running browser tests.

No database server is needed. The API runs under `wrangler dev`, which keeps a
local D1 database and R2 bucket in `apps/api/.wrangler`.

Use the lockfile exactly:

```bash
pnpm install --frozen-lockfile
```

## Recommended local mode

The fastest local setup uses local D1, API development-header authentication, and the isolated mock ACARS adapter. It does not contact Clerk or Hoppie for business requests.

### 1. Configure the API

```bash
cp apps/api/.dev.vars.example apps/api/.dev.vars
```

`wrangler.jsonc` already sets `NODE_ENV=development`, the local origins, and
`ACARS_PROVIDER=mock`. The example enables `AUTH_DEV_BYPASS=true` with
`VSAS_CLERK_ORG_ID=org_vsas_dev`.

`TENANT_SECRETS_KEY` is not needed for the mock provider, but configuring a valid development value lets you exercise encryption and organization settings:

```bash
openssl rand -base64 32
```

Never reuse a production encryption key or Hoppie credential locally.

### 2. Configure the web app

```bash
cp apps/web/.env.example apps/web/.env.local
```

For ordinary development against the local API:

```dotenv
API_ORIGIN=http://localhost:3001
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
NEXT_PUBLIC_SOURCE_URL=https://github.com/shiftbloom-studio/va-dispatcher
```

The Clerk keys are still needed for the normal web shell. The separate Playwright fixture mode bypasses Clerk rendering and is configured automatically by `playwright.config.ts`; do not copy its bypass variables into production.

Configure development-safe legal values as described in [Configuration Reference](https://github.com/shiftbloom-studio/va-dispatcher/wiki/Configuration-Reference). Production requires real operator values.

### 3. Apply the schema

```bash
pnpm db:migrate:local
```

This applies every migration in `apps/api/migrations` to the local D1
database. After changing `apps/api/src/db/schema.ts`, run `pnpm db:generate`
to write a new migration, then apply it again.

### 4. Start both services

```bash
pnpm dev
```

- Web: `http://localhost:3000`
- API: `http://localhost:3001`
- Health: `http://localhost:3001/api/health`
- Swagger: `http://localhost:3001/docs/swagger`
- ReDoc: `http://localhost:3001/docs/redoc`

### 5. Seed the vSAS tenant

The development auth bypass still requires a tenant record. With `AUTH_DEV_BYPASS=true`, seed it without a bearer token:

```bash
curl -X POST http://localhost:3001/api/v1/internal/seed/vsas \
  -H 'Content-Type: application/json' \
  -d '{"clerkOrgId":"org_vsas_dev","adminClerkUserId":"user_dev"}'
```

Then open `http://localhost:3000/vsas`.

The default development headers are equivalent to:

```http
X-Dev-User-Id: user_dev
X-Dev-Org-Id: org_vsas_dev
X-Dev-Role: admin
```

The browser client does not add these headers itself. Use them when calling the API directly in bypass mode. The web's deterministic end-to-end fixture mode is a different test-only mechanism.

## Real Clerk mode

To exercise production-like authentication locally:

1. Enable Clerk Organizations with optional membership and organization slugs.
2. Disable user-created organizations and Verified Domain enrollment; add
   `org:pilot` and `org:dispatcher` to the Primary Role Set.
3. Create an organization whose slug is exactly `vsas`.
4. Set its organization ID as `VSAS_CLERK_ORG_ID` in the API.
5. Put the Clerk secret key in both server environments and the publishable key in the web environment.
6. Set `APP_ORIGIN=http://localhost:3000` and `AUTH_DEV_BYPASS=false`.
7. Seed or let the trusted configured organization repair the initial vSAS tenant on first authenticated access.
8. With Clerk Waitlist mode enabled, join at `/vsas/waitlist`, invite the entry,
   complete Clerk's default Account Portal sign-up, and confirm the Account
   Portal sign-up fallback is configured to reach `/vsas/join`. Approve the
   application from a tenant admin session, and test `/vsas/sign-up` separately
   with an invitation redirected into the local application.

Unknown organizations are not automatically provisioned. A new member of a
registered tenant is provisioned as pilot or dispatcher from the verified role;
admin still requires the app control plane or no-active-admin recovery seam.

## Local ACARS

Keep `ACARS_PROVIDER=mock` for normal development. The mock provider:

- stores messages in D1;
- can echo an acknowledgement;
- exposes the dispatcher inbound simulator;
- drains simulated messages synchronously during the explicit simulate request; and
- never contacts Hoppie or needs background polling.

To test Hoppie deliberately, configure a development tenant ground station through the admin UI and use non-production credentials. Understand Hoppie's callsign-lock and polling rules first; see [ACARS and Hoppie](https://github.com/shiftbloom-studio/va-dispatcher/wiki/ACARS-and-Hoppie).

## Useful commands

| Command                                   | Purpose                                    |
| ----------------------------------------- | ------------------------------------------ |
| `pnpm dev`                                | Run API and web in parallel                |
| `pnpm dev:api`                            | Run the API Worker on port 3001            |
| `pnpm dev:web`                            | Run Next.js on port 3000                   |
| `pnpm typecheck`                          | Type-check all workspaces                  |
| `pnpm lint`                               | Lint workspaces that expose a lint script  |
| `pnpm format:check`                       | Check repository formatting                |
| `pnpm test`                               | Run unit and component tests               |
| `pnpm test:coverage`                      | Run configured full-source coverage gates  |
| `pnpm build`                              | Build every workspace                      |
| `pnpm test:api`                           | Run API tests only                         |
| `pnpm test:web`                           | Run web tests only                         |
| `pnpm --filter @va-dispatch/web test:e2e` | Run Playwright smoke journeys              |
| `pnpm test:e2e:integrated`                | Run two real web/API/D1 journeys           |
| `pnpm security:audit`                     | Reject high-severity dependency advisories |
| `pnpm db:generate`                        | Write a migration from `schema.ts`         |
| `pnpm db:migrate:local`                   | Apply migrations to the local D1 database  |
| `pnpm build:web`                          | Build the web Worker with vinext           |

## Playwright

Install Chromium once:

```bash
pnpm --filter @va-dispatch/web exec playwright install chromium
```

Then run:

```bash
pnpm --filter @va-dispatch/web test:e2e
```

The fast suite starts Next.js on port 3100 and uses deterministic route fixtures.
It validates focused user journeys and frontend contracts.

Override the port or target an already-running test deployment when necessary:

```bash
E2E_PORT=3200 pnpm --filter @va-dispatch/web test:e2e
E2E_BASE_URL=https://preview.example.test pnpm --filter @va-dispatch/web test:e2e
```

For real persistence through Next.js, Hono, repositories, and D1, run
the deliberately small integrated suite as documented in
[`docs/integrated-e2e.md`](https://github.com/shiftbloom-studio/va-dispatcher/blob/main/docs/integrated-e2e.md).
It creates an in-memory D1 database for each run and blocks external provider
traffic.

## Before editing Next.js code

This repository uses Next.js 16.3.6 and APIs may differ from older training material. Read the relevant guide under `apps/web/node_modules/next/dist/docs/` and follow `apps/web/AGENTS.md` before changing Next.js routes, conventions, configuration, caching, or request handling.

## Development safety

- Use synthetic users, schedules, flights, messages, and screenshots.
- Never commit `.env` files, Hoppie logons, Clerk keys, database URLs, cron secrets, or personal data.
- Do not point tests at production services.
- Do not enable `AUTH_DEV_BYPASS`, `E2E_FIXTURE_MODE`, or
  `NEXT_PUBLIC_E2E_FIXTURE_MODE` in production; runtime validation rejects them.
- Do not treat a passing fixture browser test as proof of live-provider integration.
