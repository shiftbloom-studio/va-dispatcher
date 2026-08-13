# Project Status and Limitations

This page records the implemented boundary reviewed against the integrated
application on 13 August 2026. Re-verify it whenever behavior changes.

## Implemented

| Area                | Current implementation                                                                                                |
| ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Tenant shell        | Path-based tenant routing, vSAS branding, unknown-slug rejection                                                      |
| Authentication      | Clerk sign-in/sign-up/session tasks, pre-membership application, organization agreement, production-hard-off fixtures |
| Roles               | Pilot, dispatcher, and admin authorization at API and UI boundaries                                                   |
| Schedule demand     | Normalized UTC availability, server validation, pending-request edit with version checks                              |
| Request fulfillment | Review, rejection, partial/final fulfillment, idempotent batches, explicit linked-flight cancellation policy          |
| Flights             | Tenant-safe assignment, time/availability checks, optimistic concurrency, immutable declined re-offers                |
| Dispatch planning   | Revisioned releases with route, weather, fuel, payload, remarks, and dispatcher attribution                           |
| SimBrief/Navigraph  | Dispatcher preparation, pilot-owned generation, callback recovery, OFP visibility, account linking                    |
| Operations          | Trusted board window, overdue/active handling, live pilot presence, active pilot dashboard group                      |
| MSFS telemetry      | Revocable pilot devices, current/track data, live phase, automatic and manual OOOI provenance                         |
| ACARS               | Dispatcher-only Hoppie send/poll, stored conversations, bounded inbound deduplication, explicit uncertain outcomes    |
| Administration      | Native invitations, application decisions, role/Clerk sync, removal, member-access policy, safe reassignment, audit   |
| Privacy lifecycle   | Approved retention policies, dry runs, resumable execution, subject workflows, holds, provider tasks                  |
| Schema workflow     | Canonical Drizzle schema, fresh-database push, and real PostgreSQL contract checks                                    |
| Verification        | Unit/component contracts, real PostgreSQL contracts, fast browser workflows, two integrated app journeys              |

## Operational boundaries

### External providers

- Production Hoppie requires a tenant-owned ground-station callsign and logon,
  stable encryption key, and a working one-minute scheduler. Hoppie acceptance
  is not a delivery or read receipt.
- SimBrief requires the application's API key and the pilot's own verified
  SimBrief account. Navigraph requires registered OAuth credentials and exact
  callback URLs.
- Automated tests use deterministic local adapters. They do not prove live
  provider availability, network affiliation, delivery, or OAuth registration.

### Simulator and monitoring

- Pilots use a separately deployed MSFS client with a revocable device token.
  The web application does not impersonate the simulator.
- Dispatcher telemetry cards and presence are operational awareness tools, not
  certified navigation or a real-world flight-following system.
- ACARS progress text and simulator telemetry remain distinct provenance
  sources. Receiving a message does not silently rewrite telemetry.

### ACARS scope

- Web ACARS is dispatcher/admin only; pilots communicate from their simulator
  client.
- There is no automatic resend after an uncertain provider outcome. The UI
  tells the dispatcher to check the conversation before composing a new send.
- The application suppresses repeat inbound payloads within a bounded window,
  but intentionally allows the same legitimate text again later.
- Poll-health dashboards, delivery/read receipts, and automatic flight
  correlation are not promised by the current product.

### Privacy and governance

- Software supports retention and data-subject operations; it does not certify
  GDPR compliance or choose a lawful retention schedule for an operator.
- Legal review, policy approval, backups, and external-provider completion
  tasks remain operator responsibilities.
- Audit events are access-controlled operational evidence, not a tamper-evident
  external ledger.

### Deployment and product shape

- The backend is multi-tenant, while the checked-in web presentation registry
  currently contains only vSAS.
- The project is pre-production. GitHub-coordinated Vercel deployments apply
  canonical `schema.ts` with `db:push` before readiness, without Drizzle's
  data-loss `--force`. Durable incompatible migrations are not yet supported.
- The integrated E2E authority is deliberately non-production-only and requires
  an explicitly confirmed disposable database.
- A successful local or CI run is not a substitute for a post-deployment Clerk,
  BotID, service-rewrite, static-asset, and live-provider acceptance check.

## Release-readiness checklist

Before calling a deployment fully ready:

1. Confirm the automated schema step and `/api/ready` gate passed for the exact
   deployment commit.
2. Verify Clerk organization roles, legal configuration, BotID, and tenant
   encryption keys.
3. Complete deployed signup/application/approval, invitation, removal, pilot,
   and dispatcher journeys.
4. Verify Hoppie, SimBrief, Navigraph, and the MSFS client only with operator-
   supplied credentials appropriate to that environment.
5. Record any provider or legal prerequisite as external; do not replace it
   with test-only configuration or a hidden fallback.

## Documentation rule

When a boundary changes, update the implementation, OpenAPI contract, focused
tests, relevant Wiki page, and this status page together. Publish the reviewed
`wiki/` mirror intentionally to the separate GitHub Wiki repository.
