# MSFS telemetry and OOOI contract

This document defines the implemented MSFS 2024 ingestion, presence, pairing,
retention, and OOOI behavior. The data is for simulated operational awareness;
it is not a real-world aviation safety, surveillance, or flight-following
service.

## Device and flight pairing

A member creates a named connection in **My settings**. The API returns a
device bearer token exactly once and stores only a keyed authenticator. The
token is bound to the authenticated tenant and membership and can report only
an `accepted`, `briefed`, or `active` flight assigned to an active pilot
membership. The locked ingestion statement rechecks assignment, flight state,
pilot role, and membership status, so a concurrent reassignment, completion,
or suspension cannot admit one final sample using stale service-layer state.

Each flight has one live writer lease and each device can hold one live flight
lease. A lease is renewed by accepted samples and expires after two minutes.
Concurrent devices for one flight, or one device attempting concurrent flights,
receive a conflict without consuming a sequence or changing current/history
state. Revoking a device atomically invalidates its authenticator, releases its
lease, and records the audit event so a replacement client can pair
immediately.

Samples use a monotonically increasing, device-wide integer sequence and a
minimum two-second server receipt interval. Replayed sequences and faster
samples are rejected. Values are bounded by the public OpenAPI schema, and a
simulator clock more than 24 hours from receipt is rejected.

## Trusted time and presence

`simulatorTime` is retained as source data but never drives presence or OOOI.
The API records a trusted `sampleAt` when it receives an accepted sample:

- presence is **online** through 30 seconds after `sampleAt`;
- presence is **stale** after 30 seconds through two minutes; and
- presence is **disconnected** after two minutes or before any sample.

Automatic OOOI occurrence time, provenance creation time, the current
heartbeat, the lease, and rate limiting all use `sampleAt`. This prevents a
client-controlled simulator clock from forging operational occurrence or
presence time.

## Automatic OOOI transition table

Automatic inference compares the last accepted phase with the new accepted
phase. The first sample never infers an event.

| Previous phase            | New phase  | Event | Stored field |
| ------------------------- | ---------- | ----- | ------------ |
| `preflight`               | `taxi_out` | OUT   | `outAt`      |
| `preflight` or `taxi_out` | `airborne` | OFF   | `offAt`      |
| `airborne`                | `taxi_in`  | ON    | `onAt`       |
| `taxi_in`                 | `parked`   | IN    | `inAt`       |

An automatic event is written only when its field is unset, it has not been
manually overridden, and the new server receipt time remains chronological
with every OOOI value already stored. The field update, telemetry current
state, track point, device sequence, lease, append-only provenance, and audit
record are one PostgreSQL statement: any failure rolls all of them back.

Duplicate phases, reversed phases, and phase changes not listed above still
update current telemetry but do not create OOOI. A skipped departure phase can
therefore produce OFF from `preflight` to `airborne`, but it does not invent
OUT. Other skipped phases do not backfill missing events. Dispatch must correct
missing values explicitly when the simulator phase stream cannot establish
them.

## Manual correction precedence

A dispatcher or administrator can set or clear one or more OOOI values with a
required reason. The server validates the resulting non-null timestamps as
`OUT <= OFF <= ON <= IN`. The authenticated actor, reason, supplied value (or
clear), audit record, and flight update commit atomically.

A supplied manual value, including an explicit clear, marks that individual
event as manually overridden. Later simulator phases cannot overwrite or
recreate it. Automatic ingestion locks the tenant flight row before reading or
writing OOOI, so a concurrent correction is serialized: the correction is the
authoritative final value and its provenance is never lost. A correction that
would conflict with existing timestamps is rejected in full with no partial
field or provenance changes.

### Mandatory issue #17 integration

This branch predates issue #17 and therefore has no `flights.version` column to
update. When the streams are combined, both the automatic OOOI statement and
the manual correction statement **must** increment the locked flight version
and include `fromVersion` and `toVersion` in their audit metadata. The combined
change must prove that a concurrent version-checked dispatcher edit cannot
silently overwrite an OOOI mutation. #22 is not integration-complete on a
versioned-flight baseline until that commit and contract test are present.

## Current state and retained track

Current state is stored separately from history. Every accepted sample
physically prunes that active flight's history to the newest 5,000 points and
removes points older than 24 hours. Track reads independently enforce the
24-hour cutoff, including for a disconnected flight. Issue #27 owns recurring
physical deletion of dormant expired rows; this feature does not change
production cron configuration.

Current-state reads also join the current assignment, active pilot membership,
eligible flight status, and active device. A revoked device, reassigned flight,
disabled pilot, or terminal flight therefore disappears from live presence
immediately even when its last sample is less than 30 seconds old. Historical
rows remain subject to the retention and authorized flight-detail contracts.

The assigned pilot can read their flight. Dispatchers and administrators can
read tenant flights and the tenant monitoring snapshot. All lookup, mutation,
lease, current-state, track, OOOI, and audit predicates remain tenant scoped.
Composite foreign keys additionally enforce tenant coherence across each
flight, membership, device, current, lease, track, and provenance edge.

## Local verification

Normal tests never contact MSFS, a map provider, or any shared database. The
PostgreSQL contract suite is opt-in and requires a disposable PostgreSQL URL:

```bash
TEST_DATABASE_URL=postgres://postgres:password@127.0.0.1:55439/test \
  pnpm --filter @va-dispatch/api test:postgres-contract
```

The suite creates and drops a unique schema. Do not point it at a shared or
production database.
