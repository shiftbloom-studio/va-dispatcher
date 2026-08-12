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
- SimBrief connection: `GET/PUT/DELETE /simbrief/connection`, `POST /simbrief/oauth/start`
- SimBrief flight plans: `POST /flights/:id/simbrief/dispatches`, `GET /flights/:id/simbrief`
- Cron: `POST /internal/cron/acars-poll` (Bearer `CRON_SECRET`)

## SimBrief flight plans

The API implements SimBrief's **Dispatch Redirect** flow. It does not collect
or store a SimBrief/Navigraph password or session. SimBrief currently requires
generation to run in its own browser window, where the person opening the
returned URL authenticates directly with SimBrief. The application API key is
used only on the backend to sign that URL.

### Navigraph OAuth account authentication

Navigraph account linking uses its **Authorization Code flow with S256 PKCE**.
The registered production redirect URI is exactly:

```text
https://www.va-dispatcher.world/api/v1/simbrief/oauth/callback
```

Use the canonical `www` host above in the access request. The apex domain
redirects to `www`, while Navigraph requires the registered URI and the token
exchange URI to match exactly.

Once Navigraph issues the credentials, configure these backend-only values:

```dotenv
NAVIGRAPH_CLIENT_ID=...
NAVIGRAPH_CLIENT_SECRET=...
NAVIGRAPH_REDIRECT_URI=https://www.va-dispatcher.world/api/v1/simbrief/oauth/callback
```

`TENANT_SECRETS_KEY` must also be configured. It encrypts each short-lived PKCE
verifier; only a SHA-256 hash of OAuth `state` is stored. Start a connection
with an authenticated request:

```http
POST /api/v1/simbrief/oauth/start
Authorization: Bearer <Clerk session JWT>
```

The response contains `authorizationUrl`, `redirectUri`, and `expiresAt`. Open
the authorization URL in the browser. Its production shape is:

```text
https://identity.api.navigraph.com/connect/authorize?client_id=<client-id>&response_type=code&state=<one-time-state>&scope=openid%20userinfo&redirect_uri=https%3A%2F%2Fwww.va-dispatcher.world%2Fapi%2Fv1%2Fsimbrief%2Foauth%2Fcallback&code_challenge=<S256-challenge>&code_challenge_method=S256
```

The public callback atomically consumes the state, exchanges the short-lived
code on the backend, and calls Navigraph UserInfo. The membership stores only
the stable Navigraph subject, preferred username, and connection time. Access,
refresh, and ID tokens are not persisted, and `offline_access`, navigation-data,
and charts scopes are not requested.

Navigraph's public identity contract does not document a claim containing the
numeric SimBrief Pilot ID. The OAuth subject is therefore not guessed or copied
into `simbriefUserId`; the numeric Pilot ID remains a separate input below.
SimBrief verifies the actual generation session in its own browser window.
`GET /simbrief/connection` reports both connection states without exposing the
Navigraph subject.

Before enabling the integration:

1. [Request a SimBrief API key](https://developers.navigraph.com/docs/simbrief/introduction)
   and Navigraph OAuth client credentials.
2. Set `SIMBRIEF_API_KEY` and the three `NAVIGRAPH_*` variables on the API
   deployment.
3. Set `SIMBRIEF_CALLBACK_URL` to the separate flight-plan completion callback,
   `https://www.va-dispatcher.world/api/v1/simbrief/callback` in production.
4. Apply the updated database schema with `pnpm db:push`.

The authenticated API flow is:

```http
PUT /api/v1/simbrief/connection
Content-Type: application/json

{"userId":"123456"}
```

`userId` is the numeric SimBrief Pilot ID, not the username. The connection is
marked verified only after SimBrief returns a matching OFP for a dispatch the
member authenticated in the SimBrief window.

```http
POST /api/v1/flights/{flightId}/simbrief/dispatches
Content-Type: application/json

{
  "route": "NIKDA DCT",
  "aircraftType": "A359",
  "units": "KGS",
  "notams": true
}
```

The response contains a `dispatchUrl`. A future UI should open it in a new
browser window immediately. The assigned pilot may create a plan for their own
flight; dispatchers and admins may create one for any flight in their tenant.
The person opening the URL must be signed into the same SimBrief Pilot ID they
connected to this API.

After generation, SimBrief redirects to the one-time callback. That callback
fetches the OFP by the generated `static_id`, verifies its SimBrief user ID and
origin/destination, stores it, and consumes the callback token. Consumers can
read the latest state and full JSON OFP with:

```http
GET /api/v1/flights/{flightId}/simbrief
```

If the redirect was interrupted after SimBrief finished, an authorized client
can retry the fetch idempotently:

```http
POST /api/v1/flights/{flightId}/simbrief/dispatches/{dispatchId}/sync
```

SimBrief's JSON can include `plan_html`. Treat it as untrusted third-party HTML
and sanitize it before any future UI renders it. The API returns operational
JSON only and does not add a SimBrief UI in this change.

## ACARS

Production uses Hoppie exclusively. An admin configures and tests the tenant's
ground station from the web organization settings page; the API encrypts its
logon using `TENANT_SECRETS_KEY` before storage. Without that configuration,
live sends return `422 UNPROCESSABLE` and nothing is stored. Generate the
required 32-byte base64 key with `openssl rand -base64 32`.

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
