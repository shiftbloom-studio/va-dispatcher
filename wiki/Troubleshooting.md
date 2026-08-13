# Troubleshooting

Start with the visible error and its `X-Request-Id`. Avoid changing credentials, tenant mappings, or database state until you have traced the actual request path.

## Fast diagnostic sequence

1. `GET /health` and record `env`, `database`, and `acarsProvider`.
2. Check browser network response status, error code, and `X-Request-Id`.
3. Confirm the URL slug and active Clerk organization slug.
4. Confirm `/me` and `/tenant` return the same tenant.
5. Confirm membership status and role.
6. Check the specific API/service logs by request ID.
7. Reproduce with synthetic data in the lowest safe environment.

## Authentication and tenant errors

### Redirected to sign-in repeatedly

- Confirm the Clerk publishable and secret keys belong to the same instance.
- Confirm tenant auth routes are inside `/:slug`.
- Confirm session cookies are not blocked.
- Confirm `API_INTERNAL_URL` or `API_ORIGIN` reaches the API.
- Check `/me` for 401 and its request ID.

### “Select the organization matching this Virtual Airline URL”

The active Clerk organization slug differs from the URL. Select the vSAS organization for `/vsas`; do not bypass this by weakening the slug check.

### “This organization is not registered as a VA tenant”

- Verify the Clerk organization ID, not only its name or slug.
- Verify `VSAS_CLERK_ORG_ID` in the API.
- Inspect the `tenants.clerk_org_id` mapping.
- Sign in through the exact trusted vSAS organization to allow repair; the
  production seed endpoint deliberately returns not found.

### “Membership is not active”

The local membership is `invited` or `disabled`. Check `/vsas/join` for a
pending application. An administrator must approve it or restore/remove the
member through the authorized tenant workflow. Clerk directory presence alone
never reactivates local access.

### Invitation was accepted but access is still denied

Confirm the invitation role is `org:pilot` or `org:dispatcher`, its organization
slug matches the tenant URL, and the user selected that active organization. If
the user already has a disabled/invited local record, review it in VA Dispatch;
do not delete application history or bypass local status. A failed removal can
also leave a safe disabled record plus a stale Clerk membership—repeat **Remove
from organization** to finish provider synchronization.

### Wrong role after a Clerk change

Runtime authorization uses the local membership. Run the paged Clerk directory
synchronization or update the membership as an Admin, then verify the
conservative mapping. First provisioning is audited as pilot or dispatcher. The sole
authentication-time exception promotes a verified Clerk organization Admin
when the tenant has no active application Admin; it does not keep syncing Clerk
claims on later requests.

## API and web contract errors

### API `FUNCTION_INVOCATION_FAILED` on Vercel Services

If the API runtime log reports `ERR_MODULE_NOT_FOUND` for `hono` from
`/var/task/app.js`, the Hono service was emitted without its pnpm workspace
dependencies. The API service keeps `vercel-entry.ts` checked in because
Vercel validates the path before its service build, then replaces that file in
the isolated build checkout with a dependency-complete bundle. Run
`pnpm run build:vercel` locally; the command writes to `dist/` and imports the
result from an isolated temporary directory before accepting the build.
Do not add one missing package at a time to the function because the next bare
runtime import will fail in the same way.

### `DATABASE_URL is required for authenticated routes`

The health endpoint can still respond without a database. Configure
`DATABASE_URL`, apply canonical `schema.ts` to a new empty database with
`pnpm db:push`, and authenticate through the trusted Clerk organization.

### `INVALID_RESPONSE` in the web UI

The API returned success JSON that did not match the web Zod schema. Compare:

- route serializer;
- OpenAPI schema;
- `apps/web/src/lib/api/schemas.ts`; and
- the actual response captured with its request ID.

Do not cast around the parser.

### `INVALID_TRANSITION`

The requested status change is not allowed from the current status. Reload the record and use the state diagrams in [Flights and State Machines](https://github.com/shiftbloom-studio/va-dispatcher/wiki/Flights-and-State-Machines) or [Scheduling and Dispatch](https://github.com/shiftbloom-studio/va-dispatcher/wiki/Scheduling-and-Dispatch).

### Cursor errors

Send `nextCursor` back unchanged. A malformed or decoded/re-encoded cursor returns `400 BAD_REQUEST`.

### Production mutation returns BotID `403`

Direct `curl`, scripts, or clients without browser challenge proof are expected to fail on protected mutations. Test through the deployed web UI and inspect BotID events. Do not disable BotID to make an undocumented machine client work.

## Schedule and flight issues

### Offered flight is invisible to a pilot

Check `pilotMembershipId`. Pilots see only assigned flights, and the API rejects
an offered flight without a valid active pilot assignment. Also check whether a
later reassignment created a new assignment revision that still needs pilot
confirmation.

### Request cancellation did not cancel flights

Cancellation now requires an explicit linked-flight policy. Reload the request,
then choose either `keep` or `cancel_predeparture`; only eligible linked flights
are cancelled, and active or terminal flights are preserved.

### Historical partial request cannot receive more rows

Reload the request and check its remaining count and version. Appending is
allowed only while `partially_fulfilled`, requires the current request version,
and must use a fresh `Idempotency-Key` for the intended batch.

### Old flight remains on operations board

Accepted and briefed rows are shown from 24 hours overdue through seven days
ahead. Active flights are always included, while completed KPIs use the current
UTC month. Older accepted or briefed rows belong in history rather than on the
live board; correct stale lifecycle data only after verifying the operation.

### Active flight is not grouped on the pilot dashboard

Reload the dashboard and confirm the flight is still assigned to the current
pilot. Active flights have their own group; a reassignment, tenant mismatch, or
stale browser response can make the former pilot's row disappear.

## Hoppie and ACARS

### ACARS is read-only / setup required

Production has no mock fallback. An admin must test and save the tenant station and Hoppie logon. Confirm `TENANT_SECRETS_KEY` is valid and stable.

### `422 UNPROCESSABLE`

Usually the tenant ground station is not configured or required configuration input is missing. Open organization settings as an administrator.

### `502 UPSTREAM`

A normal send attempt returns a stored `accepted`, `rejected`, or `ambiguous`
outcome, including provider rejection and timeout. A `502` therefore usually
means configuration/provider setup failed before the durable send path, or a
configuration test failed. Inspect the inbox before retrying; an ambiguous
outcome may already have reached the aircraft and is never retried
automatically.

### Callsign already in use

Ensure only one poller owns the station. Stop the other client and wait about two minutes before a manual retry.

### Messages arrive slowly

Verify the Vercel cron runs every minute and `hoppiePollingEnabled` is true. The web adds up to about 10 seconds after storage. Slower cron plans create correspondingly slower inbound delivery.

### Message sent but pilot did not receive it

Hoppie acceptance is not delivery. Confirm:

- recipient callsign;
- simulator client is online and configured;
- personal and tenant accounts share network affiliation; and
- the aircraft client has initiated any flow required to appear online.

Do not resend rapidly; avoid duplicates and rate limits.

### Inbound position did not update a map

Hoppie position/progress messages remain ACARS text and do not feed the MSFS
telemetry track. Check the pilot's simulator device, current lease, sequence,
and ingest responses separately. The dispatcher currently receives live
presence and coordinates, but there is no map rendering to update.

## Legal and privacy pages

### Production legal page fails to render

Check every required `LEGAL_*` value. Addresses must contain a non-empty line, emails must be valid, the supervisory URL must be absolute HTTPS, and paired register/editorial fields must be complete.

### Analytics appears off after consent

Inspect the versioned local-storage preference and browser blocking. The current notice version must match, `analyticsAllowed` must be true, and every event is rechecked. Consent in another tab should propagate through the storage event.

### Notice appears again after an update

Expected when `LEGAL_NOTICE_VERSION` changed. A new notice version invalidates the old preference so the user can make an informed choice again.

## Local build and test issues

### Next.js behavior differs from expectation

Read `apps/web/AGENTS.md` and the matching installed guide under `apps/web/node_modules/next/dist/docs/`. This project uses Next.js 16.3, React 19.2, and TypeScript 7 for web checks.

### Browser port already in use

Playwright defaults to 3100 and does not reuse an existing server:

```bash
E2E_PORT=3200 pnpm --filter @va-dispatch/web test:e2e
```

### Playwright browser missing

```bash
pnpm --filter @va-dispatch/web exec playwright install chromium
```

### Drizzle command cannot see the database URL

Supply `DATABASE_URL` in the command environment or ensure the approved
development environment is loaded. This pre-production Shiftbloom project
expects a new empty database for `db:push`; never use a database containing data
that must be preserved.

## Reporting a reproducible problem

Include:

- component and commit;
- environment type, not credentials;
- expected and actual behavior;
- request ID and redacted status/error envelope;
- minimal synthetic reproduction; and
- relevant test/log excerpt with personal and operational data removed.

Use the support or bug issue form. Report vulnerabilities privately through [`SECURITY.md`](https://github.com/shiftbloom-studio/va-dispatcher/blob/main/SECURITY.md).
