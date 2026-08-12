# Maintainer setup

Repository files provide the project checks and community defaults, but several
protections must be enabled in GitHub after these changes reach the default
branch. A repository administrator should complete this checklist.

## Merge protection

Create a branch ruleset for `main` in **Settings → Rules → Rulesets**:

- require changes to arrive through a pull request;
- require at least one approval and dismiss stale approvals;
- require all review conversations to be resolved;
- block force pushes and branch deletion;
- require the CI validation, dependency audit, dependency review, and CodeQL
  checks after each check has run once and appears in the selector;
- require the branch to be current before merging;
- keep administrator bypass narrow and auditable.

Do not enable automatic merge for dependency updates without reviewing their
release notes, lockfile changes, licenses, and test results.

## GitHub security features

In **Settings → Security → Advanced Security**, enable the features available to
the public repository:

- dependency graph and Dependabot alerts;
- Dependabot security updates when GitHub supports the repository's package
  manager version;
- secret scanning, push protection, and validity checks;
- private vulnerability reporting.

The checked-in security workflow remains useful when platform features are
enabled: it audits the complete lockfile, rejects high-severity vulnerable
dependency additions, and analyzes JavaScript and TypeScript with CodeQL's
extended security query suite.

The repository currently uses pnpm 11. GitHub's documented Dependabot package
update support currently ends at pnpm 10, so `.github/dependabot.yml` updates
GitHub Actions only. Keep the scheduled `pnpm security:audit` job enabled and add
pnpm package updates to Dependabot when GitHub documents pnpm 11 support.

## Vercel BotID

BotID is enforced on same-origin browser mutations under `/api/v1/*`. The
client and API explicitly select the same check level so a dashboard default
cannot create a verification mismatch:

- Deep Analysis protects bulk flight creation, Clerk membership sync, Hoppie
  configuration tests, and outbound Hoppie messages.
- Basic protects every other `POST`, `PUT`, `PATCH`, and `DELETE` request.
- Health checks, read requests, and secret-authenticated `/api/v1/internal/*`
  operations are intentionally excluded.

Before deploying, enable **Secure Backend Access with OIDC Federation** in the
Vercel project settings. BotID uses the request-scoped Vercel OIDC token for
server verification; do not copy that token into a long-lived secret. Deep
Analysis requires an eligible paid plan and incurs per-check usage, so configure
spend notifications appropriate for the deployment.

Test protected requests through the deployed web application. Direct production
requests from `curl` or other clients that did not run the browser challenge are
expected to receive `403`. Local development passes as human by default. After
deployment, inspect BotID events in the Vercel Firewall traffic view and verify
both a Basic route and a Deep Analysis route before promoting the release.

## Vulnerability intake

After private vulnerability reporting is enabled, confirm that the **Report a
vulnerability** button appears on the repository Security page. Keep
`hello@shiftbloom.studio` working as the fallback private contact published in
`SECURITY.md`, and ensure at least two maintainers can receive and triage its
mail.

## Open Collective Europe

Fiscal hosting does not by itself establish software copyright ownership. The
repository therefore attributes copyright to the respective contributors. Only
name Open Collective Europe or another legal entity as the copyright holder if
an applicable agreement actually assigns those rights.

When the project's public Open Collective slug is known, add
`.github/FUNDING.yml`:

```yaml
open_collective: confirmed-collective-slug
```

Do not publish a placeholder or an unverified funding destination.

## Release hygiene

- Create releases from reviewed, green commits on `main`.
- Use semantic version tags and include user-visible changes and upgrade notes.
- Never attach environment files, credentials, production data, or private
  build logs to a release.
- Confirm that `NEXT_PUBLIC_SOURCE_URL` identifies the corresponding source for
  every hosted deployment, especially modified forks.
- Revisit coverage thresholds as tests improve; thresholds should move upward,
  not be reduced to accommodate an untested change.
