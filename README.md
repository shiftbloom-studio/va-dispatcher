# VA Dispatch — Live Dispatch & ACARS

Multi-tenant Virtual Airline Live Dispatch & ACARS tool.

- **One tenant = one Virtual Airline** (first: **vSAS**)
- **API**: Hono + TypeScript on Vercel Services (`apps/api`)
- **Web**: Next.js pilot portal + dispatcher suite (`apps/web`)
- **ACARS**: Hoppie's ACARS via a tenant-scoped adapter (mock until configured)

## Monorepo

```text
apps/api   — Hono REST API (/api/v1)
apps/web   — Next.js frontend (path tenancy at /vsas)
```

## Prerequisites

- Node.js 22+ (24 recommended)
- pnpm 11+
- Neon Postgres + Clerk (Vercel Marketplace)

## Quick start

```bash
pnpm install
cp .env.example apps/api/.env
# configure apps/web/.env.local from apps/web/.env.example
# fill DATABASE_URL, CLERK_SECRET_KEY, etc.

pnpm db:push          # apply schema to Neon
pnpm dev              # web :3000 + API :3001
```

Open `http://localhost:3000/vsas`. Health check: `GET http://localhost:3001/health`.

Clerk Organizations must be enabled, organization slugs must be enabled, and the vSAS Clerk organization slug must be `vsas`. The application verifies the URL slug, active Clerk organization slug, and API `/me` tenant before loading operational data.

## Core flows

| Role       | Capabilities                                        |
| ---------- | --------------------------------------------------- |
| Pilot      | Request schedule, accept / decline / cancel flights |
| Dispatcher | Fulfill requests, flight board, ACARS send/receive  |
| Admin      | Tenant settings, memberships, ACARS config          |

## ACARS

Each Virtual Airline starts on the mock provider. An administrator can open
`/:slug/settings`, enter the VA ground-station callsign and Hoppie logon code,
and run a connection test. The code is encrypted with `TENANT_SECRETS_KEY` and
is never returned by the API. Once saved, only that tenant switches to Hoppie.

Members save their aircraft callsign on the same settings page. Their personal
Hoppie logon remains in their simulator ACARS client; this application never
asks for or stores it. The pilot and VA ground-station Hoppie accounts must use
the same network affiliation.

Hoppie registration is free and self-service; no separate API approval is
required: <https://www.hoppie.nl/acars/system/register.html>.

Mock mode supports `POST /api/v1/acars/simulate` for demos. Simulation keeps
the existing queued response contract and completes ingestion during the active
request, so background mock polling remains disabled for scale-to-zero.

## Cost model (no idle cost)

| Layer      | Choice                                   | Idle behavior                                  |
| ---------- | ---------------------------------------- | ---------------------------------------------- |
| Postgres   | **Neon Free / scale-to-zero**            | Suspends when unused → **$0 idle**             |
| Auth       | **Clerk Free**                           | MAU-based free tier; no always-on server       |
| API        | **Vercel Fluid Compute**                 | Active CPU pricing; no charge when not invoked |
| ACARS cron | Every **1 min**, configured tenants only | Required for a live Hoppie ground station      |

Do **not** add Redis/queues for v1 — they would add idle or minimum footprint.

The poll cron selects only tenants with an encrypted Hoppie logon. Mock tenants
never make Hoppie requests. Set `ACARS_PROVIDER=hoppie` on a deployment that has
at least one configured ground station; while it remains `mock`, the cron exits
before touching Neon. Vercel Pro is required for the one-minute schedule; slower
cron schedules delay inbound messages but do not affect outbound sends.

## Deploy

Vercel Services (`vercel.ts`): `web` + `api`, rewrites `/api/*` → API. If the
Services private beta is unavailable, deploy `apps/web` and `apps/api` as two
projects and set `API_ORIGIN` on the web project to the API project's public
origin; the Next.js rewrite keeps browser calls on same-origin `/api/*`.

```bash
vercel login
vercel link
# Prefer Neon Free / Launch (autosuspend). Avoid always-on compute plans.
vercel integration add neon
vercel integration add clerk
vercel env pull apps/api/.env.local --yes
# copy DATABASE_URL + CLERK_* into apps/api/.env for local
pnpm db:push
vercel deploy
```

## Scripts

| Script                                    | Description                       |
| ----------------------------------------- | --------------------------------- |
| `pnpm dev:api`                            | Run API locally                   |
| `pnpm dev:web`                            | Run the Next.js app locally       |
| `pnpm dev`                                | Run API and web together          |
| `pnpm test:api`                           | API unit and isolation tests      |
| `pnpm test:web`                           | Frontend unit and component tests |
| `pnpm --filter @va-dispatch/web test:e2e` | Deterministic browser smoke tests |
| `pnpm db:generate`                        | Drizzle migrations                |
| `pnpm db:push`                            | Push schema to DB                 |
| `pnpm typecheck`                          | TypeScript check                  |
