# Database migration and recovery runbook

This runbook is the production schema authority. Application startup and HTTP
request handling never apply schema changes. A release operator runs reviewed
migrations as a separate, observable deployment step before promoting code that
depends on them.

## Migration history and baseline

The immutable `20260812151552_pr29_baseline` represents `main` at commit
`c1be9d6`, including Navigraph OAuth/SimBrief persistence plus PR29 dispatch
releases, operational events, assignment confirmation, and tenant branding. A
fresh database is created entirely from the checked-in migration history:

```bash
export DATABASE_URL='postgresql://.../va_dispatch'
export MIGRATION_CONFIRM_DATABASE='va_dispatch'
pnpm db:check
pnpm db:migrate
```

`MIGRATION_CONFIRM_DATABASE` must match the database name in `DATABASE_URL`.
The runner holds a PostgreSQL advisory lock and uses the `pg` transactional
migrator, so concurrent cooperative runs serialize and failed DDL is rolled
back without recording the migration. Keep migration credentials outside the
application service and grant the application role only its runtime rights.

`pnpm db:push` is permitted only for an empty, disposable developer database.
It is not a production deployment or drift-repair command.

### Adopting an existing ledger-less released database

Databases managed with `db:push` before this history existed already contain
application tables. Do not apply the fresh baseline to them. The adopter
supports only three audited catalog signatures: pre-PR14, post-PR14, and exact
PR29. A PR29 source receives only the Drizzle ledger; older sources receive the
minimum reviewed upgrades before that ledger is written.

1. Stop writes or enter a documented maintenance window.
2. Take a provider snapshot and a logical `pg_dump`; record the target, source
   revision, row counts, owner, and snapshot identifier in the change record.
3. Restore that backup to an isolated rehearsal database.
4. Run `pnpm db:signature` against the rehearsal and compare it to
   `apps/api/drizzle/adoption/released_signatures.json`. The fixture SQL files
   document each released shape. Investigate any difference; never edit the
   signatures or adoption SQL to conceal unknown drift.
5. Rehearse the guarded adoption and application checks on the restore.
6. With a second operator confirming the target and verified backup, run:

```bash
export DATABASE_URL='postgresql://.../va_dispatch'
export MIGRATION_CONFIRM_DATABASE='va_dispatch'
export ADOPT_PR29_BASELINE='I_HAVE_A_VERIFIED_BACKUP'
pnpm db:adopt:pr29
pnpm db:migrate
```

The adoption transaction acquires a maintenance lock, validates the complete
public catalog before DDL, checks legacy flight data against the new time
constraint, upgrades if necessary, verifies the final PR29 catalog, and writes
the exact Drizzle v1 ledger row. Unknown drift, an existing Drizzle schema,
invalid legacy data, repeated adoption, or a partial upgrade fails closed. The
entire upgrade and ledger write roll back together. Keep the backup until
post-deployment verification and the agreed observation window have completed.

## Adding a migration

1. Rebase onto the commit containing the current migration history.
2. Change `apps/api/src/db/schema.ts`.
3. Run `DATABASE_URL=postgresql://unused/unused pnpm db:generate`.
4. Review both `migration.sql` and `snapshot.json`; use a descriptive folder
   name and never change an already applied migration.
5. For data changes, add a bounded, resumable backfill with progress metrics.
6. Run `pnpm db:check` and the migration CI job.

Other feature branches, including core-correctness schema work, must add a new
migration after this baseline. They must not fold columns into the baseline.

For incompatible changes use expand/backfill/contract:

- **Expand:** add nullable columns, new tables, indexes (concurrently where
  required), or dual-readable values that old and new code both tolerate.
- **Backfill:** process bounded batches, checkpoint progress, observe errors,
  and make retries idempotent. Do not hold one transaction over the full data
  set.
- **Contract:** only after every application version reads the new shape and
  verification proves the backfill complete, remove old fields in a later
  release and migration.

## Deployment, backout, and partial failures

Before applying a migration, capture a schema dump, verify a recent restorable
backup, rehearse on a restore of representative size, review locks and expected
duration, and define stop conditions. Run one migration authority per database.
Afterward verify the migration ledger, critical row counts, API health, and a
synthetic tenant workflow before promotion.

Prefer backward-compatible migrations so application code can be rolled back
without reverting the database. DDL rollback is appropriate only when a tested
inverse is lossless and no newer writer has used the new shape. Destructive or
data-transforming changes normally require a forward fix or point-in-time
restore into a new database followed by an explicit cutover; never improvise a
down migration against production.

If migration execution fails, leave the application release unpromoted. The
transaction prevents partial DDL for normal migrations, and the migration row
is written in the same transaction. Capture sanitized logs and inspect locks,
the migration ledger, and schema before retrying. Never mark a failed migration
as applied by hand.

## Backup and restore rehearsal

At least before high-risk migrations and on the operator's recurring recovery
schedule:

1. Confirm provider point-in-time recovery retention and the logical backup's
   encryption, access, region, and expiry.
2. Restore to a new isolated database, never over the source.
3. Validate schema, migration ledger, tenant counts, referential integrity, and
   representative synthetic reads.
4. Run pending migrations and application smoke tests against the restore.
5. Record recovery point, recovery time, failures, and remediation; then delete
   the rehearsal database under the approved retention policy.

Neon snapshots, Vercel configuration, and backup deletion are operator/provider
responsibilities. A successful migration test does not prove backup recovery;
both exercises are required.
