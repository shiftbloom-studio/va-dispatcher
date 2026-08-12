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
- Seed or allow trusted vSAS repair; do not auto-provision an arbitrary organization.

### “Membership is not active”

The local membership is `invited` or `disabled`. An administrator must review and change it through the authorized membership workflow.

### Wrong role after a Clerk change

Runtime authorization uses the local membership. Run the Clerk member synchronization endpoint as dispatch/admin or update the membership as admin, then verify the conservative role mapping.

## API and web contract errors

### `DATABASE_URL is required for authenticated routes`

The health endpoint can still respond without a database. Configure `DATABASE_URL`, apply the schema, and seed the tenant.

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

Check `pilotMembershipId`. Pilots see only assigned flights. The web prevents an unassigned immediate ad-hoc offer, but API callers must preserve that invariant.

### Request cancellation did not cancel flights

That is the current contract. Request and flight lifecycles do not cascade. Cancel eligible flights separately through dispatcher or pilot actions.

### Historical partial request cannot receive more rows

The current dispatcher UI does not append partial proposals. It keeps `partially_fulfilled` records viewable and cancellable.

### Old flight remains on operations board

The board has a seven-day upper ETD horizon but no lower bound for non-terminal records. Correct the lifecycle status or schedule after verifying the real operation.

### Active flight is not grouped on the pilot dashboard

The current pilot dashboard groups offered, upcoming accepted/briefed, and terminal history. `active` is available through the direct assigned flight detail but has no dashboard group yet.

## Hoppie and ACARS

### ACARS is read-only / setup required

Production has no mock fallback. An admin must test and save the tenant station and Hoppie logon. Confirm `TENANT_SECRETS_KEY` is valid and stable.

### `422 UNPROCESSABLE`

Usually the tenant ground station is not configured or required configuration input is missing. Open organization settings as an administrator.

### `502 UPSTREAM`

The API reached a provider policy/error path. The safe error details distinguish authentication, callsign lock, rate limit, timeout, unavailable, rejection, or invalid response. The outbound record was not stored; the frontend draft should remain.

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

There is no telemetry parser or live map. Position/progress are stored as message types and raw text only.

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

Supply `DATABASE_URL` in the command environment or ensure the approved development environment is loaded. Confirm the target before running any schema mutation.

## Reporting a reproducible problem

Include:

- component and commit;
- environment type, not credentials;
- expected and actual behavior;
- request ID and redacted status/error envelope;
- minimal synthetic reproduction; and
- relevant test/log excerpt with personal and operational data removed.

Use the support or bug issue form. Report vulnerabilities privately through [`SECURITY.md`](https://github.com/shiftbloom-studio/va-dispatcher/blob/main/SECURITY.md).
