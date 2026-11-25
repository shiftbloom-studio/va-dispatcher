# Integrated end-to-end testing

VA Dispatch has two intentionally different Playwright suites:

- `pnpm --filter @va-dispatch/web test:e2e` is the fast browser smoke suite. It
  uses deterministic route fixtures and does not prove database persistence.
- `pnpm test:e2e:integrated` starts the real Next.js application and Hono API,
  authenticates synthetic tenant members, and persists every operation in an
  in-memory local D1 database created for the run.

The integrated suite is deliberately small. One pilot journey covers cold
load, sign-in, role denial, schedule creation and cancellation, flight
acceptance, release consumption, start/finish, reload persistence, assets,
styles, and sign-out. One dispatcher journey covers request fulfillment,
release publication, deterministic SimBrief and Navigraph flows, ACARS
send/poll/store behavior, and cross-tenant denial.

## Run locally

The API process creates a fresh in-memory D1 database (Miniflare) and applies
every migration on start, so no database setup is needed and nothing outside
the run is touched:

```bash
pnpm test:e2e:integrated
```

Install Chromium once if Playwright reports that it is missing:

```bash
pnpm --filter @va-dispatch/web exec playwright install chromium
```

The API harness seeds only tenants with the fixed synthetic Clerk organization
IDs `org_e2e_vsas` and `org_e2e_other`.

## Isolation and provider boundaries

The integrated process has a dedicated fixture authority, separate from
`CRON_SECRET`. It seeds synthetic pilot, dispatcher, admin, and outside-tenant
members. Browser identity still travels through the Next.js proxy, API auth
context, role checks, tenant predicates, repositories, and D1.

Fixture mode is rejected when `NODE_ENV=production`, requires an explicit
high-entropy `E2E_FIXTURE_SECRET`, and cannot be enabled by
`AUTH_DEV_BYPASS` alone. The normal `/internal/seed/vsas` convenience route is
also absent in production, even when a caller knows the cron secret.

Automated tests never call Clerk, Hoppie, SimBrief, Navigraph, or Aviation
Weather. The harness:

- uses the database-backed ACARS mock and exercises its inbound polling queue;
- returns deterministic SimBrief OFP and Navigraph token/UserInfo responses;
- serves local synthetic weather; and
- rejects every other non-local API-process network request.

Only failure traces and screenshots are retained, for seven days in CI. Test
data, messages, names, credentials, and provider responses are synthetic. Do
not add production exports or real credentials to fixtures or artifacts.

## Deployed browser acceptance

The integrated fixture is intentionally unavailable on a deployed production
URL. A deployment acceptance pass therefore needs real, authorized test
accounts and configuration:

- D1 migrations applied and a healthy API Worker, with the `<host>/api/*` zone
  route and the web Worker's `API` service binding in place;
- valid Clerk keys, email-enabled Waitlist mode, the configured vSAS
  organization, and pilot, dispatcher, and admin test memberships whose active
  organization matches `/vsas`;
- complete mandatory `LEGAL_*` configuration;
- Bot Management scores present on API requests (Security → Analytics); and
- tenant Hoppie, SimBrief, and Navigraph configuration before exercising those
  live providers. Do not send operational ACARS traffic without an agreed test
  station and recipient.

Check each role in a fresh browser profile and after a hard reload:

1. Open `/vsas` signed out and verify the branded auth shell, logo, stylesheet,
   fonts, and scripts load without a `4xx`/`5xx` response.
2. With a synthetic unused email, join `/vsas/waitlist`, verify the confirmation
   email, invite the entry in Clerk, complete the default Clerk Account Portal
   sign-up flow, and confirm its configured fallback reaches `/vsas/join`. Then
   submit and approve a tenant-role application. Separately verify that an
   invitation redirected into the application can complete through the
   tenant-branded `/vsas/sign-up` route.
3. Sign in, navigate across the role's workspace, reload each primary page,
   sign out, and sign back in as the next role. There must be no repeated
   sign-in or organization-selection redirect.
4. Exercise the pilot schedule/flight journey and dispatcher
   request/release/ACARS journey, then reload to prove persistence.
5. Observe loading feedback with a slow API response and confirm a failed API
   response produces a stable error view whose retry recovers.

If a deployed reload loses styling or assets, inspect the web build output,
Worker routing, and CDN responses for `/_next/*` before changing components.
If the tenant logo fails while other assets load, verify its stored public URL
and that the object exists in the R2 logo bucket. Repeated auth redirects normally indicate a
mismatch between the URL slug, active Clerk organization, API-resolved tenant,
or local membership; inspect those identities rather than bypassing the shell.
