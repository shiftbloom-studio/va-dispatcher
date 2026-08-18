# Testing and Quality

VA Dispatch combines backend unit/route tests, frontend unit/component tests, deterministic browser journeys, full-source coverage gates, builds, formatting, linting, type checking, and separate security automation.

## Test inventory

The repository has four distinct evidence layers: API/web unit and component
tests, real PostgreSQL contracts, a fast fixture browser suite, and a two-
journey integrated browser suite. File and assertion counts change; the
important part is naming the layer and risk actually covered.

## API tests

API tests use Vitest in a Node environment and cover:

- Hoppie payload, response, error, timeout, callsign-lock, and poll parsing;
- production/mock provider selection;
- pending/accepted/rejected/ambiguous ACARS outcomes and bounded inbound replay;
- linked-flight validation before contacting Hoppie;
- ACARS route authorization;
- flight and schedule state transitions;
- Clerk compact claims and trusted tenant repair;
- signed-in applicant authentication without an organization claim;
- unknown-organization rejection;
- tenant isolation across Clerk organizations;
- member self-service callsign uniqueness;
- admin Hoppie configuration secrecy and authorization;
- cron authentication and Vercel-compatible GET handling;
- BotID route policy and bot rejection;
- security headers;
- PostgreSQL unique-error recognition; and
- OpenAPI route completeness, unique operation IDs, descriptions, and resolvable references.
- schedule/flight versions, idempotency, races, rollback, and tenant-coherent constraints;
- SimBrief revision/callback atomicity and trusted attribution;
- simulator-device ownership, telemetry/OOOI provenance, pruning, and visibility;
- admin reassignment, last-admin recovery, audit redaction/export; and
- tenant-scoped application submission/cancellation, approval races, Clerk role
  synchronization, safe local-first removal, invitations, and access policy;
- privacy dry-run/execute, holds, subject workflows, and external-task recovery.

## Web tests

Web tests use Vitest, jsdom, Testing Library, and a `server-only` test shim. They cover:

- typed API response/error handling;
- API serializer contract fixtures;
- tenant auth routes, waitlist, and session tasks;
- invited-signup-to-application routing, role selection, tenant approval, invitations,
  and organization membership settings;
- unknown-tenant and role routing;
- tenant-branded sign-in/waitlist/sign-up;
- schedule availability and UTC normalization;
- partial/final idempotent offer batches and conflict recovery;
- pilot decisions;
- ACARS draft retention, setup gating, mock mode, and flight recipient selection;
- member and organization settings;
- strict legal configuration;
- privacy preference parsing/storage;
- consent UI and cross-tab behavior; and
- live simulator presence/OOOI displays and device controls;
- SimBrief/Navigraph planning and callback recovery; and
- member, audit, and privacy control planes.

## Browser journeys

The fast Playwright suite uses deterministic route fixtures for focused UI
behavior. The integrated suite contains exactly two journeys:

1. pilot sign-in, authorization denial, schedule/cancellation, flight
   acceptance, release consumption, lifecycle completion, persistence, assets,
   styles, and sign-out; and
2. dispatcher fulfillment, release publication, deterministic
   SimBrief/Navigraph, ACARS send/poll/storage, and cross-tenant denial.

The integrated suite starts real Next.js and Hono processes and persists through
repositories to a confirmed disposable PostgreSQL database. It blocks external
provider traffic and uses a production-hard-off synthetic auth authority. It is
not a live Clerk, BotID, Vercel rewrite, Hoppie, SimBrief, or Navigraph test.

## Coverage thresholds

Full-source coverage includes application source, not only imported test targets.

| Workspace | Statements | Branches | Functions | Lines |
| --------- | ---------: | -------: | --------: | ----: |
| API       |        26% |      14% |       20% |   26% |
| Web       |        34% |      24% |       27% |   34% |

These are current floors, not targets. New behavior should include tests and must not reduce thresholds to accommodate untested code.

## Local validation

Run the full CI-equivalent set before a substantial pull request:

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:coverage
pnpm security:audit
pnpm build
pnpm --filter @va-dispatch/web test:e2e
pnpm test:e2e:integrated
```

Install Chromium once if needed:

```bash
pnpm --filter @va-dispatch/web exec playwright install chromium
```

Coverage reports go to `apps/api/coverage` and `apps/web/coverage`. Failed browser runs may create `apps/web/playwright-report` and `apps/web/test-results`; all are ignored by Git.

## CI

The `CI` workflow runs on pull requests, pushes to `main`, and manual dispatch.
Its main jobs cover:

1. checkout with persisted credentials disabled;
2. pnpm setup;
3. Node 24.15.0 with pnpm cache;
4. frozen install;
5. canonical schema push to a fresh PostgreSQL database and real PostgreSQL
   contracts;
6. format, lint, type, coverage, security audit, and production build;
7. fast browser workflows; and
8. isolated PostgreSQL integrated E2E with failure-only artifacts.

Concurrency cancels an older run for the same ref.

## Security automation

The separate `Security` workflow runs on pull requests, `main`, Mondays, and manual dispatch:

- high-severity pnpm advisory audit;
- dependency review on pull requests; and
- CodeQL extended JavaScript/TypeScript analysis.

Dependabot currently updates GitHub Actions and groups `github/codeql-action/*` so init and analyze stay on one SHA. pnpm package updates remain a reviewed manual process until the project's configured pnpm generation is supported by the chosen automation.

## Toolchain notes

- Node engine: 24+, with `.nvmrc` at 26.7.0.
- pnpm: 11.21.0.
- Next.js: 16.3.0.
- API build/typecheck explicitly uses the `typescript7` alias.
- Root also carries a TypeScript 6 alias for tool compatibility.
- Vitest and Drizzle are pinned release-candidate versions in the current lockfile.

Do not perform broad dependency updates incidentally. Read release notes, check license/security impact, regenerate only the intended lockfile changes, and run the full matrix.

## What to test for common changes

| Change               | Minimum focused evidence                                                                                          |
| -------------------- | ----------------------------------------------------------------------------------------------------------------- |
| New API resource     | validation, role denial, tenant isolation, happy path, serializer/OpenAPI                                         |
| State transition     | allowed path, illegal jumps, actor ownership, UI action matrix                                                    |
| Schema field         | repository, serializer, web schema, null/backfill behavior, rollout                                               |
| Clerk/tenant logic   | signed out, no org, wrong org, unknown tenant, role map/sync, pending/disabled membership, approval/removal races |
| Hoppie behavior      | provider error class, no-secret error, explicit ambiguous outcome, no auto retry                                  |
| BotID policy         | matching client/server level and excluded routes                                                                  |
| Optional third party | pre-consent absence, accept, reject, withdrawal, version expiry, cross-tab                                        |
| UI workflow          | loading, empty, error, mutation success/failure, accessibility, browser journey                                   |
| Legal copy/config    | strict production failure and rendered public pages                                                               |

## Evidence language

Be precise in handoffs:

- “unit tests passed” is not “live Hoppie verified”;
- “fixture browser tests passed” is not “integrated E2E passed”;
- “integrated E2E passed” is not “live providers or deployed routing passed”;
- “build passed” is not “deployment succeeded”;
- “health returned ok” is not “database query succeeded”; and
- “Hoppie accepted” is not “pilot received.”
