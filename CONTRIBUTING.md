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

VA Dispatch is a pnpm monorepo and requires Node.js 26 or newer (the version in
`.nvmrc` is recommended) and pnpm 11.

```bash
pnpm install
cp apps/api/.dev.vars.example apps/api/.dev.vars
# Configure apps/web/.env.local from apps/web/.env.example.
pnpm db:migrate:local
pnpm dev
```

`apps/api/src/db/schema.ts` is canonical. After changing it, run
`pnpm db:generate` and commit the new migration; never edit an applied one.

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

CI also runs the two real web/API journeys against an in-memory local D1
database: `pnpm test:e2e:integrated`. See
[`docs/integrated-e2e.md`](docs/integrated-e2e.md).

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
- schema, configuration, and rollout notes where relevant;
- confirmation that no secrets or sensitive production data are included.

Maintainers may ask for changes before merging. A pull request is not accepted
until the required checks pass and a maintainer approves it.

## Commit messages

Use concise, imperative commit subjects such as `Add tenant isolation test`.
Explain non-obvious motivation and tradeoffs in the commit body or pull request.

## Working on an issue

Issues labeled `good first issue` or `help wanted` are open to anyone. Before you write code:

1. Comment on the issue and say how you plan to approach it: the files you expect to touch, and anything you would do differently from what the issue suggests. A few sentences are enough.
2. Wait until a maintainer assigns the issue to you. That way two people don't build the same thing, and we can point out a dead end before you spend an evening on it.
3. Open the pull request and link the issue (`Closes #123`).

Typo fixes and other small, obvious changes can go straight to a pull request.

If an assigned issue sees no activity for 14 days, we'll check in and may hand it to someone else. You're welcome to pick it up again later.

## Using AI tools

You're welcome to use AI assistants, the same way you'd use an editor or a linter. We only ask that a person stands behind every contribution:

- You have read and understood every line you submit, and you ran the checks yourself.
- You answer review questions in your own words and can change the code when we ask.
- The pull request description explains what you decided and why. The diff already shows what changed.

Issues, comments and pull requests that an agent wrote and posted on its own, with nobody actually involved, will be closed. This isn't about the tool. We'd like to get to know the people who work on this project.

## Licensing of contributions

Unless explicitly stated otherwise, any contribution intentionally submitted
for inclusion in this project is licensed under the GNU Affero General Public
License version 3 or any later version (`AGPL-3.0-or-later`). By contributing,
you confirm that you have the right to submit the work under those terms.
