# VA Dispatch — Live Dispatch & ACARS

[![CI](https://github.com/shiftbloom-studio/va-dispatcher/actions/workflows/ci.yml/badge.svg)](https://github.com/shiftbloom-studio/va-dispatcher/actions/workflows/ci.yml)
[![Security](https://github.com/shiftbloom-studio/va-dispatcher/actions/workflows/security.yml/badge.svg)](https://github.com/shiftbloom-studio/va-dispatcher/actions/workflows/security.yml)
[![License: AGPL v3 or later](https://img.shields.io/badge/license-AGPL--3.0--or--later-blue.svg)](LICENSE)

Multi-tenant Virtual Airline Live Dispatch & ACARS tool.

- **One tenant = one Virtual Airline** (first: **vSAS**)
- **API**: Hono + TypeScript on Vercel Services (`apps/api`)
- **Web**: Next.js pilot portal + dispatcher suite (`apps/web`)
- **ACARS**: Hoppie's ACARS with tenant-scoped encrypted ground-station credentials

## Monorepo

```text
apps/api   — Hono REST API (/api/v1)
apps/web   — Next.js frontend (path tenancy at /vsas)
```

## Prerequisites

- Node.js 24+ (26.7 recommended locally; Vercel currently builds on 24.x)
- pnpm 11.21+
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
The API reference is available through
[Swagger UI](http://localhost:3001/docs/swagger),
[ReDoc](http://localhost:3001/docs/redoc), and the raw
[OpenAPI document](http://localhost:3001/docs/openapi.json).

The public legal pages are available at `/impressum` and `/privacy`. Configure
all required `LEGAL_*` values from `apps/web/.env.example` before production;
production requests fail closed rather than publish placeholder operator data.
See [`docs/privacy-compliance.md`](docs/privacy-compliance.md) for the deployment
and operating checklist.

Clerk Organizations must be enabled, organization slugs must be enabled, and the vSAS Clerk organization slug must be `vsas`. Set `VSAS_CLERK_ORG_ID` to that organization's Clerk ID. The API provisions or repairs the initial vSAS tenant from this trusted value on first authenticated access, then verifies the URL slug, active Clerk organization slug, and API `/me` tenant before loading operational data.

## Core flows

| Role       | Capabilities                                        |
| ---------- | --------------------------------------------------- |
| Pilot      | Request schedule, accept / decline / cancel flights |
| Dispatcher | Fulfill requests, flight board, ACARS send/receive  |
| Admin      | Tenant settings, memberships, ACARS config          |

## ACARS

Production ACARS uses Hoppie exclusively. An administrator opens
`/:slug/settings/organization`, enters the VA ground-station callsign and Hoppie
logon code, and runs a connection test. The code is encrypted with
`TENANT_SECRETS_KEY` and is never returned by the API. Until that succeeds,
ACARS is explicitly unconfigured and outbound sends fail safely.

Every member, including dispatchers who also fly, saves their aircraft callsign
under `/:slug/settings`. Their personal Hoppie logon remains in their simulator
ACARS client; this application never asks for or stores it. The member and VA
ground-station Hoppie accounts must use the same network affiliation.

Hoppie registration is free and self-service; no separate API approval is
required: <https://www.hoppie.nl/acars/system/register.html>.

Local development and automated tests can use the internal DB-backed adapter
with `ACARS_PROVIDER=mock`. Its `POST /api/v1/acars/simulate` fixture is never
enabled in production, even if a stale production variable says `mock`.

## Cost model (no idle cost)

| Layer      | Choice                                   | Idle behavior                                  |
| ---------- | ---------------------------------------- | ---------------------------------------------- |
| Postgres   | **Neon Free / scale-to-zero**            | Suspends when unused → **$0 idle**             |
| Auth       | **Clerk Free**                           | MAU-based free tier; no always-on server       |
| API        | **Vercel Fluid Compute**                 | Active CPU pricing; no charge when not invoked |
| ACARS cron | Every **1 min**, configured tenants only | Required for a live Hoppie ground station      |

Do **not** add Redis/queues for v1 — they would add idle or minimum footprint.

The production poll cron selects only tenants with an encrypted Hoppie logon.
Set `ACARS_PROVIDER=hoppie` in production for an explicit, self-documenting
configuration; the runtime enforces Hoppie there regardless. Vercel Pro is
required for the one-minute schedule; slower cron schedules delay inbound
messages but do not affect outbound sends.

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
| `pnpm test:coverage`                      | Full-source tests and coverage    |
| `pnpm security:audit`                     | High-severity dependency audit    |
| `pnpm --filter @va-dispatch/web test:e2e` | Deterministic browser smoke tests |
| `pnpm db:generate`                        | Drizzle migrations                |
| `pnpm db:push`                            | Push schema to DB                 |
| `pnpm typecheck`                          | TypeScript check                  |

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup,
quality checks, and pull request expectations. Participation is governed by the
[Code of Conduct](CODE_OF_CONDUCT.md), and support guidance is available in
[SUPPORT.md](SUPPORT.md). Repository administrators should also complete the
[maintainer setup checklist](docs/maintainer-setup.md) after these files land on
`main`.

## Security

Do not report vulnerabilities in public issues. Follow the private reporting
process in [SECURITY.md](SECURITY.md).

## License

Copyright is held by the respective VA Dispatch contributors. The project is
free software licensed under the [GNU Affero General Public License version 3
or any later version](LICENSE) (`AGPL-3.0-or-later`). Operators who make a
modified version available over a network must offer its corresponding source
to users as required by the license. Hosted forks must set
`NEXT_PUBLIC_SOURCE_URL` to the corresponding source for their deployed version;
the application exposes this link in its legal notice.
