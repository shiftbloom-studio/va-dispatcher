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

The token must contain a user subject and active organization. The organization is resolved to a tenant; clients never submit `tenantId`.

Non-production development bypass accepts `X-Dev-User-Id`, `X-Dev-Org-Id`, and `X-Dev-Role` when `AUTH_DEV_BYPASS=true`. Internal cron and seed operations use `Authorization: Bearer <CRON_SECRET>`.

See [Authentication and Multi-Tenancy](https://github.com/shiftbloom-studio/va-dispatcher/wiki/Authentication-and-Multi-Tenancy).

## BotID and direct clients

Same-origin browser mutations under `/api/v1/*` are protected by Vercel BotID.

### Deep Analysis

- `POST /api/v1/acars/messages`
- `POST /api/v1/flights/bulk`
- `POST /api/v1/members/sync`
- `PUT /api/v1/tenant/acars-config`
- `POST /api/v1/tenant/acars-config/test`

### Basic

Every other `POST`, `PUT`, `PATCH`, or `DELETE` under `/api/v1/*`.

GET requests and `/api/v1/internal/*` are excluded. A direct production `curl` mutation without browser challenge proof is expected to receive `403`, even with a valid Clerk token. Read-only API clients remain possible; non-browser mutation use requires an explicitly designed trusted-client authentication path rather than weakening BotID globally.

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

| Method   | Path                        | Minimum access | Purpose                                          |
| -------- | --------------------------- | -------------- | ------------------------------------------------ |
| `GET`    | `/tenant`                   | Authenticated  | Current tenant and ACARS configuration state     |
| `PATCH`  | `/tenant`                   | Admin          | Update tenant name/settings                      |
| `PUT`    | `/tenant/acars-config`      | Admin          | Test and save station/logon                      |
| `POST`   | `/tenant/acars-config/test` | Admin          | Test saved configuration                         |
| `DELETE` | `/tenant/acars-config`      | Admin          | Remove encrypted logon and test timestamp        |
| `GET`    | `/members`                  | Dispatcher     | List tenant memberships                          |
| `PATCH`  | `/members/{id}`             | Admin          | Change role, name, callsign, or status           |
| `POST`   | `/members/sync`             | Dispatcher     | Synchronize up to 100 Clerk organization members |

### Schedule requests

| Method | Path                             | Minimum access      | Purpose                                            |
| ------ | -------------------------------- | ------------------- | -------------------------------------------------- |
| `POST` | `/schedule-requests`             | Authenticated       | Create request owned by caller membership          |
| `GET`  | `/schedule-requests`             | Authenticated       | Own requests for pilots; tenant queue for dispatch |
| `GET`  | `/schedule-requests/{id}`        | Owner or dispatcher | Request plus linked flights                        |
| `POST` | `/schedule-requests/{id}/cancel` | Owner or dispatcher | Cancel in an allowed state                         |
| `POST` | `/schedule-requests/{id}/review` | Dispatcher          | Start review                                       |
| `POST` | `/schedule-requests/{id}/reject` | Dispatcher          | Reject with optional reason                        |

### Flights

| Method  | Path                    | Minimum access                        | Purpose                                                  |
| ------- | ----------------------- | ------------------------------------- | -------------------------------------------------------- |
| `POST`  | `/flights`              | Dispatcher                            | Create draft or offered flight                           |
| `POST`  | `/flights/bulk`         | Dispatcher                            | Create a request-linked offered batch                    |
| `GET`   | `/flights`              | Authenticated                         | Assigned flights for pilots; tenant flights for dispatch |
| `GET`   | `/flights/{id}`         | Assigned pilot or dispatcher          | Get flight                                               |
| `PATCH` | `/flights/{id}`         | Dispatcher                            | Edit non-completed/non-cancelled flight                  |
| `POST`  | `/flights/{id}/offer`   | Dispatcher                            | Draft to offered                                         |
| `POST`  | `/flights/{id}/accept`  | Assigned pilot                        | Offered to accepted                                      |
| `POST`  | `/flights/{id}/decline` | Assigned pilot                        | Offered to declined, optional reason                     |
| `POST`  | `/flights/{id}/cancel`  | Eligible assigned pilot or dispatcher | Cancel, optional reason                                  |
| `POST`  | `/flights/{id}/status`  | Dispatcher                            | Brief, activate, complete, or cancel                     |

### Dispatch and ACARS

| Method | Path                   | Minimum access        | Purpose                                                   |
| ------ | ---------------------- | --------------------- | --------------------------------------------------------- |
| `GET`  | `/dispatch/board`      | Dispatcher            | Seven-day operational board and request counts            |
| `GET`  | `/dispatch/inbox`      | Dispatcher            | Newest 50 ACARS messages                                  |
| `GET`  | `/acars/messages`      | Dispatcher            | Filter/paginate messages by direction, station, or flight |
| `POST` | `/acars/messages`      | Dispatcher            | Send and then persist accepted telex                      |
| `GET`  | `/acars/messages/{id}` | Dispatcher            | Message detail including raw provider data                |
| `POST` | `/acars/simulate`      | Dispatcher, mock only | Queue and ingest synthetic inbound message                |

### Internal

| Method          | Path                        | Authentication                           | Purpose                               |
| --------------- | --------------------------- | ---------------------------------------- | ------------------------------------- |
| `GET` or `POST` | `/internal/cron/acars-poll` | Cron bearer                              | Poll configured Hoppie tenants        |
| `POST`          | `/internal/seed/vsas`       | Cron bearer or non-production dev bypass | Create/repair vSAS and optional admin |

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
