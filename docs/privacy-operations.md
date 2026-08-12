# Privacy lifecycle operations

The application now provides an operable, tenant-scoped privacy lifecycle. It
does **not** certify GDPR compliance or decide the controller's lawful bases,
retention periods, legal holds, or response deadlines. Have qualified counsel
approve the deployment's schedule and procedures before activating them.

## Data lifecycle map

| Class              | Application action                                                  | Default template | Hold behavior                           | External follow-up                                                |
| ------------------ | ------------------------------------------------------------------- | ---------------: | --------------------------------------- | ----------------------------------------------------------------- |
| Memberships        | Anonymize disabled, inactive identities with no open work           |         730 days | Tenant/member holds exclude rows        | Clerk account and provider identities                             |
| Schedule requests  | Delete terminal requests and their free text/preferences            |         730 days | Tenant/member holds exclude rows        | None normally                                                     |
| Flights            | Delete terminal flights; cascades release, event, and SimBrief rows |       2,555 days | Tenant/member holds exclude rows        | Provider-generated artifacts as applicable                        |
| SimBrief/OFP       | Delete stored request, identifiers, errors, and full OFP payload    |          90 days | Tenant/member holds exclude rows        | Navigraph/SimBrief request if legally applicable                  |
| ACARS              | Delete stored messages, raw Hoppie payload, and local mock queue    |          30 days | Tenant/member holds exclude linked rows | Hoppie has no application deletion API; document its queue expiry |
| OAuth transactions | Delete expired encrypted PKCE transactions                          |            1 day | Tenant/member holds exclude rows        | Navigraph authorization data is provider-managed                  |
| Audit events       | Delete old tenant audit rows                                        |         365 days | Tenant/member holds exclude rows        | Append-only application history is not tamper-evident             |
| HTTP/security logs | Provider task, never direct database deletion                       |          30 days | Follow the provider hold process        | Vercel/project log settings and deletion support                  |
| Backups/PITR       | Provider task, never overwrite a source database                    |          30 days | Follow the provider hold process        | Neon retention/PITR and independent backup inventory              |

An active subject restriction is also treated as retention protection for
every row that can be linked to that member. Tenant-only data without a subject
link remains governed by tenant holds and the approved schedule.

These defaults are a template, not legal approval. An administrator creates an
immutable draft with all nine classes. A different active administrator must
approve it; approval retires the previous active version. Automatic execution
is off by default. An approved policy can require an aged completed dry run
before the recurring job creates an execution.

## Retention runbook

1. Verify the active policy and the two administrators who created and approved
   it. Record the legal review/change reference outside free-text application
   fields if that reference is sensitive.
2. Queue a uniquely keyed `dry_run`. The hourly job processes one bounded
   class checkpoint per run. Read the run until it is `completed`; the report
   shows eligible and held counts without changing operational data.
3. Investigate unexpected counts, correct the policy or data classification,
   and create/approve a new policy rather than editing an active version.
4. For manual execution, supply the completed dry-run ID, a new idempotency key,
   and exact confirmation `EXECUTE APPROVED RETENTION`. Execution uses the dry
   run's fixed `asOf`, processes bounded batches, and resumes the same class
   until no eligible rows remain.
5. A failed checkpoint records a sanitized error and cursor. Fix the cause and
   explicitly retry it. Already committed batches are idempotent; the cursor
   never advances across a failed batch.
6. Close the generated Vercel, backup, and Hoppie verification tasks. Record a
   useful operator note without copying personal data or credentials.

Each completed run records tenant-scoped audit evidence containing policy,
mode, cutoff basis, attempt count, and aggregate report. It never stores a
backup, decrypted secret, exported subject payload, or raw provider error in
the audit event.

## Verified requests and two-person control

Application administrators create a request only after receiving the request
through the controller's approved channel. A separate verification action must
record that identity and authority were checked without storing identity
documents in VA Dispatch.

- Export, correction, restriction, and objection become executable after
  verification.
- Anonymization and erasure additionally require approval by an administrator
  different from the request creator, the subject to be disabled and non-admin,
  no open request/flight work, no active tenant/member legal hold, completion
  of the Clerk offboarding task, and exact confirmation
  `ERASE VERIFIED SUBJECT DATA`.
- A legal hold is initially pending and becomes active only after approval by a
  different administrator. Pending and active holds both conservatively block
  destructive subject processing and retention; this prevents the recurring
  job from outrunning the second review. A tenant-wide hold has no member ID; a
  subject hold blocks only that member. Expired and released holds no longer
  block work. A held destructive request records `blocked`; after the hold is
  released or expires, an administrator must use the explicit request retry
  action before processing again.
- Restriction and objections are stored separately from membership status.
  They block new optional SimBrief/Navigraph or ACARS processing for the
  selected purposes; essential account/security processing remains controlled
  by the normal authorization and legal basis.

Local erasure removes terminal subject-owned requests/flights and directly
linked ACARS/SimBrief data. Local anonymization preserves operational records
but removes identity, free text, provider payloads, and account links. Both are
conservative: open work or a concurrent change blocks the operation.

## Export completeness and security exclusions

Exports are JSON pages of at most 500 records with an authenticated, encrypted
cursor scoped to the verified request. They cover
tenant metadata (without the encrypted Hoppie logon), memberships, retention
policy versions and requested runs, controls, schedule requests, flights, every
dispatch release revision, flight operational events and metadata, OAuth
transaction metadata, full SimBrief request/OFP payloads, ACARS free text/raw
provider payloads, relevant audit metadata, privacy requests/holds/tasks, and
the tenant-only mock ACARS queue. Tenant and member exports share the same
inventory; member export selection follows subject ownership plus every stored
creator, verifier, approver, releaser, updater, requester, and provider-task
operator link.

Encrypted credentials and authenticators are security material, not portable
personal-data content, and are explicitly omitted:

- `tenants.hoppie_logon_enc`;
- `navigraph_oauth_transactions.code_verifier_enc`; and
- `simbrief_dispatches.callback_token_mac`.

Audit metadata is redacted through the same bounded redaction policy as the
audit viewer. Export-page access is audited with counts and store names, never
the exported payload. The response is `private, no-store`.

Verifying an export creates provider/backup tasks for Clerk, Vercel, Neon,
independent backups, Hoppie, and Navigraph/SimBrief. Finishing the local pages
moves the request to `awaiting_external` while any task is pending or failed;
the last completed or documented-not-applicable task finalizes it. Do not mark
the controller's response complete until every applicable task is closed.

## Provider and backup boundaries

- **Clerk:** VA Dispatch creates tasks; an authorized operator uses Clerk's
  supported export/correction/disable/delete process. No broad Clerk deletion
  credential is held by the lifecycle job.
- **Vercel:** configure log/analytics/security retention in the deployment and
  use provider support or available tools for a verified request. VA Dispatch
  cannot prove provider deletion.
- **Neon/backups:** configure PITR and snapshot retention, maintain a separate
  encrypted backup inventory, and allow old backups to expire. If restoration
  reintroduces deleted data, replay the approved deletion ledger before opening
  the restored service to users.
- **Hoppie:** messages leave the controller's system and no subject-erasure API
  is assumed. Never send personal/sensitive data; document the network's queue
  behavior and response limits.
- **Navigraph/SimBrief:** follow the provider's rights-request process where its
  processing role makes that applicable. VA Dispatch deletes its local account
  link, dispatch request, identifiers, errors, and OFP.

## Extension points after telemetry integration

When issue #22's schema is integrated, extend the policy/export tests and the
same bounded lifecycle engine for `simulator_devices`,
`flight_telemetry_current`, `flight_telemetry_leases`,
`flight_telemetry_track`, and `flight_oooi_events`. Device identifiers and OOOI
events must be included in member/tenant exports and erasure/anonymization.
Physical telemetry-track rows must receive scheduled expiry even when no
simulator reconnects. Do not claim telemetry lifecycle coverage until that
additive migration and store implementation land.
