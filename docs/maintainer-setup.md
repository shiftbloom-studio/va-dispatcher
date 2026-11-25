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

## Deployment

Cloudflare Workers Builds deploys the API and web Workers from `main`; GitHub
Actions only validates. The one-time Cloudflare setup (resources, Workers
Builds, build variables, secrets) is in
[`cloudflare-deployment.md`](cloudflare-deployment.md). Keep application
secrets in Cloudflare; do not duplicate them as GitHub secrets.

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

## Bot protection

The API blocks likely automated mutations with Cloudflare's bot score
(`request.cf.botManagement.score`, see `apps/api/src/middleware/human.ts`):

- A strict threshold protects bulk flight creation, Clerk membership sync,
  Hoppie configuration tests, and outbound Hoppie messages.
- A basic threshold protects every other `POST`, `PUT`, `PATCH`, and `DELETE`
  request.
- Health checks, read requests, and secret-authenticated `/api/v1/internal/*`
  operations are excluded, and verified bots always pass.

Bot scores require Bot Management on the zone. Without it, requests carry no
score and pass, so check **Security → Bots** before relying on this protection.
After a deploy, confirm in **Security → Analytics** that requests reaching the
API carry a bot score.

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
Production's explicit `APP_ORIGIN`, and allowlist any preview origin in Clerk
(set `APP_ENV=preview` and its `APP_ORIGIN`) before testing direct invitations
there.

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
