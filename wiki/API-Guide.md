# API Guide

The Hono API is a tenant-scoped JSON REST service. The canonical contract is the in-code OpenAPI document, and the running service exposes Swagger UI and ReDoc.

## Base paths

| Path              | Purpose                                           |
| ----------------- | ------------------------------------------------- |
| `GET /health`     | Direct-service liveness and configuration summary |
| `GET /api/health` | Rewrite-compatible health alias                   |
| `/api/v1/*`       | Primary same-origin business API                  |
| `/v1/*`           | Service-scoped alias when `/api` is stripped      |
| `/docs/*`         | Direct-service OpenAPI, Swagger UI, and ReDoc     |
| `/api/docs/*`     | Same documentation through the public rewrite     |

Local interactive documentation:

- `http://localhost:3001/docs/swagger`
- `http://localhost:3001/docs/redoc`
- `http://localhost:3001/docs/openapi.json`

The OpenAPI renderer assets are version-pinned external CDN resources. The JSON document itself has no external renderer dependency.

## Authentication

Normal requests use a Clerk session JWT:

```http
Authorization: Bearer <token>
```

The token must contain a user subject and active organization. The organization
is resolved to a tenant; clients never submit `tenantId`.

`/membership-application` is a deliberate pre-membership exception: it
requires a verified Clerk user subject but not an active organization. It
accepts only the registered tenant slug and requested role, resolves both the
tenant and caller identity server-side, and returns no operational data.

Non-production development bypass accepts `X-Dev-User-Id`, `X-Dev-Org-Id`, and
`X-Dev-Role` when `AUTH_DEV_BYPASS=true`. Narrow exceptions use their own
credentials instead of Clerk:

- SimBrief and Navigraph callbacks validate one-time state or callback tokens;
- MSFS telemetry ingestion uses a revocable per-device bearer token; and
- internal cron operations use `Authorization: Bearer <CRON_SECRET>`.

`/internal/seed/vsas` is a non-production convenience route. Production returns
not found and bootstraps only the exact `VSAS_CLERK_ORG_ID` through normal
authentication.

See [Authentication and Multi-Tenancy](https://github.com/shiftbloom-studio/va-dispatcher/wiki/Authentication-and-Multi-Tenancy).

## BotID and direct clients

Authenticated same-origin browser mutations under `/api/v1/*` are protected by
Vercel BotID.

### Deep Analysis

- `POST /api/v1/acars/messages`
- `POST /api/v1/flights/bulk`
- `POST /api/v1/members/sync`
- `PUT /api/v1/tenant/acars-config`
- `POST /api/v1/tenant/acars-config/test`

### Basic

Every other authenticated `POST`, `PUT`, `PATCH`, or `DELETE` mounted after the
business middleware.

GET requests and `/api/v1/internal/*` are excluded. Public provider callbacks
and device-bearer telemetry ingestion are mounted before Clerk and BotID and
validate their own narrow credentials. A direct production `curl` mutation on
a BotID-protected route is expected to receive `403`, even with a valid Clerk
token. Read-only API clients remain possible; any other non-browser mutation
requires an explicitly designed trusted-client authentication path rather than
weakening BotID globally.

## Error envelope

Every handled error uses:

```json
{
  "error": {
    "code": "CONFLICT",
    "message": "Human-readable summary",
    "details": {}
  }
}
```

The API accepts or generates an `X-Request-Id` and returns it on the response. The web client includes it in displayed error text, making it the preferred correlation value for support and logs.

| Code                 |                Typical HTTP status |
| -------------------- | ---------------------------------: |
| `BAD_REQUEST`        |                                400 |
| `UNAUTHORIZED`       |                                401 |
| `FORBIDDEN`          |                                403 |
| `NOT_FOUND`          |                                404 |
| `CONFLICT`           |                                409 |
| `INVALID_TRANSITION` |                                409 |
| `UNPROCESSABLE`      |                                422 |
| `UPSTREAM`           |                                502 |
| `INTERNAL`           | 500, or an explicit service status |

Unknown server errors are logged server-side and returned only as `INTERNAL / Internal server error`.

## Pagination

List routes accept:

- `limit`: integer 1–100, default 25; and
- `cursor`: opaque base64url continuation value returned by the preceding page.

Responses use:

```json
{
  "items": [],
  "nextCursor": null
}
```

Do not parse, modify, or synthesize cursors in a client.

## Endpoint summary

`Authenticated` means any active membership at the route boundary; resource ownership may narrow access further.

### Health and profile

| Method  | Path      | Minimum access | Purpose                                                         |
| ------- | --------- | -------------- | --------------------------------------------------------------- |
| `GET`   | `/health` | Public         | Liveness, database configuration flag, effective ACARS provider |
| `GET`   | `/me`     | Authenticated  | Current user, membership, and tenant summary                    |
| `PATCH` | `/me`     | Authenticated  | Update own display name and/or aircraft callsign                |

### Tenant and members

| Method   | Path                                | Minimum access | Purpose                                                |
| -------- | ----------------------------------- | -------------- | ------------------------------------------------------ |
| `GET`    | `/public/tenants/{slug}`            | Public         | Pre-auth tenant name, brand, and application policy    |
| `GET`    | `/tenant`                           | Authenticated  | Current tenant, brand, access, and ACARS configuration |
| `PATCH`  | `/tenant`                           | Admin          | Update tenant name/settings and membership policy      |
| `PATCH`  | `/tenant/brand`                     | Admin          | Update seed color and brand presence                   |
| `POST`   | `/tenant/brand/logo`                | Admin          | Upload and select the tenant logo                      |
| `DELETE` | `/tenant/brand/logo`                | Admin          | Remove the uploaded tenant logo                        |
| `PUT`    | `/tenant/acars-config`              | Admin          | Test and save station/logon                            |
| `POST`   | `/tenant/acars-config/test`         | Admin          | Test saved configuration                               |
| `DELETE` | `/tenant/acars-config`              | Admin          | Remove encrypted logon and test timestamp              |
| `GET`    | `/members`                          | Dispatcher     | Search/filter tenant memberships                       |
| `GET`    | `/members/{id}/impact`              | Admin          | Preview assigned work affected by a member change      |
| `PATCH`  | `/members/{id}`                     | Admin          | Change/reassign role, profile, callsign, or status     |
| `DELETE` | `/members/{id}`                     | Admin          | Disable locally, reassign work, then remove from Clerk |
| `GET`    | `/members/invitations`              | Admin          | List pending Clerk tenant invitations                  |
| `POST`   | `/members/invitations`              | Admin          | Invite a pilot or dispatcher                           |
| `DELETE` | `/members/invitations/{id}`         | Admin          | Revoke a pending invitation                            |
| `GET`    | `/membership-application`           | Signed-in user | Read own application state for a tenant slug           |
| `POST`   | `/membership-application`           | Signed-in user | Submit pilot/dispatcher application                    |
| `DELETE` | `/membership-application`           | Signed-in user | Cancel own pending application                         |
| `POST`   | `/members/{id}/application/approve` | Admin          | Synchronize Clerk and activate application             |
| `POST`   | `/members/{id}/application/reject`  | Admin          | Reject and close pending application                   |
| `POST`   | `/members/sync`                     | Admin          | Reconcile the paged Clerk organization directory       |

### Schedule requests

| Method  | Path                             | Minimum access      | Purpose                                              |
| ------- | -------------------------------- | ------------------- | ---------------------------------------------------- |
| `POST`  | `/schedule-requests`             | Authenticated       | Create request owned by caller membership            |
| `GET`   | `/schedule-requests`             | Authenticated       | Own requests for pilots; tenant queue for dispatch   |
| `GET`   | `/schedule-requests/{id}`        | Owner or dispatcher | Request plus linked and remaining fulfillment counts |
| `PATCH` | `/schedule-requests/{id}`        | Owning pilot        | Versioned edit while still pending and unlinked      |
| `POST`  | `/schedule-requests/{id}/cancel` | Owner or dispatcher | Versioned cancel with explicit linked-flight policy  |
| `POST`  | `/schedule-requests/{id}/review` | Dispatcher          | Versioned start-review transition                    |
| `POST`  | `/schedule-requests/{id}/reject` | Dispatcher          | Versioned rejection with optional reason             |

### Flights

Flight mutations after creation require the current `expectedVersion`.
`POST /flights/bulk` additionally requires an `Idempotency-Key` header and the
current schedule-request version.

| Method  | Path                               | Minimum access                        | Purpose                                                     |
| ------- | ---------------------------------- | ------------------------------------- | ----------------------------------------------------------- |
| `POST`  | `/flights`                         | Dispatcher                            | Create a validated draft or offered flight                  |
| `POST`  | `/flights/bulk`                    | Dispatcher                            | Idempotently append a request-linked offered batch          |
| `GET`   | `/flights`                         | Authenticated                         | Assigned flights for pilots; tenant flights for dispatch    |
| `GET`   | `/flights/{id}`                    | Assigned pilot or dispatcher          | Flight, release revisions, and operational events           |
| `PATCH` | `/flights/{id}`                    | Dispatcher                            | Versioned non-terminal edit with material-change safeguards |
| `POST`  | `/flights/{id}/offer`              | Dispatcher                            | Draft to offered                                            |
| `POST`  | `/flights/{id}/accept`             | Assigned pilot                        | Offered to accepted and confirm assignment                  |
| `POST`  | `/flights/{id}/decline`            | Assigned pilot                        | Offered to declined, optional reason                        |
| `POST`  | `/flights/{id}/cancel`             | Eligible assigned pilot or dispatcher | Cancel, optional reason                                     |
| `POST`  | `/flights/{id}/confirm-assignment` | Assigned pilot                        | Confirm the current assignment revision                     |
| `POST`  | `/flights/{id}/release`            | Dispatcher                            | Publish immutable release revision and schedule the flight  |
| `POST`  | `/flights/{id}/start`              | Assigned pilot or dispatcher          | Start a scheduled flight and record actual OUT              |
| `POST`  | `/flights/{id}/finish`             | Assigned pilot or dispatcher          | Finish an active flight and record actual IN                |
| `POST`  | `/flights/{id}/status`             | Dispatcher                            | Dispatcher fallback for active, completed, or cancelled     |
| `POST`  | `/flights/{id}/reoffer`            | Dispatcher                            | Create a history-linked replacement for a declined flight   |

### SimBrief and Navigraph

Navigraph identity linking is optional and separate from the numeric SimBrief
Pilot ID. A dispatcher prepares the canonical revision without a provider call;
only the currently assigned pilot can launch that revision in SimBrief.

| Method   | Path                                                      | Minimum access               | Purpose                                      |
| -------- | --------------------------------------------------------- | ---------------------------- | -------------------------------------------- |
| `GET`    | `/simbrief/oauth/callback`                                | Public one-time OAuth state  | Complete Navigraph Authorization Code flow   |
| `GET`    | `/simbrief/callback`                                      | Public one-time callback MAC | Verify and import completed OFP              |
| `GET`    | `/simbrief/connection`                                    | Authenticated                | Read SimBrief and Navigraph connection state |
| `POST`   | `/simbrief/oauth/start`                                   | Authenticated                | Start Navigraph S256 PKCE connection         |
| `PUT`    | `/simbrief/connection`                                    | Authenticated                | Save numeric SimBrief Pilot ID               |
| `DELETE` | `/simbrief/connection`                                    | Authenticated                | Disconnect local account links               |
| `POST`   | `/flights/{id}/simbrief/dispatches`                       | Dispatcher                   | Prepare canonical planning revision          |
| `GET`    | `/flights/{id}/simbrief/dispatches`                       | Assigned pilot or dispatcher | List immutable planning revisions            |
| `POST`   | `/flights/{id}/simbrief/dispatches/{dispatchId}/generate` | Assigned pilot               | Launch newest valid revision in SimBrief     |
| `GET`    | `/flights/{id}/simbrief`                                  | Assigned pilot or dispatcher | Read latest planning revision and OFP        |
| `GET`    | `/flights/{id}/simbrief/dispatches/{dispatchId}`          | Assigned pilot or dispatcher | Read one planning revision                   |
| `POST`   | `/flights/{id}/simbrief/dispatches/{dispatchId}/sync`     | Assigned pilot or dispatcher | Retry OFP import after interrupted callback  |

### MSFS telemetry and OOOI

| Method   | Path                      | Minimum access               | Purpose                                           |
| -------- | ------------------------- | ---------------------------- | ------------------------------------------------- |
| `POST`   | `/telemetry/devices`      | Pilot                        | Issue a named simulator token, shown once         |
| `GET`    | `/telemetry/devices`      | Authenticated owner          | List owned simulator devices                      |
| `DELETE` | `/telemetry/devices/{id}` | Authenticated owner          | Revoke owned device and release its live lease    |
| `POST`   | `/telemetry/ingest`       | Device bearer                | Submit sequenced MSFS phase and position sample   |
| `GET`    | `/flights/{id}/telemetry` | Assigned pilot or dispatcher | Read current presence, bounded track, and OOOI    |
| `GET`    | `/dispatch/telemetry`     | Dispatcher                   | Read tenant live-presence and current-flight view |
| `PATCH`  | `/flights/{id}/oooi`      | Dispatcher                   | Versioned, reasoned manual OOOI correction        |

### Dispatch and ACARS

| Method | Path                   | Minimum access        | Purpose                                                   |
| ------ | ---------------------- | --------------------- | --------------------------------------------------------- |
| `GET`  | `/dispatch/board`      | Dispatcher            | Bounded live board, monthly KPIs, and request counts      |
| `GET`  | `/dispatch/inbox`      | Dispatcher            | Newest 50 stored ACARS messages                           |
| `GET`  | `/acars/messages`      | Dispatcher            | Filter/paginate messages by direction, station, or flight |
| `POST` | `/acars/messages`      | Dispatcher            | Send once and store the explicit delivery outcome         |
| `GET`  | `/acars/messages/{id}` | Dispatcher            | Message detail including raw provider data                |
| `POST` | `/acars/simulate`      | Dispatcher, mock only | Queue and ingest synthetic inbound message                |

The board includes accepted/briefed flights from 24 hours overdue through seven
days ahead, all active flights, and completed flights in the current UTC month.

### Audit and privacy administration

These routes are Admin-only. Privacy workflows are bounded and operator-driven;
external-provider or backup tasks require operator completion evidence and are
not automatic provider deletion.

| Method family | Path family                    | Purpose                                          |
| ------------- | ------------------------------ | ------------------------------------------------ |
| `GET`         | `/audit-events`                | Filter and paginate redacted audit events        |
| `GET`         | `/audit-events/export`         | Export a bounded redacted audit page             |
| `GET`, `POST` | `/privacy/policies`            | Read, create, and approve retention policy       |
| `GET`, `POST` | `/privacy/retention/runs`      | Queue, inspect, and retry bounded retention runs |
| `GET`, `POST` | `/privacy/requests`            | Verify, approve, process, and export requests    |
| `GET`, `POST` | `/privacy/legal-holds`         | Create, approve, and release legal holds         |
| `PATCH`       | `/privacy/external-tasks/{id}` | Record operator completion of external work      |

### Internal

| Method          | Path                               | Authentication      | Purpose                                      |
| --------------- | ---------------------------------- | ------------------- | -------------------------------------------- |
| `GET` or `POST` | `/internal/cron/acars-poll`        | Cron bearer         | Poll configured Hoppie tenants               |
| `GET` or `POST` | `/internal/cron/privacy-lifecycle` | Cron bearer         | Process bounded approved lifecycle work      |
| `POST`          | `/internal/seed/vsas`              | Non-production only | Local create/repair convenience; absent live |

## Example development call

After seeding a local bypass tenant:

```bash
curl http://localhost:3001/api/v1/me \
  -H 'X-Dev-User-Id: user_dev' \
  -H 'X-Dev-Org-Id: org_vsas_dev' \
  -H 'X-Dev-Role: pilot'
```

Create a synthetic schedule request:

```bash
curl -X POST http://localhost:3001/api/v1/schedule-requests \
  -H 'Content-Type: application/json' \
  -H 'X-Dev-User-Id: user_dev' \
  -H 'X-Dev-Org-Id: org_vsas_dev' \
  -H 'X-Dev-Role: pilot' \
  -d '{
    "title":"Weekend flying",
    "windowStart":"2026-09-12T08:00:00.000Z",
    "windowEnd":"2026-09-12T16:00:00.000Z",
    "desiredFlightCount":1,
    "preferences":{"availability":[{"startAt":"2026-09-12T08:00:00.000Z","endAt":"2026-09-12T16:00:00.000Z"}]}
  }'
```

Use only synthetic data in examples and bug reports.

## Contract maintenance

When changing a route:

1. Update its Zod validator and serializer.
2. Update domain authorization and tenant-scoped repository behavior.
3. Update `apps/api/src/docs/openapi.ts`.
4. Update `apps/web/src/lib/api/schemas.ts` for every consumed response.
5. Add route, authorization, tenant-isolation, and frontend contract tests.
6. Update the relevant Wiki page.

`apps/api/src/routes/docs.test.ts` verifies that every registered versioned operation is documented, operation IDs are unique, descriptions exist, and `$ref` values resolve.
