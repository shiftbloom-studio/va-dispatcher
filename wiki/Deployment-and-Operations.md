# Deployment and Operations

The primary production target is Vercel with a Next.js web service, Hono API service, Neon PostgreSQL, Clerk Organizations, and Hoppie's ACARS.

## Primary topology

`vercel.ts` defines a multi-service project:

```text
public request
├── /api/*  -> api service (apps/api, src/index.ts)
└── /*      -> web service (apps/web)

web -- API_INTERNAL_URL service binding --> api
Vercel cron (* * * * *) ----------------> /api/v1/internal/cron/acars-poll
Vercel cron (0 * * * *) ----------------> /api/v1/internal/cron/privacy-lifecycle
```

If Vercel Services is unavailable, deploy `apps/web` and `apps/api` separately and set the web project's `API_ORIGIN` to the public API origin. The Next.js rewrite keeps browser requests on same-origin `/api/*`.

## External services

### Neon PostgreSQL

- Choose a region and plan consistent with legal and latency requirements.
- Scale-to-zero is the intended idle behavior.
- The application uses Neon's HTTP driver and no persistent pool.
- Cold start on the first query after suspension is expected.
- This pre-production project uses a new empty database for each incompatible
  schema iteration; take an optional snapshot only when test data is worth keeping.

### Clerk

- Enable Organizations with optional membership and organization slugs.
- Disable user-created organizations, automatic first-organization creation,
  and Verified Domain enrollment/membership requests.
- Add `org:pilot` and `org:dispatcher` to the Primary Role Set alongside
  `org:admin`; use pilot as the new-member default.
- Create the vSAS organization with slug `vsas`.
- Store its ID in `VSAS_CLERK_ORG_ID`.
- Keep Clerk Dashboard team access global-only. Review tenant application roles
  and organization membership periodically through VA Dispatch.

### Hoppie

- Register a dedicated ground-station account for each tenant using live ACARS.
- Configure and test it in the admin UI after deployment.
- Keep personal pilot logons out of VA Dispatch.
- Treat the network as non-confidential store-and-forward transport.

### Flight planning and branding

- Configure the exact public SimBrief and Navigraph callback URLs before
  enabling account linking or pilot-owned generation.
- SimBrief preparation is local; the assigned pilot launches the prepared
  revision and the signed callback imports the OFP.
- Dispatch release weather uses Aviation Weather and degrades to an explicit
  unavailable state when that provider cannot be reached.
- Vercel Blob is required only for tenant logo upload; the remaining brand
  settings stay in PostgreSQL.

### Vercel

- Configure both services and all server/public environment values.
- Let GitHub Actions coordinate deployments; checked-in configuration disables
  Vercel's independent Git deployment so CI and readiness finish first.
- The workflow disables custom Production-domain assignment on each deployment
  request, then promotes the staged build only after readiness passes.
- Enable Secure Backend Access with OIDC Federation for BotID server verification.
- Use an eligible plan for Deep Analysis and the one-minute cron.
- Configure spend notifications for Deep Analysis and other metered features.

## Deployment sequence

1. Provision or select Neon, Clerk, and Vercel environments.
2. Configure API, web, legal, source-link, and secret values from [Configuration Reference](https://github.com/shiftbloom-studio/va-dispatcher/wiki/Configuration-Reference).
3. Configure the one-time GitHub `VERCEL_TOKEN` secret, Vercel project/team and
   repository variables, and the `Preview` and `Production` environments
   described in `docs/maintainer-setup.md`. Configure Protection Bypass for
   Automation in Vercel; the workflow reads its current value only for
   readiness while Vercel Authentication remains enabled on Preview deployments.
4. For a schema change, with explicit operator approval, recreate the intended
   empty database and run `pnpm db:push` from the exact validated revision. The
   deployment workflow never changes the database.
5. Open or update an internal pull request. GitHub runs the database contracts,
   quality checks, and integrated E2E suite. A separate default-branch workflow
   then deploys that exact successful commit without executing pull-request code
   with deployment credentials. Vercel builds the application and exposes a
   preview only if `/api/ready` confirms the pre-provisioned schema.
6. Review and merge the green pull request. The deployment workflow repeats for
   the exact successful `main` commit, verifies the staged deployment, and then
   promotes it to Production.
7. Verify `VSAS_CLERK_ORG_ID`, then let the first authenticated request from
   that exact organization create or repair the trusted vSAS mapping.
8. Sign up through `/vsas`, submit a pilot or dispatcher application, approve
   it in the tenant Admin console, select the organization, and verify routing.
9. Load and review `/impressum` and `/privacy` before public promotion.
10. As an Admin, configure/test Hoppie and branding; as the assigned pilot and
    dispatcher, verify any enabled SimBrief, Navigraph, and weather integration.
11. Verify BotID, both cron routes, headers, logs, and a synthetic end-to-end
    workflow.

Example initial tooling flow:

```bash
vercel login
vercel link
vercel integration add neon
vercel integration add clerk
vercel env pull apps/api/.env.local --yes
```

Do not apply schema, seed, or deployment changes to a shared environment
without explicit operator approval and a rollback plan. This project replaces
its pre-production database rather than evolving an existing catalog. The
readiness gate detects a missing or incompatible workspace schema but does not
repair it.

## Tenant bootstrap

Production returns not found for `/internal/seed/vsas`. The first authenticated
request from the exact `VSAS_CLERK_ORG_ID` creates or repairs the `vsas` tenant
mapping. A new local membership is provisioned and audited as a pilot or
dispatcher according to its verified Clerk role. A verified Clerk organization
Admin may use the serialized recovery path only while the tenant has no active
application Admin; later changes use the Admin control plane. No other Clerk
organization receives that bootstrap behavior.

The seed route remains a non-production convenience for disposable local
environments, using either the development auth bypass or cron bearer.

## Health and readiness

`GET /health` returns:

```json
{
  "ok": true,
  "service": "va-dispatch-api",
  "env": "production",
  "database": true,
  "acarsProvider": "hoppie"
}
```

This is a liveness/configuration endpoint. `database: true` means `DATABASE_URL` is configured; it does not execute a database query. Use a synthetic authenticated read when verifying database readiness.

`GET /ready` performs zero-row projections across the tenant and membership
tables. It verifies database connectivity and the columns required for tenant
bootstrap and authorization without reading or returning user records. GitHub
Actions requires `database: true` and `schema: true` from this endpoint before
it marks a preview or Production deployment ready.

## ACARS cron operations

The one-minute cron is required for normal inbound latency. It:

- authenticates with `CRON_SECRET`;
- skips the mock provider;
- selects only tenants with encrypted Hoppie credentials;
- isolates a failure to one tenant; and
- returns tenant/message counts plus a skip explanation when applicable.

Operational checks:

- verify scheduled invocations occur every minute;
- watch for sustained tenant-specific failures;
- investigate callsign-lock or rate-limit errors without aggressive retries;
- ensure only one live poller owns a station; and
- confirm no credential or message body is added to routine logs.

## Privacy lifecycle cron operations

The hourly cron authenticates with `CRON_SECRET` and processes only bounded,
queued work that has already passed the required Admin approval. Policies,
legal holds, requests, and execution approval remain operator-controlled.
External-provider and backup tasks remain visible until an operator records
their completion; the cron does not claim external erasure. Follow
`docs/privacy-operations.md` for approval, evidence, and recovery procedures.

## Observability

Current signals are:

- Vercel function/build/cron logs;
- `X-Request-Id` correlation;
- Vercel Firewall/BotID events;
- consent-gated Web Analytics and Speed Insights;
- GitHub Actions CI and security checks; and
- database audit-event rows plus the Admin audit viewer and bounded export.

There is no Sentry integration, distributed tracing backend, or metrics
dashboard. Do not describe the health endpoint, audit viewer, or optional
analytics as full application monitoring.

## Production verification

### Identity and tenancy

- Unknown slug returns not found before business reads.
- Signed-out tenant route redirects to tenant sign-in.
- Wrong active organization shows mismatch without tenant data.
- Pilot, dispatcher, and admin land in the expected surface.
- Disabled membership is denied.
- Signed-in users without an organization can see only their tenant
  application state, not operational data.
- Pilot and dispatcher applications require an explicit tenant-admin decision.
- Removing a member disables local access even if Clerk removal is temporarily
  unavailable; a retry completes provider synchronization.

### Security and privacy

- HTTPS and HSTS are present.
- Frame, content-type, referrer, permissions, and CSP headers match policy.
- BotID blocks an automated Basic and Deep Analysis mutation.
- Public legal pages load without Clerk scripts.
- Optional analytics makes no request before affirmative consent and stops events after withdrawal.
- `NEXT_PUBLIC_SOURCE_URL` resolves to the corresponding deployed source.

### Business workflow

- A synthetic pilot creates and, while eligible, edits or cancels a UTC request.
- Dispatch reviews and idempotently offers the requested count, including an
  append to a partially fulfilled request.
- The pilot accepts the assignment, or reconfirms after a material
  reassignment; dispatch publishes a release; the flight starts and finishes
  through the operational lifecycle.
- When configured, dispatch prepares a SimBrief revision and the assigned pilot
  completes generation and OFP import.
- A synthetic pilot issues a simulator device token, submits sequenced
  presence/OOOI data, verifies it on the dispatcher board, and revokes it.
- An admin tests Hoppie.
- Dispatch sends a harmless synthetic telex and receives a harmless response.
- An admin can inspect redacted audit history and the configured privacy
  workflow without executing destructive external work.
- An admin can invite a pilot/dispatcher, approve or reject a synthetic
  application, change an active role, and safely remove the synthetic member.

## Rollback and recovery

- Roll back application code to a known green `main` commit through the deployment platform.
- Roll schema back by reconnecting the previous untouched test database, or
  recreate another empty database from the prior green commit.
- Preserve audit and operational history unless an approved retention/incident procedure says otherwise.
- If `TENANT_SECRETS_KEY` is wrong, restore the correct key before issuing new
  simulator tokens or starting provider callbacks. Intentional rotation also
  requires re-entering Hoppie credentials and restarting pending SimBrief or
  Navigraph flows; do not log ciphertext or plaintext while diagnosing.
- ACARS stores an explicit `accepted`, `rejected`, or `ambiguous` outcome after
  its single send. There is no automatic retry queue; inspect ambiguous rows
  before deciding whether a manual resend is safe.
- Test Neon restoration and Clerk access recovery before they are needed.

## Cost profile

The design targets near-zero idle application compute:

- Neon can autosuspend;
- Clerk is hosted and usage-based;
- Vercel functions charge around invocation/active compute rather than an always-on process; and
- no Redis or external queue is part of v1.

The one-minute Hoppie cron, hourly privacy cron, and simulator telemetry create
regular invocations; the one-minute schedule normally requires Vercel Pro.
Deep Analysis checks and external provider traffic can also be metered.
Re-evaluate the cost model before adding queues, higher-frequency polling, or
third-party observability.

## Release hygiene

- Release only reviewed, green commits from `main`.
- Use semantic version tags and publish user-visible changes and upgrade notes.
- Never attach environment files, production data, credentials, or private logs.
- State schema/config compatibility and rollback steps.
- Confirm AGPL corresponding-source links for hosted forks.
- Re-run auth, provider, header, cookie, browser, and privacy checks after dependency or platform upgrades.
