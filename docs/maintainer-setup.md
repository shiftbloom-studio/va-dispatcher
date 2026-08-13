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

## Automated preview and production delivery

GitHub Actions is the sole deployment coordinator. Vercel's automatic Git
deployments are disabled in `vercel.ts` so a commit cannot deploy before the
repository's PostgreSQL contracts, quality checks, and integrated browser tests
have passed.

Complete this one-time repository setup:

1. Create a dedicated Vercel access token scoped to the `va-dispatcher`
   project. Do not reuse an individual's interactive CLI token. Record its
   expiry and rotate it before that date.
2. Add the token as the repository Actions secret `VERCEL_TOKEN`.
3. Add repository Actions variables `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, and
   `VERCEL_GITHUB_REPOSITORY_ID`.
4. Keep GitHub deployment environments named exactly `Preview` and
   `Production` so deployment history stays separated by target.
5. Keep application build/runtime secrets, including each environment's Neon
   `DATABASE_URL`, in Vercel. Do not duplicate database credentials in GitHub.

The repository values can be configured with GitHub CLI:

```bash
gh secret set VERCEL_TOKEN
gh variable set VERCEL_ORG_ID --body 'team_It06hb34UWpmpYHmmWA449es'
gh variable set VERCEL_PROJECT_ID --body 'prj_1kNdOUg4hWdWOqgkYelF9yP1vbu7'
gh variable set VERCEL_GITHUB_REPOSITORY_ID --body '1331688878'
```

An internal pull request runs all validation, then the default-branch `Deploy`
workflow creates one serialized preview from that exact successful CI commit.
It never checks out or executes pull-request code while holding the Vercel
token. The API service's Vercel build applies the canonical schema, and the
deployment succeeds only after `/api/ready` confirms the live schema. A merge
to `main` repeats the same flow for Production. Fork and Dependabot pull
requests validate but do not receive deployment credentials.

The Vercel deployment request omits `target` for Preview, as required by the
API, and sends `target: production` only for Production.

Schema application uses Drizzle's machine-readable output mode and deliberately
omits `--force`: a destructive or ambiguous proposal exits with missing hints
instead of being applied. Vercel's `forceNew` deployment parameter requests a
fresh application build for the exact commit; it does not approve database data
loss.

The currently configured `VA Dispatch GitHub Actions` token is project-scoped
and expires on August 14, 2027. Rotate `VERCEL_TOKEN` before then without
changing the workflow.

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

## Tenant administration

Review the [administrator control-plane runbook](admin-control-plane.md) before
reconciling Clerk, deciding applications, removing a member with assigned work,
or exporting audit history. Maintain at least two active application
administrators. The verified Clerk-admin recovery seam is only for a tenant
with no active application administrator and is not a routine role-management
path.

The global Clerk administrator must keep Organizations in membership-optional
mode, disable end-user organization creation and Verified Domain enrollment,
and maintain `org:pilot` plus `org:dispatcher` in the tenant Role Set. Do not
grant tenant administrators Clerk Dashboard workspace access. Verify
`APP_ORIGIN` and invitation redirect allowlists in every environment before
testing direct invitations.

Before enabling an active retention policy or handling a verified subject
request, follow the [privacy lifecycle runbook](privacy-operations.md). Confirm
the hourly privacy cron is installed, preserve two-person approval, and close
provider/backup tasks rather than treating local database completion as a full
controller response.

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
