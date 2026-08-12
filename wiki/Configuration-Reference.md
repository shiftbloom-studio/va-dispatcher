# Configuration Reference

VA Dispatch has separate API and web environments. Vercel service bindings provide some values automatically in the multi-service deployment, but every production operator must still verify the complete configuration.

## API environment

Primary example: `apps/api/.env.example`.

| Variable                                          | Default                          | Required when                              | Purpose and constraints                                                                                |
| ------------------------------------------------- | -------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `NODE_ENV`                                        | `development`                    | Always                                     | `development`, `test`, or `production`                                                                 |
| `VERCEL_ENV`                                      | unset                            | Vercel supplies it                         | `development`, `preview`, or `production`; takes precedence when selecting the production ACARS policy |
| `PORT`                                            | `3001`                           | Local override only                        | Positive integer used by the local Node server                                                         |
| `CORS_ORIGIN`                                     | `http://localhost:3000`          | Fallback cross-origin deployment           | Comma-separated allowed web origins                                                                    |
| `APP_ORIGIN`                                      | unset                            | Provider callback browser redirects        | Public web origin; HTTPS in production                                                                 |
| `DATABASE_URL`                                    | unset                            | Every authenticated or persistent workflow | PostgreSQL connection URL, normally Neon                                                               |
| `CLERK_SECRET_KEY`                                | unset                            | Real authentication and Clerk member sync  | Server secret; never expose as `NEXT_PUBLIC_*`                                                         |
| `CLERK_PUBLISHABLE_KEY`                           | unset                            | Deployment integration may provide it      | Parsed by API configuration; browser Clerk uses `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`                    |
| `AUTH_DEV_BYPASS`                                 | `false`                          | Local header-auth mode                     | Allowed only when `NODE_ENV` is not `production`                                                       |
| `VSAS_CLERK_ORG_ID`                               | unset                            | Trusted vSAS production mapping            | Clerk organization ID allowed to create or repair the initial `vsas` tenant mapping                    |
| `ACARS_PROVIDER`                                  | `mock`                           | Declare `hoppie` in production             | `mock` or `hoppie`; production runtime always resolves to Hoppie                                       |
| `TENANT_SECRETS_KEY`                              | unset                            | Saving or using an encrypted Hoppie logon  | Exactly 32 random bytes, base64-encoded                                                                |
| `CRON_SECRET`                                     | insecure development placeholder | Production ACARS/privacy cron calls        | Long random bearer secret; replace the default                                                         |
| `SEED_DEMO_DATA`                                  | `false`                          | None currently                             | Reserved parsed setting; it does not currently seed records automatically                              |
| `SIMBRIEF_API_KEY`                                | unset                            | SimBrief Dispatch Redirect                 | Application key issued by SimBrief                                                                     |
| `SIMBRIEF_CALLBACK_URL`                           | unset                            | SimBrief generation                        | Public API callback URL                                                                                |
| `NAVIGRAPH_CLIENT_ID` / `NAVIGRAPH_CLIENT_SECRET` | unset                            | Navigraph account connection               | OAuth client credentials; server-only                                                                  |
| `NAVIGRAPH_REDIRECT_URI`                          | unset                            | Navigraph OAuth                            | Exact registered callback URL                                                                          |
| `BLOB_READ_WRITE_TOKEN`                           | unset                            | Tenant logo upload                         | Vercel Blob server credential                                                                          |
| `AVIATION_WEATHER_API_ORIGIN`                     | Aviation Weather API             | Dispatch release weather                   | HTTPS provider origin; local integrated tests replace it                                               |
| `AVIATION_WEATHER_USER_AGENT`                     | project identifier               | Weather requests                           | Operator-identifying user agent                                                                        |
| `E2E_FIXTURE_MODE`                                | `false`                          | Integrated tests only                      | Requires test environment, fixture secret, and exact disposable database confirmation                  |
| `E2E_FIXTURE_SECRET`                              | unset                            | Integrated tests only                      | Dedicated high-entropy fixture authority; never reuse `CRON_SECRET`                                    |
| `E2E_CONFIRM_DATABASE`                            | unset                            | Integrated tests only                      | Exact disposable database name                                                                         |

Generate independent production secrets:

```bash
openssl rand -base64 32  # TENANT_SECRETS_KEY
openssl rand -hex 32     # suitable CRON_SECRET material
```

Changing `TENANT_SECRETS_KEY` without re-encrypting stored values makes existing Hoppie credentials unreadable. Plan key rotation as a data migration or remove and re-enter each tenant credential under the new key.

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

The current frontend requires:

- Organizations enabled;
- organization slugs enabled;
- a vSAS organization with slug exactly `vsas`; and
- `VSAS_CLERK_ORG_ID` set to that organization's immutable ID.

Clerk organization roles map as follows:

| Clerk role suffix                     | Application role |
| ------------------------------------- | ---------------- |
| `admin`, `owner`                      | `admin`          |
| `dispatcher`                          | `dispatcher`     |
| `pilot`, `member`, unknown, or absent | `pilot`          |

First login always provisions an audited pilot. The stored local membership is
the runtime role; admin directory sync or the admin control plane may promote
it. Disabled or invited local memberships cannot access the application.

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

- `web` service rooted at `apps/web`;
- `api` service rooted at `apps/api` with `src/index.ts` entrypoint;
- a private service binding exposed to web as `API_INTERNAL_URL`;
- `/api/*` routed to API;
- all remaining paths routed to web; and
- `/api/v1/internal/cron/acars-poll` every minute; and
- `/api/v1/internal/cron/privacy-lifecycle` every hour.

A one-minute cron requires an eligible Vercel plan. If the cron is deployed less frequently, outbound messages still send immediately, but inbound Hoppie traffic appears later.

## Configuration verification

Before promoting a deployment:

1. Load `/health` and confirm database presence and effective ACARS provider.
2. Sign in through the tenant URL and confirm URL, Clerk organization, and API tenant agree.
3. Load `/impressum` and `/privacy`; verify real operator details and all links.
4. Confirm `NEXT_PUBLIC_SOURCE_URL` points to the corresponding source of the deployed version.
5. From an admin account, test the Hoppie ground station.
6. Verify BotID Basic and Deep Analysis mutations through the browser.
7. Confirm the ACARS cron is succeeding and polling only configured tenants.
8. Verify the privacy lifecycle cron and approved policy before execution.
9. Verify SimBrief/Navigraph callback URLs and tenant logo storage without
   exposing credentials.
