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
```

If Vercel Services is unavailable, deploy `apps/web` and `apps/api` separately and set the web project's `API_ORIGIN` to the public API origin. The Next.js rewrite keeps browser requests on same-origin `/api/*`.

## External services

### Neon PostgreSQL

- Choose a region and plan consistent with legal and latency requirements.
- Scale-to-zero is the intended idle behavior.
- The application uses Neon's HTTP driver and no persistent pool.
- Cold start on the first query after suspension is expected.
- Define backup and tested restore procedures separately; they are not encoded in the repository.

### Clerk

- Enable Organizations and organization slugs.
- Create the vSAS organization with slug `vsas`.
- Store its ID in `VSAS_CLERK_ORG_ID`.
- Map organization roles deliberately and review access periodically.

### Hoppie

- Register a dedicated ground-station account for each tenant using live ACARS.
- Configure and test it in the admin UI after deployment.
- Keep personal pilot logons out of VA Dispatch.
- Treat the network as non-confidential store-and-forward transport.

### Vercel

- Configure both services and all server/public environment values.
- Enable Secure Backend Access with OIDC Federation for BotID server verification.
- Use an eligible plan for Deep Analysis and the one-minute cron.
- Configure spend notifications for Deep Analysis and other metered features.

## Deployment sequence

1. Review and merge a green commit on `main`.
2. Provision or select Neon, Clerk, and Vercel environments.
3. Configure API, web, legal, source-link, and secret values from [Configuration Reference](https://github.com/shiftbloom-studio/va-dispatcher/wiki/Configuration-Reference).
4. Apply the database schema through an approved database-change process.
5. Deploy web and API services.
6. Seed or verify the trusted vSAS tenant mapping.
7. Sign in through `/vsas` and verify role routing.
8. Load and review `/impressum` and `/privacy` before public promotion.
9. Configure/test Hoppie from an admin account.
10. Verify BotID, cron polling, headers, logs, and a synthetic end-to-end workflow.

Example initial tooling flow:

```bash
vercel login
vercel link
vercel integration add neon
vercel integration add clerk
vercel env pull apps/api/.env.local --yes
```

Do not apply `db:push`, seed data, or deployment changes to a shared environment without explicit operator approval and a rollback plan.

## Tenant bootstrap

The initial tenant can be seeded with the cron secret:

```bash
curl -X POST https://example.test/api/v1/internal/seed/vsas \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{"clerkOrgId":"org_...","adminClerkUserId":"user_..."}'
```

Alternatively, the first authenticated request from the exact `VSAS_CLERK_ORG_ID` can create or repair the `vsas` tenant mapping. No other Clerk organization receives that bootstrap behavior.

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

## Observability

Current signals are:

- Vercel function/build/cron logs;
- `X-Request-Id` correlation;
- Vercel Firewall/BotID events;
- consent-gated Web Analytics and Speed Insights;
- GitHub Actions CI and security checks; and
- database audit-event rows for selected mutations.

There is no Sentry integration, distributed tracing backend, metrics dashboard, or audit-log UI in the current default branch. Do not describe the health endpoint or optional analytics as full application monitoring.

## Production verification

### Identity and tenancy

- Unknown slug returns not found before business reads.
- Signed-out tenant route redirects to tenant sign-in.
- Wrong active organization shows mismatch without tenant data.
- Pilot, dispatcher, and admin land in the expected surface.
- Disabled membership is denied.

### Security and privacy

- HTTPS and HSTS are present.
- Frame, content-type, referrer, permissions, and CSP headers match policy.
- BotID blocks an automated Basic and Deep Analysis mutation.
- Public legal pages load without Clerk scripts.
- Optional analytics makes no request before affirmative consent and stops events after withdrawal.
- `NEXT_PUBLIC_SOURCE_URL` resolves to the corresponding deployed source.

### Business workflow

- A synthetic pilot creates a UTC request.
- Dispatch reviews and offers the exact flight count.
- The pilot accepts; dispatch briefs, activates, and completes.
- An admin tests Hoppie.
- Dispatch sends a harmless synthetic telex and receives a harmless response.

## Rollback and recovery

- Roll back application code to a known green `main` commit through the deployment platform.
- Treat schema rollback separately; never assume code rollback reverses data changes.
- Preserve audit and operational history unless an approved retention/incident procedure says otherwise.
- If `TENANT_SECRETS_KEY` is wrong, restore the correct key or re-enter tenant credentials after an intentional rotation; do not log ciphertext/plaintext while diagnosing.
- If Hoppie is unstable, leave drafts intact and pause manual retries. There is no automatic retry queue to drain.
- Test Neon restoration and Clerk access recovery before they are needed.

## Cost profile

The design targets near-zero idle application compute:

- Neon can autosuspend;
- Clerk is hosted and usage-based;
- Vercel functions charge around invocation/active compute rather than an always-on process; and
- no Redis or external queue is part of v1.

The one-minute Hoppie cron creates regular invocations and normally requires Vercel Pro. Deep Analysis checks can also be metered. Re-evaluate the cost model before adding queues, telemetry ingestion, high-frequency polling, or third-party observability.

## Release hygiene

- Release only reviewed, green commits from `main`.
- Use semantic version tags and publish user-visible changes and upgrade notes.
- Never attach environment files, production data, credentials, or private logs.
- State schema/config compatibility and rollback steps.
- Confirm AGPL corresponding-source links for hosted forks.
- Re-run auth, provider, header, cookie, browser, and privacy checks after dependency or platform upgrades.
