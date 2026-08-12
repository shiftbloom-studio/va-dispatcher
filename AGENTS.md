# AGENTS.md

This file is the working guide for coding agents and automated contributors in
the VA Dispatch repository. It applies to the whole monorepo. More specific
instructions in a nested `AGENTS.md` take precedence for that subtree; in
particular, read `apps/web/AGENTS.md` before changing the Next.js application.

## Product in one paragraph

VA Dispatch is a multi-tenant Virtual Airline operations application. Pilots
submit availability requests and manage offered flights. Dispatchers review
those requests, construct flight offers, monitor the operational board, and
exchange ACARS messages. Administrators manage tenant settings and the shared
Hoppie ground-station connection. The first configured tenant is vSAS, exposed
at `/vsas`, but persistence and authorization are tenant-scoped throughout.

The checked-out default branch is the source of truth. Do not describe a
planned or unmerged feature as implemented. The integrated product includes
revisioned dispatch releases, pilot-owned SimBrief/Navigraph workflows,
authenticated simulator telemetry and OOOI, member/audit administration, and
privacy lifecycle operations. Verify the branch before changing or documenting
any of those cross-layer contracts.

## Start here

Before changing code:

1. Read this file and any nearer `AGENTS.md`.
2. Read the relevant page under `wiki/`; the Wiki records intended behavior,
   constraints, and known limitations.
3. Inspect the implementation and tests that own the behavior. Documentation
   is guidance, not a substitute for current code.
4. Check `git status` and preserve unrelated or pre-existing changes.
5. Prefer the smallest coherent, production-quality change that fits existing
   patterns. Fix a regression at its source instead of adding compensating
   behavior elsewhere.

Do not merge, deploy, push, change production configuration, run a database
operation against a shared environment, or use real credentials/data unless
the user explicitly authorizes that action.

## Repository map

```text
apps/api/                Hono REST API, domain services, repositories, schema
apps/web/                Next.js App Router UI and browser API client
packages/eslint-config/  Shared lint configuration
docs/                    Maintainer, privacy, and cost/provisioning runbooks
wiki/                    Source mirror for the GitHub Wiki
.github/                 CI, security automation, templates, ownership
vercel.ts                Vercel Services topology, rewrites, and cron
```

Important implementation entry points:

- `apps/api/src/app.ts`: middleware order and route mounts.
- `apps/api/src/env.ts`: API configuration parsing and production safeguards.
- `apps/api/src/db/schema.ts`: database entities, enums, and relations.
- `apps/api/src/domain/`: business rules and state transitions.
- `apps/api/src/db/repositories/`: tenant-scoped persistence.
- `apps/api/src/routes/`: HTTP validation, authorization, and response shapes.
- `apps/api/src/docs/openapi.ts`: public API contract.
- `apps/web/src/app/[slug]/`: tenant-routed application pages.
- `apps/web/src/lib/api/`: browser/server clients and response schemas.
- `apps/web/src/lib/server-identity.ts`: server-side identity/tenant checks.
- `apps/web/src/lib/utc.ts`: canonical date/time conversion helpers.
- `apps/web/src/lib/tenant.ts`: frontend tenant presentation registry.
- `apps/web/src/components/`: pilot, dispatcher, ACARS, and settings workflows.

## Toolchain and commands

- Node.js: `>=24`; `.nvmrc` pins the preferred local version.
- Package manager: pnpm `11.21.0` via the root `packageManager` field.
- API: Hono, TypeScript, Drizzle ORM, Neon Postgres, Clerk, Zod, Vitest.
- Web: Next.js 16 App Router, React 19, TanStack Query, Clerk, Zod, Vitest,
  Playwright.
- Deployment: Vercel Services defined in `vercel.ts`.

Use root scripts rather than inventing local wrappers:

```bash
pnpm install
pnpm dev
pnpm dev:api
pnpm dev:web
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm build
pnpm security:audit
pnpm --filter @va-dispatch/web test:e2e
```

Database scripts are intentionally separate:

```bash
pnpm db:generate
pnpm db:check
pnpm db:migrate
pnpm db:adopt:pr29
pnpm db:signature
pnpm db:push
pnpm db:studio
```

`db:push`, `db:migrate`, and `db:studio` act on the configured database. Confirm
the target and obtain authorization before using them. `db:push` is disposable-
development-only. Released databases use the immutable PR29 baseline, guarded
legacy adoption where applicable, and additive migrations described in
`docs/database-migrations.md`. Never infer that a `.env` file is safe.

## Runtime shape and request flow

The primary deployment contains a `web` service and an `api` service. Vercel
rewrites browser `/api/*` requests to the API and supplies `API_INTERNAL_URL`
for private server-to-server calls. A supported fallback deploys both apps as
separate Vercel projects and configures the web project with `API_ORIGIN`.

The API deliberately supports both path shapes because a service rewrite can
strip `/api`:

- business API: `/api/v1/*` and `/v1/*`;
- API docs: `/api/docs/*` and `/docs/*`;
- health: `/api/health` and `/health`.

Keep both mounts working. Internal cron routes authenticate with their own
secret and are mounted before the business authentication wildcard. Middleware
ordering in `apps/api/src/app.ts` is therefore security-sensitive.

The normal authenticated browser request path is:

```text
URL tenant slug
  -> Clerk active organization
  -> server identity verification
  -> Clerk bearer token
  -> API tenant + membership resolution
  -> tenant-scoped repository query
```

The UI must not render operational data when the URL tenant, active Clerk
organization, and API-resolved tenant disagree.

## Tenancy and authorization invariants

Tenant isolation is a hard security boundary, not a UI filter.

- Never accept a trusted `tenantId`, membership ID, or role from a request
  body, query string, URL slug, or browser storage.
- Resolve tenant and membership from the verified Clerk organization and API
  auth context.
- Every tenant-owned repository read/update/delete must include `tenantId` in
  its predicate, including lookup-by-ID paths.
- Return not-found/forbidden without leaking whether another tenant owns a
  record.
- Add negative cross-tenant tests for every new tenant-owned endpoint.
- Keep the URL slug, Clerk organization slug, and `/me`/`/tenant` identity
  checks aligned in the web shell.

The first vSAS organization is trusted through `VSAS_CLERK_ORG_ID`. On first
authenticated access the API may create or repair the corresponding tenant,
then auto-provision the user's membership. Do not generalize that bootstrap
path to arbitrary organizations without a deliberate provisioning design.

Roles are ordered:

```text
pilot < dispatcher < admin
```

Use `requireRole` and the shared role helpers. Hiding a button is not
authorization. Pilot-owned actions must additionally verify record ownership.

Local `AUTH_DEV_BYPASS` is permitted only outside production. The production
hard-off check must remain intact. Playwright's fixture/auth bypass is a
separate test mechanism and must also remain impossible in production.

## Human-request protection

Vercel BotID protects business routes through `requireHuman`.

- Deep analysis is used on the configured high-risk, exact mutation routes.
- Other mutations use the basic check.
- Browser-side BotID route declarations and server-side matching must stay in
  sync when an endpoint or method changes.
- Do not weaken or bypass BotID to make a test pass. Use the explicit local or
  test fixture seam.

Internal cron routes are machine-to-machine and use their own authentication;
do not accidentally put them behind the human check.

## Scheduling domain

Pilots submit normalized UTC availability intervals, a requested flight count,
an optional title, and free-text notes. A pilot may version-edit an owned
`pending` request before dispatch starts review. Dispatchers can fulfill in
one or more atomic batches; each batch requires an idempotency key and observes
cumulative request capacity. Cancellation requires an explicit linked-flight
policy and preserves terminal history.

Allowed schedule-request transitions:

```text
pending -> in_review | rejected | cancelled
in_review -> fulfilled | partially_fulfilled | rejected | cancelled
partially_fulfilled -> fulfilled | cancelled
fulfilled | rejected | cancelled -> terminal
```

Do not update status ad hoc. Use the transition guard in
`apps/api/src/domain/schedule-requests/transitions.ts`. Keep cancellation and
fulfillment audit events consistent with the stored mutation.

Time handling rules:

- Persist and exchange instants in UTC.
- Use the shared web helpers in `apps/web/src/lib/utc.ts` for
  `datetime-local` conversion and formatting.
- Validate that availability end is after start.
- Treat an absent preference as absent; do not silently turn local time or an
  empty field into a different business value.
- Make timezone behavior explicit in user-facing copy and tests.

## Flights and dispatch

A dispatcher can build offers from a schedule request or create an ad-hoc
flight. Request-linked offers must use the locked bulk-fulfillment path; single
flight creation is ad-hoc only. Dispatcher attribution comes from authenticated
context and immutable dispatch-release/SimBrief snapshots, never client-supplied
names.

Allowed flight transitions:

```text
draft -> offered | cancelled
offered -> accepted | declined | cancelled
accepted -> briefed | cancelled
briefed -> active | cancelled
active -> completed | cancelled
declined | completed | cancelled -> terminal
```

Pilots may cancel only their own `offered`, `accepted`, or `briefed` flights.
Dispatchers may cancel non-terminal flights. Use
`apps/api/src/domain/flights/transitions.ts`; never reproduce transition logic
inside a component or route.

Current contracts matter when changing this area:

- Flight and request mutations use numeric versions. Material edits invalidate
  stale acceptance/planning state; notes-only edits do not.
- A declined source flight is immutable. Re-offer creates one tenant-coherent
  replacement and concurrent losers discover the winning replacement.
- Dispatch releases are revisioned canonical planning snapshots. Dispatch
  prepares SimBrief data; the assigned pilot generates using their own account.
- Simulator telemetry has revocable device ownership, bounded tracks, current
  presence, and provenance-aware automatic/manual OOOI updates.
- Required lock order is schedule request before linked flights. Preserve it in
  every transaction that touches both.

A feature that changes one of these boundaries normally requires coordinated
schema, repository, service, route, OpenAPI, web schema, UI, audit, and test
work. Do not claim completion from a UI-only implementation.

## ACARS and Hoppie

Production ACARS always uses Hoppie. `ACARS_PROVIDER=mock` is only a local/test
adapter; production forces Hoppie even if a stale variable requests the mock.
The `/acars/simulate` fixture must never become reachable in production.

Security and ownership rules:

- The tenant administrator configures the shared VA ground-station callsign and
  Hoppie logon code.
- Store the logon encrypted with AES-256-GCM using `TENANT_SECRETS_KEY`.
- Never return, log, serialize, or expose the decrypted logon.
- Test Hoppie connectivity before persisting a new configuration.
- A member stores only their aircraft callsign in the web app. Their personal
  Hoppie logon remains in the simulator client.
- The sender, tenant, and actor come from authenticated context and stored
  configuration. The dispatcher supplies the recipient, which must pass the
  shared station validation before any provider call.

Delivery behavior is intentionally conservative:

- Persist the logical outbound row as `pending` before provider I/O, then mark
  it `accepted`, `rejected`, or `ambiguous`. A post-call uncertainty must remain
  visible rather than becoming a generic retry error.
- Never automatically retry an ambiguous send. The dispatcher checks the
  conversation before composing another message.
- Inbound polling runs per configured tenant through the authenticated cron and
  suppresses repeated provider payloads only within the bounded fingerprint
  window.
- Preserve provider metadata, timestamps, privacy headers, and auditability.
- Web ACARS is dispatcher/admin only. Pilots use the simulator client and their
  personal Hoppie affiliation.

When changing the provider adapter, test error mapping, malformed responses,
recipient scoping, configuration failure, and the production mock hard-off.

## API contracts and persistence

Routes should remain thin: parse/validate input, enforce authorization, call a
domain service, and map its result. Business rules belong in `domain/`, while
tenant-scoped SQL belongs in repositories.

For every API contract change, update together:

1. route validation and handler behavior;
2. domain/repository types and logic;
3. `apps/api/src/docs/openapi.ts`;
4. `apps/web/src/lib/api/schemas.ts` and the relevant client call;
5. route/domain tests and UI tests;
6. Wiki pages if user-visible behavior or operations changed.

Keep the standard JSON error envelope and request IDs. Do not expose raw SQL,
provider errors, secrets, or stack traces. Pagination must use the shared
helpers and deterministic ordering.

The canonical schema is `apps/api/src/db/schema.ts`. Every schema change requires
an additive migration and regenerated snapshot after the immutable baseline.
Run `pnpm db:check`, fresh migration, populated upgrade, and relevant real-
PostgreSQL contracts. Never edit an applied migration or fold later schema into
the baseline. Preserve foreign keys, tenant indexes, uniqueness constraints,
and timestamp semantics.

Audit security- and operations-relevant mutations. Audit rows should record
the authenticated actor, tenant, action, entity, and useful non-secret metadata
without copying sensitive payloads.

## Next.js application

Read `apps/web/AGENTS.md` before any web change. This repository intentionally
uses a Next.js version whose APIs may differ from remembered conventions. Read
the relevant installed documentation under `apps/web/node_modules/next/dist/docs/`
before implementing framework behavior, and heed its deprecation notices.

Additional web rules:

- Keep server identity checks at the tenant layout boundary.
- Use same-origin `/api/*` browser calls and the server API helper where
  appropriate; do not leak private service URLs to the client.
- Parse API payloads with the shared Zod schemas.
- Reuse TanStack Query keys and invalidate the narrowest affected data.
- Preserve loading, empty, error, forbidden, and organization-mismatch states.
- Reuse existing UI components and design tokens before introducing a new
  pattern.
- Maintain keyboard access, labels, focus behavior, and mobile layouts.
- Add or update tests for visible role/state behavior.

The frontend tenant registry currently contains only `vsas`. Adding a tenant
is not just a branding entry: Clerk provisioning, database tenancy,
configuration, assets, legal/operator data, and isolation tests must agree.

## Security, privacy, and legal requirements

Read `SECURITY.md`, `docs/privacy-compliance.md`, and
`docs/maintainer-setup.md` before changing authentication, telemetry, secrets,
legal pages, or third-party services.

- Never commit `.env` files, keys, Hoppie logons, Clerk secrets, production
  identifiers, personal data, or database exports.
- Use synthetic data in tests, logs, screenshots, and issue reproductions.
- Production legal pages fail closed when mandatory `LEGAL_*` configuration is
  incomplete. Do not restore placeholder operator data.
- Optional analytics require explicit local, versioned consent. Essential
  security/operations processing must not be mislabeled as optional analytics.
- New processors, cookies, telemetry, or retained personal fields require a
  documented purpose, lawful basis/consent analysis, retention decision,
  deletion/export impact, and privacy notice update.
- Keep secure headers, CORS allowlists, secret masking, GitHub secret scanning,
  dependency review, and CodeQL protections intact.

The privacy control plane automates approved retention runs, export, correction,
restriction, objection, anonymization/erasure, holds, and external-provider
tasks. It does not choose the operator's lawful basis or retention schedule,
certify GDPR compliance, purge external backups by itself, or make the audit
table tamper-evident. Keep those responsibilities explicit.

## Testing expectations

Run checks in proportion to the change, then report exactly what ran and what
did not. Passing unit tests is not the same as passing a production build,
Playwright, remote CI, or a live Hoppie integration.

Minimum focused expectations:

- Domain transition change: transition unit tests plus affected route tests.
- Tenant-owned data change: positive authorization and negative cross-tenant
  integration tests.
- Auth/BotID change: middleware/security tests and production hard-off cases.
- API response change: route tests, OpenAPI tests, web schema tests.
- UI workflow change: component tests and the relevant Playwright journey.
- Hoppie change: provider/service tests with synthetic responses; never make a
  live network call in the automated suite.
- Documentation-only change: formatting plus link/path and code-reference
  review.

The fast Playwright suite uses deterministic route fixtures and proves focused
UI behavior. The separate integrated suite starts the real web and API against
an explicitly confirmed disposable PostgreSQL database, deterministic local
provider adapters, and a production-hard-off auth fixture. It contains one
pilot and one dispatcher journey. Neither suite proves live Hoppie, Clerk,
BotID, SimBrief, Navigraph, or production rewrites; those require deployed
acceptance.

The full local quality target is:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:coverage
pnpm security:audit
pnpm build
pnpm --filter @va-dispatch/web test:e2e
pnpm --filter @va-dispatch/web test:e2e:integrated
```

If a command cannot run because infrastructure, browsers, credentials, or
network access are absent, keep the implementation verifiable with the
remaining checks and state the gap explicitly.

## Documentation duties

The root README is the short project entry point. The GitHub Wiki is the
long-form product, architecture, API, operations, and contributor reference.
Its version-controlled source mirror is `wiki/`.

When behavior changes:

- update the narrowest relevant Wiki page and its cross-links;
- update `_Sidebar.md` for new, renamed, or removed pages;
- keep examples synthetic and commands runnable from the repository root;
- distinguish current behavior, configuration-dependent behavior, and planned
  work;
- update the checked-in OpenAPI document for API changes;
- update privacy/security/runbook documents when their operating assumptions
  change.

The live GitHub Wiki is a separate Git repository. A source-branch commit does
not publish it automatically; publication must be intentional and limited to
the Wiki repository.

## Definition of done

A change is done when:

- the implementation follows the tenancy, authorization, state-machine,
  security, and privacy invariants above;
- affected contracts, schemas, UI, and documentation agree;
- focused tests cover success and meaningful failure/authorization cases;
- relevant quality checks pass, with any unrun check disclosed;
- the diff contains no secrets, generated build output, or unrelated user
  changes;
- current limitations are not represented as completed functionality.
