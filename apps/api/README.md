# `@va-dispatch/api`

Hono REST API for Virtual Airline Live Dispatch & ACARS.

## Base paths

| Path          | Purpose                                          |
| ------------- | ------------------------------------------------ |
| `GET /health` | Liveness                                         |
| `/api/v1/*`   | Versioned API (public rewrite from Vercel)       |
| `/v1/*`       | Same routes (if `/api` is stripped by a rewrite) |

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
- ACARS: `GET/POST /acars/messages`, `POST /acars/simulate` (mock only)
- ACARS config: `PUT/DELETE /tenant/acars-config`, `POST /tenant/acars-config/test` (admin)
- Cron: `POST /internal/cron/acars-poll` (Bearer `CRON_SECRET`)

## ACARS

The provider is selected per tenant. Without an encrypted logon the tenant uses
the DB-backed mock provider. An admin configures and tests a real ground station
from the web settings page; the API encrypts its logon using
`TENANT_SECRETS_KEY` before storage. Generate the required 32-byte base64 key
with `openssl rand -base64 32`.

`ACARS_PROVIDER=hoppie` enables the deployment's scheduled inbound poll. It is
an idle-cost gate, not the tenant's outbound provider choice: tenants still use
Hoppie only when they have their own encrypted configuration. Leave it `mock`
until at least one tenant is ready, so the cron exits without waking Neon.

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
