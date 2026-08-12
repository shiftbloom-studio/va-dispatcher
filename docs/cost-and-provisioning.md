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
- Cron is **every 5 minutes** and **no-ops** when `ACARS_PROVIDER=mock` or no Hoppie logons — so it will not keep Neon awake during mock/dev.

### ACARS

| Mode                            | Idle impact                                                                                                       |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `ACARS_PROVIDER=mock` (default) | Cron does nothing; no Hoppie traffic; Neon stays asleep if no API traffic                                         |
| `ACARS_PROVIDER=hoppie`         | Cron polls only tenants with encrypted logon; set schedule to `*/1 * * * *` only if you need near-real-time inbox |

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
#         ACARS_PROVIDER=mock
#         CRON_SECRET=...

pnpm db:push
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
- 1-minute cron while still on mock ACARS
- Extra observability SaaS until you have production traffic
