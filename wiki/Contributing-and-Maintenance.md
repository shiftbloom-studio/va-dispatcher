# Contributing and Maintenance

VA Dispatch is AGPL-3.0-or-later open-source software. Contributions of code, tests, documentation, issues, and design feedback are welcome under the repository's contribution and conduct policies.

## Before starting

- Read [`CONTRIBUTING.md`](https://github.com/shiftbloom-studio/va-dispatcher/blob/main/CONTRIBUTING.md).
- Search existing issues and pull requests.
- Use the issue forms for bugs, features, and support.
- Discuss substantial product or architecture changes first.
- Report vulnerabilities privately through [`SECURITY.md`](https://github.com/shiftbloom-studio/va-dispatcher/blob/main/SECURITY.md).
- Use synthetic data only.

## Change approach

Prefer the smallest coherent, production-quality change that follows existing routes, services, repositories, components, and tests. Fix a regression at its introducing change before adding a compensating layer elsewhere.

Broader refactoring is appropriate when a narrow change would violate correctness, security, privacy, tenant isolation, operational safety, or maintainability—not merely because debugging is inconvenient.

## Pull request expectations

Each pull request should include:

- problem and chosen solution;
- linked issue when available;
- focused diff with no unrelated generated or formatting churn;
- tests for behavior and failure paths;
- tenant-isolation and authorization cases where relevant;
- screenshots for visible UI changes;
- migration/configuration/compatibility/rollout notes;
- privacy and data-retention impact; and
- validation that actually ran.

Use concise imperative commit subjects, for example `Document Hoppie polling operations`.

## Documentation update matrix

| Change                         | Update together                                                        |
| ------------------------------ | ---------------------------------------------------------------------- |
| HTTP method/path/body/response | route, OpenAPI, web schema, API Guide, tests                           |
| Role or ownership              | middleware/service, OpenAPI role note, Product Guide, auth page, tests |
| Request/flight state           | database enum, transition table, UI actions, diagrams, tests           |
| Schema or retention            | schema/migration plan, Data Model, Privacy docs, rollout               |
| Environment variable           | parser, example env, Configuration Reference, deployment docs          |
| Hoppie/provider behavior       | provider/service, ACARS page, error UX, privacy inventory, tests       |
| External browser service       | consent implementation, legal notice version, data inventory, tests    |
| Tenant/branding                | static tenant registry, assets, Clerk mapping, isolation tests, Wiki   |
| Dependency/toolchain           | manifests/lockfile, CI, setup docs, compatibility evidence             |

## Wiki maintenance model

The reviewable Wiki source is stored in the main repository's `wiki/` directory. GitHub renders a separate Wiki Git repository at:

```text
https://github.com/shiftbloom-studio/va-dispatcher.wiki.git
```

The two copies are expected to remain content-equivalent:

1. Change `wiki/*.md` in the same pull request as behavior.
2. Review links, diagrams, wording, and current limitations with the code diff.
3. Merge the source change.
4. Clone the Wiki Git repository into a temporary directory.
5. Copy the reviewed pages, including `_Sidebar.md` and `_Footer.md`.
6. Review `git diff`, commit, and push the Wiki's default branch.
7. Open the rendered Home page and sample diagrams/links.

Only changes pushed to the Wiki repository's default branch are visible. Do not make an unreviewed browser-only Wiki edit and forget the versioned source mirror.

When removing a page, review inbound links and delete it explicitly in both copies; a simple copy does not remove stale remote pages.

## Maintaining API documentation

The OpenAPI document is authored in `apps/api/src/docs/openapi.ts`. It must cover every registered versioned operation. Keep:

- operation IDs unique;
- descriptions meaningful;
- role requirements explicit;
- examples synthetic;
- public and internal security schemes accurate; and
- response schemas aligned with serializers.

Run API docs tests and open both Swagger UI and ReDoc after significant changes.

## Maintaining security and privacy controls

- Keep BotID client and API route policies identical.
- Keep optional analytics off by default and increment notice version after material changes.
- Do not add an external script, iframe, font, map, or tracker without consent/data review.
- Keep required legal config fail-closed in production.
- Never include secrets or personal data in logs, tests, docs, screenshots, audit metadata, fixtures, or issue templates.
- Revisit provider contracts, transfers, retention, rights workflows, and legal pages after infrastructure changes.

## Repository administration

Maintainers should enable and periodically verify:

- pull-request-only `main` ruleset;
- approval and conversation-resolution requirements;
- required CI, dependency, and CodeQL checks;
- force-push and branch-deletion protection;
- secret scanning and push protection;
- Dependabot alerts and supported updates;
- private vulnerability reporting; and
- least-privilege administration.

See [`docs/maintainer-setup.md`](https://github.com/shiftbloom-studio/va-dispatcher/blob/main/docs/maintainer-setup.md) for the current checklist.

## Releases and hosted forks

- Release reviewed green commits from `main`.
- Use semantic version tags and publish upgrade/rollback notes.
- Keep attached artifacts free of secrets and personal data.
- A hosted modified fork must expose its corresponding source through `NEXT_PUBLIC_SOURCE_URL`.
- Contributions are AGPL-3.0-or-later unless explicitly and validly stated otherwise.

## Getting help

Use [`SUPPORT.md`](https://github.com/shiftbloom-studio/va-dispatcher/blob/main/SUPPORT.md) and the support-question issue form. Third-party service issues may need Clerk, Neon, Vercel, or Hoppie support after the application request path has been isolated.
