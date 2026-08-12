# Administrator control plane

The tenant administrator control plane is available at `/{slug}/admin`. It is
an application role boundary: every member and audit API independently requires
an authenticated `admin`; hiding navigation is not authorization.

## Member directory and Clerk reconciliation

The member console searches the tenant-local directory by display name, ACARS
callsign, or Clerk user ID and filters by application role and membership
status. Results use deterministic cursor pagination.

`POST /members/sync` reconciles the complete Clerk organization directory in
pages of 100. It does not silently stop at Clerk's first page and it returns
created, updated, unchanged, skipped, and failed counts. At most 25 opaque
failure locations are returned so one invalid member does not expose provider
error payloads or produce an unbounded response. Members absent from Clerk are
not disabled automatically; an administrator must review and disable them
explicitly.

Clerk synchronization may update role and display name or create an active
membership. Each mutation and the aggregate sync result is audited. A failed
per-member audit insert rolls back the corresponding membership mutation. If
the final aggregate audit insert fails after those transactions, the response
sets `summaryAuditRecorded` to `false` and reports a bounded failure explicitly;
completed member changes remain applied and retain their individual audits.

## Last administrator and recovery

The application serializes administrative role/status changes by tenant and
will not demote or disable the last active application administrator. Promote a
second active administrator first.

The break-glass recovery path is deliberately narrower than normal sync: if a
tenant has no active application administrator, a user presenting a valid Clerk
session whose verified organization role maps to `admin` may repair only their
own membership to active admin on authentication. The repair is tenant-scoped,
atomic, and audited as `member.admin_recovered`. It cannot replace normal role
management while any active application administrator remains.

A verified Clerk member without an application membership is first provisioned
as an active `pilot`, regardless of their Clerk directory role. Creation and the
`member.self_provisioned` audit event are one transaction. Dispatcher or admin
privilege then requires an audited directory sync or explicit application-admin
change, except for the no-active-admin recovery case above.

## Assigned-work policy

Changing an assigned pilot to `invited`/`disabled` or to a non-pilot role uses
the same safety policy:

- any `active` flight blocks the member change; complete or cancel it first;
- assigned draft, offered, accepted, or briefed flights and open schedule requests require an
  explicitly selected replacement;
- the replacement must be a different active `pilot` in the same tenant;
- draft and offered flights move to that pilot without changing status;
- accepted or briefed flights return to `offered`, invalidating the earlier
  acceptance so the replacement must accept explicitly;
- request-linked work is reassigned consistently with the flight assignment;
- an open flight linked to fulfilled, rejected, or cancelled request history
  blocks reassignment so terminal ownership/history is never silently rewritten;
- historical terminal flights and requests retain their original attribution.

The membership change, reassignment, status reset, and per-flight/per-request
audit events are one database transaction. Administrators can inspect counts
before changing a member with `GET /members/{id}/impact`.

## Audit access, export, and retention

`/{slug}/admin/audit` and `GET /audit-events` are admin-only and tenant-scoped.
History is ordered newest first and can be filtered by exact action, entity
type, actor, or UTC range. The JSON export is deliberately bounded to 1,000
events per file and returns a cursor when more history remains. Each export is
itself audited with actor, filters, returned count, and continuation state.

The API recursively redacts credential, secret, token, authorization, cookie,
message/packet body, connected-account identifiers, OAuth/PKCE values,
SimBrief OFP, Hoppie raw-response, and provider-payload keys before returning
audit metadata. It also bounds depth, array size, object keys, and string
length. Audit events are append-only application history, not a
cryptographically tamper-evident ledger.

The application policy template for `audit_events` is 365 days. The automated
privacy lifecycle is opt-in through a dual-approved active policy and a
completed dry run; operators must not claim expiry unless completed run
evidence confirms it. See [Privacy lifecycle operations](privacy-operations.md).
The workflow records retention runs as audit events and preserves the minimum
evidence required for legal or security obligations.
