# Troubleshooting

Start with the visible error and its `X-Request-Id`. Avoid changing credentials, tenant mappings, or database state until you have traced the actual request path.

## Fast diagnostic sequence

1. `GET /health` and record `env`, `database`, and `acarsProvider`.
2. Check browser network response status, error code, and `X-Request-Id`.
3. Confirm the URL slug and that the account belongs to that tenant's stem organization.
4. Confirm `/me` and `/tenant` return the same tenant.
5. Confirm membership status and role.
6. Check the specific API/service logs by request ID.
7. Reproduce with synthetic data in the lowest safe environment.

## Authentication and tenant errors

### Sign-in ends on "Sign-in failed"

- `state`: the sign-in step took longer than 10 minutes or was opened in another browser. Start again from `/:slug/sign-in`.
- `provider`: stem rejected the code exchange or the ID token. Check that the web Worker's `AUTH_ISSUER`, `AUTH_CLIENT_ID`, `AUTH_CLIENT_SECRET`, and `AUTH_AUDIENCE` match the registered client, that `APP_ORIGIN` matches the registered redirect URI, and that the resource is listed in stem's `RESOURCES`.

### Redirected to sign-in repeatedly

- Confirm `AUTH_SESSION_SECRET` is set and stable; changing it signs everyone out.
- Confirm the access token's `aud` matches the API's `AUTH_AUDIENCE`.
- Confirm tenant auth routes are inside `/:slug`.
- Confirm session cookies are not blocked.
- Confirm `API_INTERNAL_URL` or `API_ORIGIN` reaches the API.
- Check `/me` for 401 and its request ID.

### Sent to the join page although the account is a member

The access token's `orgs` claim does not contain the tenant's organization yet. Role and membership changes reach the token at the next refresh, within 10 minutes; signing in again picks them up at once. Do not bypass this by weakening the organization check.

### “This organization is not registered as a VA tenant”

- Verify the stem organization ID, not only its name or slug.
- Verify `VSAS_AUTH_ORG_ID` in the API.
- Inspect the `tenants.auth_org_id` mapping.
- Sign in through the exact trusted vSAS organization to allow repair; the
  production seed endpoint deliberately returns not found.

### “Membership is not active”

The local membership is `invited` or `disabled`. Check `/vsas/join` for a
pending application. An administrator must approve it or restore/remove the
member through the authorized tenant workflow. Directory presence alone
never reactivates local access.

### Invitation was accepted but access is still denied

Confirm the invitation role is `pilot` or `dispatcher` and its organization
belongs to the tenant URL. A role granted moments ago appears in the token at
the next refresh or sign-in. If
the user already has a disabled/invited local record, review it in VA Dispatch;
do not delete application history or bypass local status. A failed removal can
also leave a safe disabled record plus a stale stem membership - repeat **Remove
from organization** to finish provider synchronization.

### Invitation sends an error or sync finds no new member

- Record the visible status, message, and request ID. A provider rejection can
  indicate a missing `pilot`/`dispatcher` entry in stem's `ORG_ROLES` or an invitation
  return URL outside the registered redirect origins. Verify the Worker's
  explicit `APP_ORIGIN`.
- In local auth-bypass mode, live invitations are intentionally disabled
  and directory sync is a no-op. Set `AUTH_DEV_BYPASS=false` only in a safe
  environment configured with a registered stem client when testing this flow.
- Pending invitations cannot be synchronized. The recipient must accept a
  tenant organization invitation before first tenant access or **Sync account
  directory** can create the local row.
- An account created without an invitation is not a tenant member. Send the
  user to `/:slug/join` and approve their pilot/dispatcher request in VA
  Dispatch.
- Treat a sync result with skipped entries as incomplete; stem did not return
  the stable user ID needed for a tenant-scoped membership row, or an existing
  pending/disabled local member requires explicit administrator review.

### Wrong role after a stem change

Runtime authorization uses the local membership. Run the paged stem directory
synchronization or update the membership as an Admin, then verify the
conservative mapping. First provisioning is audited as pilot or dispatcher. The sole
authentication-time exception promotes a verified organization owner or admin
when the tenant has no active application Admin; it does not keep syncing token
claims on later requests.

## API and web contract errors

### Authenticated routes fail with a database error

The health endpoint can still respond without a schema. Locally, run
`pnpm db:migrate:local`. In production, confirm the `DB` binding points at the
`va-dispatch` database and that the API build applied its migrations, then
authenticate through the trusted stem organization.

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

### Production mutation returns `403 Automated requests are not allowed`

Cloudflare scored the request as automated. Scripts and `curl` are expected to fail on protected mutations. Test through the deployed web UI and inspect the request in Security Analytics. Do not lower the threshold to make an undocumented machine client work.

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

Verify the API Worker's `* * * * *` cron trigger runs (Workers → Settings → Triggers, and its logs) and `hoppiePollingEnabled` is true. The web adds up to about 10 seconds after storage. Slower cron plans create correspondingly slower inbound delivery.

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

### Remote D1 migration fails

`wrangler d1 migrations apply --remote` needs the rendered
`wrangler.deploy.jsonc` with the real database ID. Run `pnpm --filter
@va-dispatch/api config` with `VA_D1_DATABASE_ID` set, or let Workers Builds
run the deploy. Restore a bad migration with D1 Time Travel.

## Reporting a reproducible problem

Include:

- component and commit;
- environment type, not credentials;
- expected and actual behavior;
- request ID and redacted status/error envelope;
- minimal synthetic reproduction; and
- relevant test/log excerpt with personal and operational data removed.

Use the support or bug issue form. Report vulnerabilities privately through [`SECURITY.md`](https://github.com/shiftbloom-studio/va-dispatcher/blob/main/SECURITY.md).
