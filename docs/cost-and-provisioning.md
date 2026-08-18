# Cost & provisioning (scale-to-zero)

Goal: **near-zero cost when nobody is using the tool**, while staying ready for vSAS testing.

## Stack choices for idle = $0

### Neon Postgres (required)

- Use **Neon Free** (or Launch with autosuspend) via Vercel Marketplace.
- Neon **scales to zero**: compute suspends after idle → no compute charge while sleeping.
- Cold start on first query is a few hundred ms — acceptable for dispatch UI.
- Driver already used: `@neondatabase/serverless` (HTTP, no persistent pool to keep warm).

**Avoid:** always-on Postgres, large fixed compute, paid Redis for v1.

### Clerk (required for real auth)

- Clerk's development instance is sufficient for local role testing, but the
  production `org:pilot` and `org:dispatcher` custom roles require the **B2B
  Authentication add-on**. Verify current Clerk pricing and included allowances
  before launch; the Free plan alone is not a complete production fit.
- No server process of yours; cost is the hosted plan/add-on and usage rather
  than idle compute.
- Locally you can skip Clerk with `AUTH_DEV_BYPASS=true` (never production).

### Vercel Functions

- Fluid Compute / Active CPU: billed when handling requests, not for sitting idle.
- Hobby/Pro free allowances cover light VA traffic.
- The production Hoppie cron runs **every minute** and polls only tenants with a saved logon. Vercel Pro is required for that frequency.
- The privacy lifecycle cron runs hourly and processes at most ten resumable
  checkpoints per invocation. It creates no destructive work until a policy is
  dual-approved and the dry-run/confirmation rules are satisfied.

### ACARS

| Environment        | Behavior                                                                                           |
| ------------------ | -------------------------------------------------------------------------------------------------- |
| Development / test | `ACARS_PROVIDER=mock` uses the internal adapter; no background Hoppie polling                      |
| Production         | Hoppie is enforced; the cron checks configured tenants once per minute and outbound sends are live |

## Provisioning steps

```bash
cd /Users/fzwork/work/va-dispatch
vercel login          # browser once
vercel link           # create/link project (Hobby is fine)

# Storage — pick Free / scale-to-zero plan in the prompt
vercel integration add neon --yes

# Auth — production custom roles require Clerk's B2B Authentication add-on
vercel integration add clerk --yes

# Pull secrets (names only logged; never commit .env)
vercel env pull apps/api/.env.local --yes
cp apps/api/.env.local apps/api/.env
# ensure: AUTH_DEV_BYPASS=true for local without Clerk UI
#         ACARS_PROVIDER=hoppie (production; tenants configure credentials in Settings)
#         CRON_SECRET=...

DATABASE_URL='postgresql://...' pnpm db:push
curl -X POST http://localhost:3001/api/v1/internal/seed/vsas \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"clerkOrgId":"org_..."}'
```

If an integration requires a **browser claim** step:

```bash
vercel integration open neon
vercel integration open clerk
```

## What not to add (yet)

- Upstash Redis / queues (idle or minimum cost; not needed)
- Always-on Neon compute
- 1-minute Hoppie polling cron before live ACARS is required
- Extra observability SaaS until you have production traffic
