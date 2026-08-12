# Project Status and Limitations

This page records the implemented boundary reviewed against the default-branch application on 12 August 2026. It prevents planned or branch-only work from being described as shipped behavior. Re-verify it whenever a feature merges.

## Implemented

| Area                  | Current implementation                                                 |
| --------------------- | ---------------------------------------------------------------------- |
| Tenant shell          | Path tenant, vSAS branding, unknown-slug rejection                     |
| Authentication        | Clerk sign-in/sign-up/session tasks inside tenant shell                |
| Tenant agreement      | URL, Clerk org, `/me`, and `/tenant` checks before business data       |
| Roles                 | Pilot, dispatcher, admin hierarchy and API authorization               |
| Profiles              | Self-service display name and unique aircraft callsign                 |
| Schedule demand       | Multiple UTC intervals, count, title, notes, pilot visibility          |
| Dispatcher requests   | Queue, review, reject, cancel, exact-count complete offer              |
| Flights               | Ad-hoc/request-linked creation, assignment, edit, lifecycle, reasons   |
| Operations board      | Seven-day status board, counts, 10-second refresh                      |
| ACARS                 | Production Hoppie telex send/poll, station conversations, flight links |
| Hoppie administration | Test-before-save encrypted tenant credential and removal               |
| Local ACARS           | DB mock provider and inbound simulator, production disabled            |
| API documentation     | OpenAPI JSON, Swagger UI, ReDoc, completeness tests                    |
| Security              | Clerk, tenant isolation, roles, BotID, headers, safe provider errors   |
| Privacy/legal         | Public legal pages, strict configuration, consent-gated telemetry      |
| Open source           | AGPL, contribution, conduct, support, security, issue/PR templates     |
| Automation            | CI, coverage, browser smoke tests, audits, dependency review, CodeQL   |

## Not implemented on the current default branch

### SimBrief and Navigraph

There is no current default-branch:

- SimBrief/Navigraph account link;
- OAuth flow;
- dispatch redirect or prefilled flight-plan generation;
- OFP fetch/import;
- stable SimBrief flight ID;
- dispatcher identity snapshot for OFP remarks; or
- flight-plan revision model.

Do not promise SimBrief generation in user or deployment documentation until its code, schema, API, UI, security, and tests are merged together.

### Live pilot/aircraft monitoring

There is no simulator/MSFS telemetry ingestion, websocket/live feed, aircraft position table, track history, map, online-presence heartbeat, or automatic flight-phase detection.

The operations board is a status board. `active` is a manual dispatcher status, and **Active pilots** counts active pilot memberships rather than currently connected or flying people.

### Automated OOOI

The flight schema has nullable `outAt`, `offAt`, `onAt`, and `inAt`, but no current UI or ingestion path populates them. ACARS progress/position bodies remain message text.

### Complete member administration UI

Member list, update, and Clerk sync APIs exist. The web uses member lists for assignment and ACARS suggestions, but there is no full member-role/status management console.

### Audit viewer

Key mutations write `audit_events`. There is no read endpoint, export, tamper-evident ledger, or admin screen.

### Automated privacy lifecycle

There is no recurring retention/deletion job, data-subject export, account erasure workflow, provider deletion orchestration, or backup purge automation. Those remain operator procedures and future product work.

## Current workflow boundaries

### Schedule requests

- No edit endpoint after creation.
- Detailed intervals are web-validated but stored in flexible JSON.
- Cancellation does not alter linked flights.
- Historical partial requests cannot be appended in the current UI.
- Bulk offer creation has no explicit idempotency key.

### Flights

- API-level ETA-after-ETD enforcement is not complete; web forms enforce it.
- API callers can create an offered flight with a nullable or unchecked membership reference; the web restricts selection to active tenant pilots.
- Material edits do not automatically reset pilot acceptance.
- Updates are last-write-wins, with no optimistic version or compare-and-set contract.
- Declined flights are terminal; there is no re-offer/reassign recovery transition.
- Operations-board query has no lower ETD bound for non-terminal flights.
- Active flights have no dedicated pilot-dashboard group.

### ACARS

- Free-text telex is the primary outbound web operation.
- Hoppie acceptance is not delivery/read status.
- Failed sends are manual-retry only and intentionally not stored.
- Inbound messages are not automatically correlated to a flight.
- Position/progress messages are not parsed into telemetry.
- Polling errors are logged, but there is no operator alert dashboard.

### Data evolution

- Drizzle scripts exist, but no migration history is checked in.
- There is no transaction/idempotency architecture for multi-record dispatch generation.
- The backend is tenant-scoped, while the web's static registry currently contains only vSAS.

## Recommended roadmap order

The safest dependency order for closing the gaps is:

1. **Correctness foundation:** server-side flight/member/time/availability validation, idempotent bulk creation, optimistic concurrency, and reviewed migrations.
2. **Lifecycle completion:** request edits/partial append policy, cancellation cascade choices, declined recovery, assignment acceptance reset, active pilot UX.
3. **SimBrief:** pilot-owned identity/linking, dispatcher-prepared canonical data, stable IDs, OFP import/revisions, correct dispatcher name/remarks.
4. **Telemetry and OOOI:** authenticated simulator ingestion, current and historical position models, phase rules, pilot consent/privacy, dispatcher monitoring.
5. **ACARS correlation:** callsign/flight correlation, structured progress/position parsing, alerts, and operational status.
6. **Administration and governance:** member console, audit viewer/export, retention and data-subject workflows, operational alerts.

Each area must preserve tenant isolation, explicit state transitions, Hoppie safety, privacy-by-default, scale-to-zero economics where practical, and the distinction between passing tests and live-provider acceptance.

## Documentation rule

When one of these limitations is removed:

1. Add evidence-backed tests.
2. Update the relevant deep Wiki page.
3. Move the item from **Not implemented** or **boundaries** into **Implemented** here.
4. Update Home and role descriptions if the user-visible promise changes.
5. Publish the reviewed `wiki/` mirror to the GitHub Wiki.
