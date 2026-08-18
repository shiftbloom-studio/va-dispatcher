# Configuration Reference

VA Dispatch has separate API and web environments. Vercel service bindings provide some values automatically in the multi-service deployment, but every production operator must still verify the complete configuration.

## API environment

Primary example: `apps/api/.env.example`.

| Variable                                          | Default                          | Required when                                          | Purpose and constraints                                                                                |
| ------------------------------------------------- | -------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `NODE_ENV`                                        | `development`                    | Always                                                 | `development`, `test`, or `production`                                                                 |
| `VERCEL_ENV`                                      | unset                            | Vercel supplies it                                     | `development`, `preview`, or `production`; takes precedence when selecting the production ACARS policy |
| `PORT`                                            | `3001`                           | Local override only                                    | Positive integer used by the local Node server                                                         |
| `CORS_ORIGIN`                                     | `http://localhost:3000`          | Fallback cross-origin deployment                       | Comma-separated allowed web origins                                                                    |
| `APP_ORIGIN`                                      | unset                            | Every production deployment                            | Public web origin for provider callbacks and Clerk invitations; HTTPS in production                    |
| `DATABASE_URL`                                    | unset                            | Every authenticated or persistent workflow             | PostgreSQL connection URL, normally Neon                                                               |
| `CLERK_SECRET_KEY`                                | unset                            | Real authentication and Clerk member sync              | Server secret; never expose as `NEXT_PUBLIC_*`                                                         |
| `CLERK_PUBLISHABLE_KEY`                           | unset                            | Deployment integration may provide it                  | Parsed by API configuration; browser Clerk uses `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`                    |
| `AUTH_DEV_BYPASS`                                 | `false`                          | Local header-auth mode                                 | Allowed only when `NODE_ENV` is not `production`                                                       |
| `VSAS_CLERK_ORG_ID`                               | unset                            | Trusted vSAS production mapping                        | Clerk organization ID allowed to create or repair the initial `vsas` tenant mapping                    |
| `ACARS_PROVIDER`                                  | `mock`                           | Declare `hoppie` in production                         | `mock` or `hoppie`; production runtime always resolves to Hoppie                                       |
| `TENANT_SECRETS_KEY`                              | unset                            | Every production deployment; protected flows elsewhere | Exactly 32 random bytes, base64-encoded; protects tenant credentials and signed/sealed transient state |
| `CRON_SECRET`                                     | insecure development placeholder | Production ACARS/privacy cron calls                    | Long random bearer secret; replace the default                                                         |
| `SEED_DEMO_DATA`                                  | `false`                          | None currently                                         | Reserved parsed setting; it does not currently seed records automatically                              |
| `SIMBRIEF_API_KEY`                                | unset                            | SimBrief Dispatch Redirect                             | Application key issued by SimBrief                                                                     |
| `SIMBRIEF_CALLBACK_URL`                           | unset                            | SimBrief generation                                    | Public API callback URL                                                                                |
| `NAVIGRAPH_CLIENT_ID` / `NAVIGRAPH_CLIENT_SECRET` | unset                            | Navigraph account connection                           | OAuth client credentials; server-only                                                                  |
| `NAVIGRAPH_REDIRECT_URI`                          | unset                            | Navigraph OAuth                                        | Exact registered callback URL                                                                          |
| `BLOB_READ_WRITE_TOKEN`                           | unset                            | Tenant logo upload                                     | Vercel Blob server credential                                                                          |
| `AVIATION_WEATHER_API_ORIGIN`                     | Aviation Weather API             | Dispatch release weather                               | HTTPS provider origin; local integrated tests replace it                                               |
| `AVIATION_WEATHER_USER_AGENT`                     | project identifier               | Weather requests                                       | Operator-identifying user agent                                                                        |
| `E2E_FIXTURE_MODE`                                | `false`                          | Integrated tests only                                  | Requires test environment, fixture secret, and exact disposable database confirmation                  |
| `E2E_FIXTURE_SECRET`                              | unset                            | Integrated tests only                                  | Dedicated high-entropy fixture authority; never reuse `CRON_SECRET`                                    |
| `E2E_CONFIRM_DATABASE`                            | unset                            | Integrated tests only                                  | Exact disposable database name                                                                         |

Generate independent production secrets:

```bash
openssl rand -base64 32  # TENANT_SECRETS_KEY
openssl rand -hex 32     # suitable CRON_SECRET material
```

Changing `TENANT_SECRETS_KEY` without re-encrypting stored values makes existing
Hoppie credentials unreadable, invalidates issued simulator device tokens, and
invalidates pending SimBrief callback or Navigraph OAuth state. Plan rotation
as a controlled key rotation or re-enter credentials, reissue device tokens, and restart
pending provider flows under the new key.

`schema.ts` is canonical while this Shiftbloom project is pre-production.
Create an empty database and run `DATABASE_URL=... pnpm db:push` from the exact
release commit. Never use it against data that must be preserved.

## Web environment

Primary example: `apps/web/.env.example`.

| Variable                             | Exposure     | Required when                         | Purpose                                                   |
| ------------------------------------ | ------------ | ------------------------------------- | --------------------------------------------------------- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`  | Browser      | Normal auth                           | Clerk publishable key                                     |
| `CLERK_SECRET_KEY`                   | Server only  | Server-side Clerk auth                | Clerk secret key                                          |
| `API_INTERNAL_URL`                   | Server only  | Multi-service/local server calls      | Preferred API origin; Vercel service binding injects it   |
| `API_ORIGIN`                         | Server/build | Local rewrite or two-project fallback | Next.js rewrites browser `/api/*` requests to this origin |
| `NEXT_PUBLIC_SOURCE_URL`             | Browser      | Every hosted fork                     | Corresponding source for the deployed AGPL version        |
| `NEXT_PUBLIC_E2E_ROUTE_FIXTURE_MODE` | Browser      | Fast Playwright suite only            | Selects deterministic intercepted UI fixtures             |
| `NEXT_PUBLIC_E2E_FIXTURE_MODE`       | Browser      | Integrated test only                  | Selects synthetic auth backed by the real local API/DB    |
| `E2E_FIXTURE_SECRET`                 | Server       | Integrated test only                  | Signs server-to-API fixture identity; same test authority |

Never enable fixture values in production. API and web code reject or ignore
them there, and deployment configuration should remain explicit and clean.

## Legal identity

The public `/impressum` and `/privacy` pages load operator identity from server environment values. In production, required values fail closed instead of displaying placeholders.

### Required in production

| Variable                           | Meaning                                                                       |
| ---------------------------------- | ----------------------------------------------------------------------------- |
| `LEGAL_OPERATOR_NAME`              | Controller/operator's real legal name                                         |
| `LEGAL_OPERATOR_ADDRESS`           | Serviceable postal address; separate lines with the pipe character (`&#124;`) |
| `LEGAL_OPERATOR_EMAIL`             | Public legal contact email                                                    |
| `LEGAL_PRIVACY_EMAIL`              | Privacy/data-subject request contact                                          |
| `LEGAL_SUPERVISORY_AUTHORITY_NAME` | Competent data-protection authority                                           |
| `LEGAL_SUPERVISORY_AUTHORITY_URL`  | Absolute HTTPS official authority URL                                         |

### Optional when legally applicable

| Variable                                | Notes                                                                |
| --------------------------------------- | -------------------------------------------------------------------- |
| `LEGAL_OPERATOR_DESCRIPTION`            | Plain-language capacity; does not replace the legal name             |
| `LEGAL_OPERATOR_PHONE`                  | Rendered as a telephone link                                         |
| `LEGAL_REPRESENTATIVE`                  | Legal representative                                                 |
| `LEGAL_REGISTER_NAME`                   | Must be set together with register number                            |
| `LEGAL_REGISTER_NUMBER`                 | Must be set together with register name                              |
| `LEGAL_VAT_ID`                          | VAT identifier                                                       |
| `LEGAL_EDITORIALLY_RESPONSIBLE_NAME`    | Must be set together with a complete address                         |
| `LEGAL_EDITORIALLY_RESPONSIBLE_ADDRESS` | Pipe-separated (`&#124;`) address paired with the responsible person |

The repository cannot decide which optional disclosure duties apply to a specific operator. Review the rendered pages and `docs/privacy-compliance.md` with qualified counsel before launch.

## Clerk configuration

The global Clerk application administrator must configure the instance once:

1. Enable Organizations with **membership optional**. Applicants must be able
   to hold a verified user session before they belong to an organization.
2. Enable organization slugs.
3. Disable user-created organizations and automatic first-organization
   creation. Only global application administrators provision tenants.
4. Disable Verified Domain automatic invitations/suggestions and Clerk-native
   membership requests for this deployment. VA Dispatch owns the tenant-level
   manual approval queue; enabling a second enrollment path would create
   inconsistent approval state.
5. Enable Clerk Waitlist mode and email delivery. The waitlist is the
   application-wide gate for self-service account requests; VA Dispatch still
   owns the separate tenant-role application after account creation. Do not
   enable Invite-only (`restricted`) sign-up mode or the paid allowlist; neither
   is required for this flow.
6. Add custom roles with keys `pilot` and `dispatcher`, producing
   `org:pilot` and `org:dispatcher`. Include them with `org:admin` in the
   Primary Role Set and make `org:pilot` the new-member default.
7. Create the vSAS organization with slug exactly `vsas` and set
   `VSAS_CLERK_ORG_ID` to its immutable ID.
8. In the Clerk Account Portal **Redirects** settings, set the sign-up fallback
   to the public `https://<web-origin>/vsas/join` URL. Dashboard-approved
   waitlist emails use the Account Portal sign-up page by default and do not
   inherit the application's `ClerkProvider` URLs.
9. Set `APP_ORIGIN` to the public web origin so server-created organization
   invitations return through `/vsas/sign-in`. Confirm the Clerk allowed
   redirect/origin settings cover that deployment, then acceptance-test the
   Account Portal waitlist flow, tenant-branded invited sign-up, and direct
   organization invitation separately.

Do not give tenant administrators Clerk Dashboard team access. Their Clerk
organization role and the VA Dispatch `admin` role are tenant-scoped; global
instance settings, API keys, tenant provisioning, role definitions, and
Verified Domain policy remain with the global application administrator.

Clerk organization roles map as follows:

| Clerk role suffix                     | Application role |
| ------------------------------------- | ---------------- |
| `admin`, `owner`                      | `admin`          |
| `dispatcher`                          | `dispatcher`     |
| `pilot`, `member`, unknown, or absent | `pilot`          |

First tenant access provisions the verified `org:pilot` or `org:dispatcher`
role. The stored local membership is the runtime authority after provisioning,
and active role changes from the VA Dispatch admin console are synchronized
back to Clerk. The sole recovery exception can promote a verified Clerk
organization Admin when the tenant has no active application Admin. Disabled
or invited local memberships cannot access the application and are not revived
by directory synchronization.

Tenant administrators configure the organization name, allowed application
roles, application open/closed switch, and 7/14/30-day invitation lifetime at
`/:slug/settings/organization`. They send/revoke invitations, decide
applications, manage roles, and remove members at `/:slug/admin`.

## Hoppie configuration

Global environment selects the provider policy; each tenant stores its own station and encrypted logon.

| Environment                                      | Effective provider |
| ------------------------------------------------ | ------------------ |
| Development/test with `ACARS_PROVIDER=mock`      | DB-backed mock     |
| Development/preview with `ACARS_PROVIDER=hoppie` | Hoppie             |
| Production with any declared value               | Hoppie             |

Configure the tenant credential through `/:slug/settings/organization`. The API tests it before saving. Do not put a tenant Hoppie logon into environment variables or source control.

## Vercel configuration

The checked-in `vercel.ts` defines:

- Vercel Git deployments disabled so GitHub Actions owns validation, readiness,
  and promotion order;
- `web` service rooted at `apps/web`;
- `api` service rooted at `apps/api` with `src/index.ts` entrypoint;
- a private service binding exposed to web as `API_INTERNAL_URL`;
- `/api/*` routed to API;
- all remaining paths routed to web;
- `/api/v1/internal/cron/acars-poll` every minute; and
- `/api/v1/internal/cron/privacy-lifecycle` every hour.

GitHub Actions needs the repository secret `VERCEL_TOKEN`, plus the repository
variables `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, and
`VERCEL_GITHUB_REPOSITORY_ID`. Application and database secrets remain
environment-scoped in Vercel. Configure Protection Bypass for Automation in
Vercel; the workflow reads and masks its current value through the project-scoped
token instead of duplicating it in GitHub. After CI succeeds, a default-branch
workflow deploys only internal pull requests and `main` without checking out
untrusted code while holding the Vercel token. It does not modify the database;
`/api/ready` confirms connectivity and the tenant/membership schema. Each
Production request disables custom-domain assignment until readiness passes,
then the workflow promotes the staged deployment.

A one-minute cron requires an eligible Vercel plan. If the cron is deployed less frequently, outbound messages still send immediately, but inbound Hoppie traffic appears later.

## Configuration verification

Before promoting a deployment:

1. Load `/health`, confirm the database-configured flag and effective ACARS
   provider, then verify readiness with a synthetic authenticated read.
2. Create a synthetic account through the tenant URL, submit an application,
   approve it in the tenant admin UI, select the organization, and confirm URL,
   Clerk organization, role, and API tenant agree.
3. Load `/impressum` and `/privacy`; verify real operator details and all links.
4. Confirm `NEXT_PUBLIC_SOURCE_URL` points to the corresponding source of the deployed version.
5. From an admin account, test the Hoppie ground station.
6. Verify BotID Basic and Deep Analysis mutations through the browser.
7. Confirm the ACARS cron is succeeding and polling only configured tenants.
8. Verify the privacy lifecycle cron and approved policy before execution.
9. Verify SimBrief/Navigraph callback URLs and tenant logo storage without
   exposing credentials.
10. Publish a synthetic dispatch release and verify its weather-unavailable
    fallback as well as the successful provider path where permitted.
11. Verify direct pilot/dispatcher invitation, role change, removal, failed-
    provider retry messaging, and application closed/role-specific policy.
12. Issue a synthetic simulator device token, ingest a sequenced sample, verify
    dispatcher presence/OOOI, then revoke the token.
