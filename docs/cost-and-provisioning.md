# Cost and provisioning

Goal: low, usage-based cost with no always-on servers.

## Stack

| Layer          | Service                       | Billing model                                  |
| -------------- | ----------------------------- | ---------------------------------------------- |
| Web + API      | Cloudflare Workers            | Requests and CPU time; nothing while idle      |
| Database       | Cloudflare D1                 | Rows read/written and storage; no idle compute |
| Logos          | Cloudflare R2                 | Storage and operations; no egress fees         |
| Data cache     | Workers KV                    | Reads, writes, and storage                     |
| Images         | Cloudflare Images (transform) | Unique transformations per month               |
| Scheduled jobs | Worker cron triggers          | Counted as Worker invocations                  |
| Auth           | stem (shiftbloom, on Workers) | Shared service; no per-user fee                |

Check current Cloudflare pricing and free allowances before launch.
Set Cloudflare budget alerts for Workers, D1, R2, and Images.

## Scheduled load

- The Hoppie poll runs every minute but reads only tenants with a saved
  encrypted logon. With no configured tenant it performs one indexed query.
- The privacy lifecycle runs hourly and processes at most ten queued runs.

## Authentication

stem is a shared shiftbloom service on Cloudflare Workers, so VA Dispatch adds
no auth vendor cost. Locally you can skip it with `AUTH_DEV_BYPASS=true`
(never in production).

## ACARS by environment

| Environment  | Behavior                                                                                  |
| ------------ | ----------------------------------------------------------------------------------------- |
| Local / test | `ACARS_PROVIDER=mock`; the poll job skips work                                            |
| Production   | Hoppie is enforced; the cron checks configured tenants once per minute and sends are live |

## Provisioning

Follow [`cloudflare-deployment.md`](cloudflare-deployment.md).
