# Contributing to VA Dispatch

Thank you for helping improve VA Dispatch. Contributions of code,
documentation, tests, bug reports, and design feedback are welcome.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before you start

- Search existing issues and pull requests before opening a duplicate.
- Use the issue forms for bugs, feature proposals, and support questions.
- Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).
- For a substantial feature or architectural change, open an issue first so the
  approach can be discussed before implementation begins.

## Development setup

VA Dispatch is a pnpm monorepo and requires Node.js 24 or newer (the version in
`.nvmrc` is recommended) and pnpm 11.

```bash
pnpm install
cp .env.example apps/api/.env
# Configure apps/web/.env.local from apps/web/.env.example.
MIGRATION_CONFIRM_DATABASE=va_dispatch pnpm db:migrate
pnpm dev
```

Use `db:push` only for an empty, disposable development database. Shared and
production databases follow the reviewed workflow in
[`docs/database-migrations.md`](docs/database-migrations.md).

Never commit credentials, personal data, production database contents, or
third-party API secrets. Use only synthetic data in tests and bug reports.

## Quality checks

Run the checks relevant to your change before opening a pull request. The full
CI-equivalent set is:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:coverage
pnpm security:audit
pnpm build
pnpm --filter @va-dispatch/web test:e2e
```

CI also runs the two real web/API/PostgreSQL journeys. To run them locally,
create and explicitly confirm a disposable database by following
[`docs/integrated-e2e.md`](docs/integrated-e2e.md); never reuse a shared
database for this suite.

Install the Playwright browser once before running browser tests locally:

```bash
pnpm --filter @va-dispatch/web exec playwright install chromium
```

Coverage reports are written to `apps/api/coverage` and `apps/web/coverage`.
The configured thresholds are the current full-source baseline; changes should
include tests and should not reduce it.

## Pull requests

Keep pull requests focused and small enough to review. Include:

- a clear description of the problem and the chosen solution;
- a linked issue when one exists;
- tests for changed behavior, including tenant-isolation and authorization
  cases where relevant;
- screenshots for visible interface changes;
- migration, configuration, compatibility, and rollout notes where relevant;
- confirmation that no secrets or sensitive production data are included.

Maintainers may ask for changes before merging. A pull request is not accepted
until the required checks pass and a maintainer approves it.

## Commit messages

Use concise, imperative commit subjects such as `Add tenant isolation test`.
Explain non-obvious motivation and tradeoffs in the commit body or pull request.

## Licensing of contributions

Unless explicitly stated otherwise, any contribution intentionally submitted
for inclusion in this project is licensed under the GNU Affero General Public
License version 3 or any later version (`AGPL-3.0-or-later`). By contributing,
you confirm that you have the right to submit the work under those terms.
