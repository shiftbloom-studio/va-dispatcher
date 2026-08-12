# `@va-dispatch/api`

Hono REST API for Virtual Airline Live Dispatch & ACARS.

## Base paths

| Path | Purpose |
| --- | --- |
| `GET /health` | Liveness |
| `/api/v1/*` | Versioned API (public rewrite from Vercel) |
| `/v1/*` | Same routes (if `/api` is stripped by a rewrite) |

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
- ACARS: `GET/POST /acars/messages`, `POST /acars/simulate` (mock only)
- Cron: `POST /internal/cron/acars-poll` (Bearer `CRON_SECRET`)

## ACARS

```env
ACARS_PROVIDER=mock   # default
# ACARS_PROVIDER=hoppie  # needs encrypted tenant logon
```

## Scripts

```bash
pnpm dev          # watch mode :3001
pnpm test
pnpm typecheck
pnpm db:push
```
