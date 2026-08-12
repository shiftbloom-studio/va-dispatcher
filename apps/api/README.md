# `@va-dispatch/api`

Hono REST API for Virtual Airline Live Dispatch & ACARS.

## Base paths

| Path          | Purpose                                          |
| ------------- | ------------------------------------------------ |
| `GET /health` | Liveness                                         |
| `/api/v1/*`   | Versioned API (public rewrite from Vercel)       |
| `/v1/*`       | Same routes (if `/api` is stripped by a rewrite) |
| `/api/docs/*` | Public API documentation                         |
| `/docs/*`     | Same docs when addressed as a standalone service |

## API documentation

Run `pnpm dev:api`, then open one of the interactive references:

- Swagger UI: <http://localhost:3001/docs/swagger>
- ReDoc: <http://localhost:3001/docs/redoc>
- OpenAPI JSON: <http://localhost:3001/docs/openapi.json>

On the same-origin Vercel deployment, use `/api/docs/swagger`,
`/api/docs/redoc`, and `/api/docs/openapi.json`. The specification uses
`/api/v1` as its primary server and also exposes the service-scoped `/v1`
alias. Swagger UI and ReDoc load version-pinned renderer assets from their
public CDNs; the OpenAPI JSON endpoint has no external runtime dependency.

## Auth

**Production:** `Authorization: Bearer <Clerk session JWT>` with an active Organization (VA tenant).

**Local / dev:** set `AUTH_DEV_BYPASS=true` (never in production) and send:

```http
X-Dev-User-Id: user_123
X-Dev-Org-Id: org_vsas_dev
X-Dev-Role: admin   # pilot | dispatcher | admin
```

## Bootstrap vSAS

1. Create Clerk Organization for vSAS; copy org id → `VSAS_CLERK_ORG_ID`.
2. Set `DATABASE_URL` (Neon) and run `pnpm db:push` from repo root.
3. Seed:

```bash
curl -X POST http://localhost:3001/api/v1/internal/seed/vsas \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"clerkOrgId":"org_...","adminClerkUserId":"user_..."}'
```

## Core endpoints

- Schedule: `POST/GET /schedule-requests`, `…/cancel|review|reject`
- Flights: `POST /flights`, `POST /flights/bulk`, `…/accept|decline|cancel|offer|status`
- Dispatch: `GET /dispatch/board`, `GET /dispatch/inbox`
- Profile: `PATCH /me` (display name and own ACARS callsign)
- ACARS: `GET/POST /acars/messages`
- Development fixture: `POST /acars/simulate` (non-production mock adapter only)
- ACARS config: `PUT/DELETE /tenant/acars-config`, `POST /tenant/acars-config/test` (admin)
- Cron: `POST /internal/cron/acars-poll` (Bearer `CRON_SECRET`)

## ACARS

Production uses Hoppie exclusively. An admin configures and tests the tenant's
ground station from the web settings page; the API encrypts its logon using
`TENANT_SECRETS_KEY` before storage. Without that configuration, live sends
return `422 UNPROCESSABLE` and nothing is stored. Generate the required 32-byte
base64 key with `openssl rand -base64 32`.

`ACARS_PROVIDER=mock` selects the DB-backed adapter only for local development
and automated tests. Production always resolves to Hoppie, including when a
stale environment variable still says `mock`; set `ACARS_PROVIDER=hoppie` in
Vercel to keep the declared configuration aligned with runtime behavior.

Hoppie's `ping` is used for connection tests because it does not mark or lock
the station online. A real send is recorded only after Hoppie returns `ok`.
Provider rejections return `502 UPSTREAM`, retain the frontend draft, and are
never automatically retried.

Registration is self-service and does not need separate API approval:
<https://www.hoppie.nl/acars/system/register.html>.

## Scripts

```bash
pnpm dev          # watch mode :3001
pnpm test
pnpm typecheck
pnpm db:push
```
