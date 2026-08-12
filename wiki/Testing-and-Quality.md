# Testing and Quality

VA Dispatch combines backend unit/route tests, frontend unit/component tests, deterministic browser journeys, full-source coverage gates, builds, formatting, linting, type checking, and separate security automation.

## Test inventory

At the reviewed baseline:

- 15 API test files;
- 24 web unit/component test files; and
- 6 Playwright journeys in one browser suite.

The count will change as the project grows; the important part is the layer and risk covered.

## API tests

API tests use Vitest in a Node environment and cover:

- Hoppie payload, response, error, timeout, callsign-lock, and poll parsing;
- production/mock provider selection;
- outbound storage only after provider acceptance;
- linked-flight validation before contacting Hoppie;
- ACARS route authorization;
- flight and schedule state transitions;
- Clerk compact claims and trusted tenant repair;
- unknown-organization rejection;
- tenant isolation across Clerk organizations;
- member self-service callsign uniqueness;
- admin Hoppie configuration secrecy and authorization;
- cron authentication and Vercel-compatible GET handling;
- BotID route policy and bot rejection;
- security headers;
- PostgreSQL unique-error recognition; and
- OpenAPI route completeness, unique operation IDs, descriptions, and resolvable references.

## Web tests

Web tests use Vitest, jsdom, Testing Library, and a `server-only` test shim. They cover:

- typed API response/error handling;
- API serializer contract fixtures;
- tenant auth routes and session tasks;
- unknown-tenant and role routing;
- tenant-branded sign-in/sign-up;
- schedule availability and UTC normalization;
- exact-count offers;
- pilot decisions;
- ACARS draft retention, setup gating, mock mode, and flight recipient selection;
- member and organization settings;
- strict legal configuration;
- privacy preference parsing/storage;
- consent UI and cross-tab behavior; and
- per-event optional telemetry gating.

## Browser journeys

Playwright verifies:

1. public legal pages and privacy controls;
2. pilot UTC schedule request and offer acceptance;
3. dispatcher exact offer and flight advancement;
4. dispatcher Hoppie send experience;
5. development inbound ACARS simulation; and
6. administrator Hoppie ground-station configuration.

The suite uses deterministic route interception and a test-only identity fixture. It is a browser/user-journey suite, not a live Clerk, Neon, Vercel BotID, or Hoppie integration test.

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
```

Install Chromium once if needed:

```bash
pnpm --filter @va-dispatch/web exec playwright install chromium
```

Coverage reports go to `apps/api/coverage` and `apps/web/coverage`. Failed browser runs may create `apps/web/playwright-report` and `apps/web/test-results`; all are ignored by Git.

## CI

The `CI` workflow runs on pull requests, pushes to `main`, and manual dispatch:

1. checkout with persisted credentials disabled;
2. pnpm setup;
3. Node 24.15.0 with pnpm cache;
4. frozen install;
5. format, lint, and type checks;
6. coverage tests;
7. coverage artifact upload;
8. build;
9. Playwright Chromium install; and
10. browser smoke tests with failure-report upload.

Concurrency cancels an older run for the same ref.

## Security automation

The separate `Security` workflow runs on pull requests, `main`, Mondays, and manual dispatch:

- high-severity pnpm advisory audit;
- dependency review on pull requests; and
- CodeQL extended JavaScript/TypeScript analysis.

Dependabot currently updates GitHub Actions. pnpm package updates remain a reviewed manual process until the project's configured pnpm generation is supported by the chosen automation.

## Toolchain notes

- Node engine: 24+, with `.nvmrc` at 26.7.0.
- pnpm: 11.21.0.
- Next.js: 16.3.0.
- API build/typecheck explicitly uses the `typescript7` alias.
- Root also carries a TypeScript 6 alias for tool compatibility.
- Vitest and Drizzle are pinned release-candidate versions in the current lockfile.

Do not perform broad dependency updates incidentally. Read release notes, check license/security impact, regenerate only the intended lockfile changes, and run the full matrix.

## What to test for common changes

| Change               | Minimum focused evidence                                                        |
| -------------------- | ------------------------------------------------------------------------------- |
| New API resource     | validation, role denial, tenant isolation, happy path, serializer/OpenAPI       |
| State transition     | allowed path, illegal jumps, actor ownership, UI action matrix                  |
| Schema field         | repository, serializer, web schema, null/backfill behavior, rollout             |
| Clerk/tenant logic   | signed out, wrong org, unknown tenant, role map, disabled membership            |
| Hoppie behavior      | provider error class, no-secret error, no store on failure, manual retry UI     |
| BotID policy         | matching client/server level and excluded routes                                |
| Optional third party | pre-consent absence, accept, reject, withdrawal, version expiry, cross-tab      |
| UI workflow          | loading, empty, error, mutation success/failure, accessibility, browser journey |
| Legal copy/config    | strict production failure and rendered public pages                             |

## Evidence language

Be precise in handoffs:

- “unit tests passed” is not “live Hoppie verified”;
- “fixture browser tests passed” is not “full-stack E2E passed”;
- “build passed” is not “deployment succeeded”;
- “health returned ok” is not “database query succeeded”; and
- “Hoppie accepted” is not “pilot received.”
