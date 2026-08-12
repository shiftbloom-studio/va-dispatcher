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

- **Clerk Free** is enough for a single VA (vSAS) pilot + dispatcher counts.
- No server process of yours; cost is identity MAUs, not idle compute.
- Locally you can skip Clerk with `AUTH_DEV_BYPASS=true` (never production).

### Vercel Functions

- Fluid Compute / Active CPU: billed when handling requests, not for sitting idle.
- Hobby/Pro free allowances cover light VA traffic.
- The production Hoppie cron runs **every minute** and polls only tenants with a saved logon. Vercel Pro is required for that frequency.

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

# Auth — Free plan is fine for vSAS
vercel integration add clerk --yes

# Pull secrets (names only logged; never commit .env)
vercel env pull apps/api/.env.local --yes
cp apps/api/.env.local apps/api/.env
# ensure: AUTH_DEV_BYPASS=true for local without Clerk UI
#         ACARS_PROVIDER=hoppie (production; tenants configure credentials in Settings)
#         CRON_SECRET=...

export MIGRATION_CONFIRM_DATABASE='va_dispatch'
pnpm db:migrate
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
