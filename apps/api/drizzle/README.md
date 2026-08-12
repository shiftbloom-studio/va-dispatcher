# Database migrations

`20260812151552_pr29_baseline` is the immutable baseline for the schema at
`main` commit `c1be9d6`, after PR29's dispatch-release, operational-event, and
tenant-branding additions. Fresh databases apply it with `pnpm db:migrate`.

Databases created before migration history existed must not run the baseline
directly. Follow `docs/database-migrations.md`: verify a backup and rehearsal,
then use the guarded `pnpm db:adopt:pr29` command. Its transaction recognizes
only an exact pre-PR14, post-PR14, or PR29 ledger-less catalog signature,
performs the required upgrade, verifies the final PR29 signature, and records
the baseline. Any unknown or partially upgraded shape fails closed before DDL.

Never edit a committed migration or snapshot. Schema work after this baseline
must rebase onto the baseline commit and generate an additive migration with
`pnpm db:generate`. This includes migrations for issues #16 and later schema
work; never fold them into this baseline.
