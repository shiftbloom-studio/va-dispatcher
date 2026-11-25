# Deploying on Cloudflare

VA Dispatch runs as two Cloudflare Workers on one hostname:

| Worker            | Source     | Serves                     | Bindings                                                    |
| ----------------- | ---------- | -------------------------- | ----------------------------------------------------------- |
| `va-dispatch-web` | `apps/web` | everything except `/api/*` | `API` service binding, KV data cache, Images, static assets |
| `va-dispatch-api` | `apps/api` | `<host>/api/*` zone route  | D1 `DB`, R2 `TENANT_LOGOS`, cron triggers                   |

The web Worker is the origin for the hostname (custom domain). The API Worker
claims `<host>/api/*` with a zone route, which takes precedence over the custom
domain, so the browser only ever talks to one origin. Server components call the
API through the `API` service binding, because a Worker cannot `fetch()` a zone
route on its own zone.

Clerk stays the identity provider. Everything else (hosting, database, logo
storage, logs, bot scoring) is on Cloudflare.

## What runs where

- **Database:** Cloudflare D1. The schema lives in `apps/api/src/db/schema.ts`;
  `pnpm db:generate` writes SQL to `apps/api/migrations`, and deploys apply
  pending migrations with `wrangler d1 migrations apply`.
- **Tenant logos:** R2 bucket `va-dispatch-tenant-logos`, served by
  `GET /api/v1/public/tenant-logos/:slug/:file` with immutable cache headers.
- **Scheduled jobs:** Worker cron triggers. `* * * * *` polls Hoppie for tenants
  with a configured ground station; `0 * * * *` runs the privacy lifecycle. The
  `/api/v1/internal/cron/*` endpoints remain for manual runs and require
  `CRON_SECRET`.
- **Bot protection:** the API reads `request.cf.botManagement.score` and rejects
  likely automated mutations. Verified bots and requests without a score (local
  development) pass.
- **Caching (web):** vinext stores the data cache in Workers KV. Only
  unauthenticated, identical-for-everyone reads (`serverPublicApi`, for example
  public tenant branding) use it, with a 60-second revalidation. Per-user
  requests made with a Clerk token never enter a shared cache. Static assets
  under `/_next/static` are served from Workers static assets with immutable
  caching, and `next/image` uses Cloudflare Images.

## One-time setup

1. **Create the resources** (dashboard, Cloudflare API, or `wrangler`):
   - D1 database `va-dispatch`
   - R2 bucket `va-dispatch-tenant-logos`

   The web Worker's KV namespace and Images binding are provisioned on its
   first deploy.

2. **Connect both Workers to the repository with Workers Builds**
   (Workers & Pages → Create → Import a repository), one per Worker:

   | Setting        | API Worker                       | Web Worker                       |
   | -------------- | -------------------------------- | -------------------------------- |
   | Worker name    | `va-dispatch-api`                | `va-dispatch-web`                |
   | Root directory | `apps/api`                       | `apps/web`                       |
   | Build command  | `pnpm install --frozen-lockfile` | `pnpm install --frozen-lockfile` |
   | Deploy command | `pnpm run deploy`                | `pnpm run deploy`                |

   Deploy the API Worker first, because the web Worker's service binding
   refers to it.

3. **Build variables** (Settings → Build → Variables). They fill the
   placeholders in `apps/api/wrangler.jsonc` and the web Worker config, so
   installation-specific values never live in the repository:

   | Variable                            | Worker | Meaning                                                                          |
   | ----------------------------------- | ------ | -------------------------------------------------------------------------------- |
   | `VA_HOSTNAME`                       | both   | Public hostname, for example `dispatch.example.com`                              |
   | `VA_ZONE_NAME`                      | API    | Cloudflare zone of that hostname                                                 |
   | `VA_D1_DATABASE_ID`                 | API    | ID of the `va-dispatch` D1 database                                              |
   | `AUTH_ISSUER`                       | API    | OIDC issuer of the identity provider (stem)                                      |
   | `AUTH_AUDIENCE`                     | API    | Expected `aud` of access tokens for this API                                     |
   | `AUTH_ADMIN_API_URL`                | API    | Identity provider admin API for invitations and directory sync                   |
   | `VSAS_AUTH_ORG_ID`                  | API    | Immutable ID of the first tenant's identity-provider organization (optional)     |
   | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | web    | Same Clerk publishable key, inlined at build                                     |
   | `NEXT_PUBLIC_SOURCE_URL`            | web    | Corresponding-source URL for hosted forks                                        |
   | `LEGAL_*`                           | web    | Operator details for the imprint and privacy notice, see `apps/web/.env.example` |

   For a manual deploy from a workstation, put the same values in an untracked
   `.env.deploy` at the repository root or in the app directory.

4. **Secrets** (Settings → Variables and Secrets, or `wrangler secret put`):
   - API: `AUTH_ADMIN_TOKEN`, `TENANT_SECRETS_KEY`, `CRON_SECRET`,
     `SIMBRIEF_API_KEY`, `NAVIGRAPH_CLIENT_ID`, `NAVIGRAPH_CLIENT_SECRET`
   - Web: `CLERK_SECRET_KEY`

5. **Third-party callbacks:** register
   `https://<host>/api/v1/simbrief/oauth/callback` with Navigraph and use
   `https://<host>/api/v1/simbrief/callback` for SimBrief.

## Releases

A merge to `main` triggers both Workers Builds. The API build applies pending
D1 migrations before it deploys, so the schema is always at least as new as
the code. GitHub Actions only validates: lint, types, unit and contract tests
against local D1, a dry-run bundle of the API Worker, the vinext build, and the
browser suites.

To roll back, use **Deployments → Rollback** on the affected Worker. D1 Time
Travel restores the database to any point in the last 30 days:
`wrangler d1 time-travel restore va-dispatch --timestamp <ISO time>`.

## Local development

```bash
pnpm install
cp apps/api/.dev.vars.example apps/api/.dev.vars
pnpm db:migrate:local   # create the local D1 schema
pnpm dev                # web on :3000 (next dev), API Worker on :3001 (wrangler dev)
```

`pnpm --filter @va-dispatch/web build` followed by
`pnpm --filter @va-dispatch/web start` runs the production Workers build of the
web app in local workerd.
