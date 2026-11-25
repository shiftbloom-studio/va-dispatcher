# Deployment and Operations

The production target is Cloudflare: two Workers on one hostname, D1, R2, Workers KV, stem (the shiftbloom account service), and Hoppie's ACARS. The step-by-step setup lives in [`docs/cloudflare-deployment.md`](https://github.com/shiftbloom-studio/va-dispatcher/blob/main/docs/cloudflare-deployment.md).

## Primary topology

```text
public request
├── <host>/api/*  -> va-dispatch-api (apps/api, zone route)
└── <host>/*      -> va-dispatch-web (apps/web, custom domain)

va-dispatch-web -- API service binding --> va-dispatch-api
cron (* * * * *) --> va-dispatch-api scheduled(): Hoppie poll
cron (0 * * * *) --> va-dispatch-api scheduled(): privacy lifecycle
```

The zone route takes precedence over the custom domain, so browser requests stay on one origin.

## External services

### Cloudflare D1 and R2

- D1 database `va-dispatch` holds all application data. Migrations in
  `apps/api/migrations` are applied by the API deploy.
- D1 Time Travel provides 30 days of point-in-time restore.
- R2 bucket `va-dispatch-tenant-logos` stores tenant logos.

### stem

- Register a confidential client for app `va-dispatcher` with redirect URI
  `https://<host>/auth/callback`, post-logout redirect URI `https://<host>/`,
  and resource `https://<host>/api` (also listed in stem's `RESOURCES`).
- Make sure stem's `ORG_ROLES` include `dispatcher` and `pilot`.
- Create the vSAS organization with slug `vsas`.
- Store its ID in `VSAS_AUTH_ORG_ID`.
- Keep stem operator access global-only. Review tenant application roles
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
- Tenant logos are stored in R2; the remaining brand settings stay in D1.

### Cloudflare Workers

- Connect both Workers to the repository with Workers Builds and set the
  build variables and secrets from the deployment guide.
- Enable Bot Management on the zone so API requests carry a bot score.
- Configure budget alerts for Workers, D1, R2, KV, and Images.

## Deployment sequence

1. Provision the D1 database and R2 bucket, and register the app with stem.
2. Configure API, web, legal, source-link, and secret values from [Configuration Reference](https://github.com/shiftbloom-studio/va-dispatcher/wiki/Configuration-Reference) and the deployment guide.
3. Connect `va-dispatch-api` (root `apps/api`) and `va-dispatch-web` (root
   `apps/web`) with Workers Builds. Deploy the API first.
4. Open or update a pull request. GitHub Actions runs the D1 contracts, quality
   checks, the vinext build, and both browser suites.
5. Review and merge the green pull request. Workers Builds applies pending D1
   migrations and deploys both Workers from `main`.
6. Check `GET /api/ready` on the production host.
7. Verify `VSAS_AUTH_ORG_ID`, then let the first authenticated request from
   that exact organization create or repair the trusted vSAS mapping.
8. Create an account at `/vsas/sign-up`, confirm it reaches `/vsas/join`,
   submit a pilot or dispatcher application, approve it in the tenant Admin
   console, open VA Dispatch again, and verify routing. Test a direct
   invitation separately.
9. Load and review `/imprint`, `/impressum`, `/privacy`, and `/datenschutz` before public promotion.
10. As an Admin, configure/test Hoppie and branding; as the assigned pilot and
    dispatcher, verify any enabled SimBrief, Navigraph, and weather integration.
11. Verify bot scoring, both cron triggers, headers, logs, and a synthetic
    end-to-end workflow.

Do not apply schema, seed, or deployment changes to a shared environment
without explicit operator approval and a rollback plan. The readiness endpoint
detects a missing or incompatible workspace schema but does not repair it.

## Tenant bootstrap

Production returns not found for `/internal/seed/vsas`. The first authenticated
request from the exact `VSAS_AUTH_ORG_ID` creates or repairs the `vsas` tenant
mapping. A new local membership is provisioned and audited as a pilot or
dispatcher according to its verified stem role. A verified organization owner or
admin may use the serialized recovery path only while the tenant has no active
application Admin; later changes use the Admin control plane. No other stem
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

This is a liveness/configuration endpoint. `database: true` means the D1 binding is present; it does not execute a database query. Use a synthetic authenticated read when verifying database readiness.

`GET /ready` performs zero-row projections across the tenant and membership
tables. It verifies database connectivity and the columns required for tenant
bootstrap and authorization without reading or returning user records. Check
it after each deploy.

## ACARS cron operations

The one-minute cron trigger is required for normal inbound latency. It:

- runs in the API Worker's `scheduled()` handler (the HTTP route remains for
  manual runs with `CRON_SECRET`);
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

The hourly cron trigger processes only bounded,
queued work that has already passed the required Admin approval. Policies,
legal holds, requests, and execution approval remain operator-controlled.
External-provider and backup tasks remain visible until an operator records
their completion; the cron does not claim external erasure. Follow
`docs/privacy-operations.md` for approval, evidence, and recovery procedures.

## Observability

Current signals are:

- Cloudflare Workers logs and traces (observability is enabled for both Workers);
- `X-Request-Id` correlation;
- Cloudflare Security Analytics, including bot scores;
- GitHub Actions CI and security checks; and
- database audit-event rows plus the Admin audit viewer and bounded export.

There is no Sentry integration, distributed tracing backend, or metrics
dashboard. Do not describe the health endpoint or audit viewer as full
application monitoring.

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
- Removing a member disables local access even if stem removal is temporarily
  unavailable; a retry completes provider synchronization.

### Security and privacy

- HTTPS and HSTS are present.
- Frame, content-type, referrer, permissions, and CSP headers match policy.
- Requests with a low bot score are rejected on protected mutations.
- Public legal pages load without reading the session or loading third-party scripts.
- No analytics or tracking requests are made; only strictly necessary cookies are set.
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

- Roll back a Worker with **Deployments → Rollback** in the Cloudflare dashboard.
- Restore the database with D1 Time Travel
  (`wrangler d1 time-travel restore va-dispatch --timestamp <ISO time>`).
  Migrations are forward-only; a rollback across a migration needs a restore.
- Preserve audit and operational history unless an approved retention/incident procedure says otherwise.
- If `TENANT_SECRETS_KEY` is wrong, restore the correct key before issuing new
  simulator tokens or starting provider callbacks. Intentional rotation also
  requires re-entering Hoppie credentials and restarting pending SimBrief or
  Navigraph flows; do not log ciphertext or plaintext while diagnosing.
- ACARS stores an explicit `accepted`, `rejected`, or `ambiguous` outcome after
  its single send. There is no automatic retry queue; inspect ambiguous rows
  before deciding whether a manual resend is safe.
- Test a D1 Time Travel restore and stem access recovery before they are needed.

## Cost profile

Everything is usage-based with no always-on server:

- Workers bill per request and CPU time;
- D1 bills rows read/written and storage, R2 storage and operations, KV reads
  and writes, and Images unique transformations;
- stem runs on the same Cloudflare account and has no per-user fee; and
- no external queue is part of v1.

The one-minute Hoppie cron, hourly privacy cron, and simulator telemetry create
regular invocations. Re-evaluate the cost model before adding queues,
higher-frequency polling, or third-party observability.

## Release hygiene

- Release only reviewed, green commits from `main`.
- Use semantic version tags and publish user-visible changes and upgrade notes.
- Never attach environment files, production data, credentials, or private logs.
- State schema/config compatibility and rollback steps.
- Confirm AGPL corresponding-source links for hosted forks.
- Re-run auth, provider, header, cookie, browser, and privacy checks after dependency or platform upgrades.
