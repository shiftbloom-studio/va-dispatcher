# VA Dispatch — Live Dispatch & ACARS

[![CI](https://github.com/shiftbloom-studio/va-dispatcher/actions/workflows/ci.yml/badge.svg)](https://github.com/shiftbloom-studio/va-dispatcher/actions/workflows/ci.yml)
[![Security](https://github.com/shiftbloom-studio/va-dispatcher/actions/workflows/security.yml/badge.svg)](https://github.com/shiftbloom-studio/va-dispatcher/actions/workflows/security.yml)
[![License: AGPL v3 or later](https://img.shields.io/badge/license-AGPL--3.0--or--later-blue.svg)](LICENSE)

Multi-tenant Virtual Airline Live Dispatch & ACARS tool.

For the full product guide, architecture, API reference, operating runbooks,
and current limitations, see the
[project Wiki](https://github.com/shiftbloom-studio/va-dispatcher/wiki).

- **One tenant = one Virtual Airline** (first: **vSAS**)
- **API**: Hono + TypeScript on Cloudflare Workers with D1 and R2 (`apps/api`)
- **Web**: Next.js pilot portal + dispatcher suite, built for Workers with vinext (`apps/web`)
- **ACARS**: Hoppie's ACARS with tenant-scoped encrypted ground-station credentials

## Monorepo

```text
apps/api   — Hono REST API (/api/v1)
apps/web   — Next.js frontend (path tenancy at /vsas)
```

## Prerequisites

- Node.js 26+
- pnpm 11.21+
- A stem OIDC client for sign-in (optional locally: `AUTH_DEV_BYPASS=true`)
- A Cloudflare account for deployment; local development needs none

## Quick start

```bash
pnpm install
cp apps/api/.dev.vars.example apps/api/.dev.vars
# configure apps/web/.env.local from apps/web/.env.example

pnpm db:migrate:local # create the local D1 schema
pnpm dev              # web :3000 (next dev) + API Worker :3001 (wrangler dev)
```

Open `http://localhost:3000/vsas`. Health check: `GET http://localhost:3001/health`.
The API reference is available through
[Swagger UI](http://localhost:3001/docs/swagger),
[ReDoc](http://localhost:3001/docs/redoc), and the raw
[OpenAPI document](http://localhost:3001/docs/openapi.json).

The public legal pages are available in English at `/imprint` and `/privacy` and in German at `/impressum` and `/datenschutz`. Configure
all required `LEGAL_*` values from `apps/web/.env.example` before production;
production requests fail closed rather than publish placeholder operator data.
See [`docs/privacy-compliance.md`](docs/privacy-compliance.md) for the deployment
and operating checklist.
Guarded retention, export, legal-hold, and verified request procedures are in
[`docs/privacy-operations.md`](docs/privacy-operations.md); the software does
not by itself certify GDPR compliance.

Sign-in runs through stem, the shiftbloom OpenID Connect account service. People sign in with a one-time email code; a first sign-in creates the account. Each Virtual Airline is a stem organization with the roles `owner`, `admin`, `dispatcher`, `pilot`, or `member`. The vSAS organization slug is `vsas`; set `VSAS_AUTH_ORG_ID` to its ID. Tenant admins then manage the pilot/dispatcher application approval, invitations, roles, removal, and tenant membership settings inside VA Dispatch. See the Wiki configuration reference for the one-time stem registration.

## Core flows

| Role       | Capabilities                                                         |
| ---------- | -------------------------------------------------------------------- |
| Pilot      | Request schedule, accept / decline / cancel flights                  |
| Dispatcher | Fulfill requests, flight board, ACARS send/receive                   |
| Admin      | Tenant settings, invitations, approvals, roles/removal, ACARS config |

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

## Cost model

| Layer      | Choice                                   | Idle behavior                             |
| ---------- | ---------------------------------------- | ----------------------------------------- |
| Database   | **Cloudflare D1**                        | Billed per row read/written and storage   |
| Logos      | **Cloudflare R2**                        | Storage only; no egress fees              |
| Auth       | **stem** (shiftbloom OIDC, on Workers)   | No separate auth vendor or per-user fee   |
| Compute    | **Cloudflare Workers**                   | Billed per request and CPU time           |
| ACARS cron | Every **1 min**, configured tenants only | Required for a live Hoppie ground station |

The poll cron selects only tenants with an encrypted Hoppie logon. Set
`ACARS_PROVIDER=hoppie` in production for an explicit, self-documenting
configuration; the runtime enforces Hoppie there regardless.

## Deploy

Two Workers share one hostname: `va-dispatch-web` is the custom-domain origin,
and `va-dispatch-api` claims `/api/*` with a zone route. Cloudflare Workers
Builds deploys both from `main`; the API build applies pending D1 migrations
first. Hostname, database ID, and operator details come from build variables,
never from the repository. See
[`docs/cloudflare-deployment.md`](docs/cloudflare-deployment.md) for the
one-time setup, secrets, caching, and rollback.

## Scripts

| Script                                    | Description                               |
| ----------------------------------------- | ----------------------------------------- |
| `pnpm dev:api`                            | Run API locally                           |
| `pnpm dev:web`                            | Run the Next.js app locally               |
| `pnpm dev`                                | Run API and web together                  |
| `pnpm test:api`                           | API unit and isolation tests              |
| `pnpm test:web`                           | Frontend unit and component tests         |
| `pnpm test:coverage`                      | Full-source tests and coverage            |
| `pnpm security:audit`                     | High-severity dependency audit            |
| `pnpm --filter @va-dispatch/web test:e2e` | Deterministic browser smoke tests         |
| `pnpm test:e2e:integrated`                | Real web/API journeys on local D1         |
| `pnpm db:generate`                        | Generate a D1 migration from `schema.ts`  |
| `pnpm db:migrate:local`                   | Apply migrations to the local D1 database |
| `pnpm typecheck`                          | TypeScript check                          |

`apps/api/src/db/schema.ts` is the canonical database definition. Change it,
run `pnpm db:generate`, and commit the new file under `apps/api/migrations`;
applied migrations are never edited.

The integrated browser suite runs the API against an in-memory local D1
database. See [`docs/integrated-e2e.md`](docs/integrated-e2e.md) for details
and the deployed-browser acceptance checklist.

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
