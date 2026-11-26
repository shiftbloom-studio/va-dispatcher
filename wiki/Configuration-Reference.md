# Configuration Reference

VA Dispatch has separate API and web Worker environments. Production values come from Workers Builds variables and Worker secrets; local values come from `.dev.vars` files. Every operator must still verify the complete configuration.

## API environment

Primary example: `apps/api/.dev.vars.example`; production values are in `apps/api/wrangler.jsonc` under `env.production`.

| Variable                                          | Default                          | Required when                                          | Purpose and constraints                                                                                                                    |
| ------------------------------------------------- | -------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `NODE_ENV`                                        | `development`                    | Always                                                 | `development`, `test`, or `production`                                                                                                     |
| `APP_ENV`                                         | from `NODE_ENV`                  | Preview Workers                                        | `development`, `preview`, or `production`; `preview` relaxes production-only requirements, `production` forces the production ACARS policy |
| `PORT`                                            | `3001`                           | Node test server only                                  | Positive integer; `wrangler dev` sets its own port                                                                                         |
| `CORS_ORIGIN`                                     | `http://localhost:3000`          | Fallback cross-origin deployment                       | Comma-separated allowed web origins                                                                                                        |
| `APP_ORIGIN`                                      | unset                            | Production and local real-provider flows               | Canonical public origin only; explicit HTTPS value is mandatory in Production                                                              |
| `AUTH_ISSUER` / `AUTH_AUDIENCE`                   | unset                            | Real authentication                                    | OIDC issuer and expected audience of access tokens; required in production                                                                 |
| `AUTH_JWKS_URL`                                   | issuer discovery                 | Optional                                               | Signing keys; defaults to `jwks_uri` from the issuer's discovery document                                                                  |
| `AUTH_CLIENT_ID` / `AUTH_CLIENT_SECRET`           | unset                            | Invitations and directory sync                         | The app's OIDC client; used with the client credentials grant for stem's directory API. The secret is a secret                             |
| `AUTH_STEP_UP_SECONDS`                            | `600`                            | Sensitive admin actions                                | Maximum age of the passkey sign-in those actions need; `0` turns the check off                                                             |
| `AUTH_DEV_BYPASS`                                 | `false`                          | Local header-auth mode                                 | Allowed only when `NODE_ENV` is not `production`                                                                                           |
| `VSAS_AUTH_ORG_ID`                                | unset                            | Trusted vSAS production mapping                        | Identity organization ID allowed to create or repair the initial `vsas` tenant mapping                                                     |
| `ACARS_PROVIDER`                                  | `mock`                           | Declare `hoppie` in production                         | `mock` or `hoppie`; production runtime always resolves to Hoppie                                                                           |
| `TENANT_SECRETS_KEY`                              | unset                            | Every production deployment; protected flows elsewhere | Exactly 32 random bytes, base64-encoded; protects tenant credentials and signed/sealed transient state                                     |
| `CRON_SECRET`                                     | insecure development placeholder | Production ACARS/privacy cron calls                    | Long random bearer secret; replace the default                                                                                             |
| `SEED_DEMO_DATA`                                  | `false`                          | None currently                                         | Reserved parsed setting; it does not currently seed records automatically                                                                  |
| `SIMBRIEF_API_KEY`                                | unset                            | SimBrief Dispatch Redirect                             | Application key issued by SimBrief                                                                                                         |
| `SIMBRIEF_CALLBACK_URL`                           | unset                            | SimBrief generation                                    | Public API callback URL                                                                                                                    |
| `NAVIGRAPH_CLIENT_ID` / `NAVIGRAPH_CLIENT_SECRET` | unset                            | Navigraph account connection                           | OAuth client credentials; server-only                                                                                                      |
| `NAVIGRAPH_REDIRECT_URI`                          | unset                            | Navigraph OAuth                                        | Exact registered callback URL                                                                                                              |
| `AVIATION_WEATHER_API_ORIGIN`                     | Aviation Weather API             | Dispatch release weather                               | HTTPS provider origin; local integrated tests replace it                                                                                   |
| `AVIATION_WEATHER_USER_AGENT`                     | project identifier               | Weather requests                                       | Operator-identifying user agent                                                                                                            |
| `E2E_FIXTURE_MODE`                                | `false`                          | Integrated tests only                                  | Requires a non-production environment and the fixture secret; uses an in-memory local D1                                                   |
| `E2E_FIXTURE_SECRET`                              | unset                            | Integrated tests only                                  | Dedicated high-entropy fixture authority; never reuse `CRON_SECRET`                                                                        |

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

The D1 binding `DB` and the R2 binding `TENANT_LOGOS` are Worker bindings, not
environment variables. Schema changes go through `pnpm db:generate`, which
writes SQL migrations to `apps/api/migrations`; deploys apply pending
migrations with `wrangler d1 migrations apply`.

## Web environment

Primary example: `apps/web/.env.example`.

| Variable                             | Exposure     | Required when              | Purpose                                                                        |
| ------------------------------------ | ------------ | -------------------------- | ------------------------------------------------------------------------------ |
| `AUTH_ISSUER`                        | Server only  | Sign-in                    | stem issuer, for example `https://stem.example.com`                            |
| `AUTH_CLIENT_ID`                     | Server only  | Sign-in                    | The app's OIDC client ID                                                       |
| `AUTH_CLIENT_SECRET`                 | Server only  | Sign-in                    | The app's OIDC client secret (Worker secret)                                   |
| `AUTH_AUDIENCE`                      | Server only  | Sign-in                    | API resource requested on authorize and token calls; same value as the API's   |
| `AUTH_SESSION_SECRET`                | Server only  | Sign-in                    | 32+ random characters that encrypt the session cookie (Worker secret)          |
| `APP_ORIGIN`                         | Server only  | Production                 | Public origin for redirect URIs; set from `VA_HOSTNAME` by the Worker config   |
| `API_INTERNAL_URL`                   | Server only  | Local or test override     | API origin for server calls; production uses the `API` service binding instead |
| `API_ORIGIN`                         | Server/build | Local development          | `next dev` rewrites browser `/api/*` requests to this origin                   |
| `NEXT_PUBLIC_SOURCE_URL`             | Browser      | Every hosted fork          | Corresponding source for the deployed AGPL version                             |
| `NEXT_PUBLIC_E2E_ROUTE_FIXTURE_MODE` | Browser      | Fast Playwright suite only | Selects deterministic intercepted UI fixtures                                  |
| `NEXT_PUBLIC_E2E_FIXTURE_MODE`       | Browser      | Integrated test only       | Selects synthetic auth backed by the real local API/DB                         |
| `E2E_FIXTURE_SECRET`                 | Server       | Integrated test only       | Signs server-to-API fixture identity; same test authority                      |

Never enable fixture values in production. API and web code reject or ignore
them there, and deployment configuration should remain explicit and clean.

## Legal identity

The public `/imprint`, `/impressum`, `/privacy`, and `/datenschutz` pages load operator identity from server environment values. In production, required values fail closed instead of displaying placeholders.

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

## stem configuration

stem is the shared shiftbloom account service. Its operator registers VA Dispatch once:

1. Create a confidential client with `app` = `va-dispatcher`:
   - redirect URI `https://<web-origin>/auth/callback`;
   - post-logout redirect URI `https://<web-origin>/`;
   - resource `https://<web-origin>/api`, which must also be listed in stem's `RESOURCES`;
   - `skip_consent` (first-party app).
     The client ID and secret go to both Workers (`AUTH_CLIENT_ID`, `AUTH_CLIENT_SECRET`). The web Worker uses them to sign people in, and the API Worker uses them for the directory API.
2. Include `dispatcher` and `pilot` in stem's `ORG_ROLES`.
3. Create the vSAS organization for app `va-dispatcher` with slug exactly `vsas`, and set `VSAS_AUTH_ORG_ID` to its ID.
4. Set `APP_ORIGIN` to the canonical public web origin, so invitation links return to `/:slug` on an allowed redirect origin.
5. If stem runs as a Worker in the same Cloudflare account, set `AUTH_IDENTITY_WORKER` to its Worker name on both Workers Builds triggers. Calls to the issuer then use the `IDENTITY` service binding instead of the public hostname, so the issuer zone's bot protection cannot challenge them.

Tenant administrators never need access to stem itself. Their organization role and the VA Dispatch `admin` role are tenant-scoped; clients, roles, and organization provisioning stay with the stem operator.

Organization roles map as follows:

| stem organization role                | Application role |
| ------------------------------------- | ---------------- |
| `admin`, `owner`                      | `admin`          |
| `dispatcher`                          | `dispatcher`     |
| `pilot`, `member`, unknown, or absent | `pilot`          |

First tenant access provisions the verified `pilot` or `dispatcher` role. The stored local membership is the runtime authority after provisioning, and active role changes from the VA Dispatch admin console are synchronized back to stem. The sole recovery exception can promote a verified organization admin or owner when the tenant has no active application Admin. Disabled or invited local memberships cannot access the application and are not revived by directory synchronization.

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

## Cloudflare configuration

The full procedure is in
[`docs/cloudflare-deployment.md`](https://github.com/shiftbloom-studio/va-dispatcher/blob/main/docs/cloudflare-deployment.md).
In short:

- `apps/api/wrangler.jsonc` defines the API Worker. The top level is the local
  `wrangler dev` setup; `env.production` holds `<PLACEHOLDER>` values that
  `scripts/render-config.mjs` fills from Workers Builds variables (or an
  untracked `.env.deploy`) at deploy time.
- The API Worker claims `<VA_HOSTNAME>/api/*` with a zone route and binds D1
  `DB` and R2 `TENANT_LOGOS`.
- Cron triggers run `* * * * *` (Hoppie polling) and `0 * * * *` (privacy
  lifecycle) through the Worker's `scheduled()` handler. The
  `/api/v1/internal/cron/*` endpoints stay available for manual runs with
  `CRON_SECRET`.
- `apps/web/cloudflare.config.ts` defines the web Worker. It owns the custom
  domain, serves static assets, and binds the `API` service binding, the KV
  data cache, and Cloudflare Images.
- Secrets are set per Worker in the dashboard or with `wrangler secret put`,
  never in the repository.
- Workers Builds deploys `main`; the API build applies pending D1 migrations
  before it deploys. GitHub Actions validates only.

The Hoppie poll runs every minute on every Workers plan. Outbound messages send
immediately; inbound messages appear after the next poll.

## Configuration verification

Before promoting a deployment:

1. Load `/api/health`, confirm the database-configured flag and effective ACARS
   provider, then verify readiness with a synthetic authenticated read.
2. Create a synthetic account through the tenant URL, submit an application,
   approve it in the tenant admin UI, open the tenant again, and confirm URL,
   stem organization, role, and API tenant agree.
3. Load `/imprint`, `/impressum`, `/privacy`, and `/datenschutz`; verify real
   operator details, the language switch, and all links.
4. Confirm `NEXT_PUBLIC_SOURCE_URL` points to the corresponding source of the deployed version.
5. From an admin account, test the Hoppie ground station.
6. Verify that browser mutations pass the Cloudflare bot-score check and that
   a scripted mutation on a strict route is rejected.
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
