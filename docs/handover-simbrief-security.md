# SimBrief and Navigraph security hardening handover

Snapshot: 2026-08-12 (Europe/Berlin)

> Historical checkpoint: work resumed after this handover was written. The
> implementation-state sections below intentionally describe the pause point.

## Objective

Finish the backend-only SimBrief Dispatch Redirect and Navigraph OAuth
integration, resolve the GitHub CodeQL findings with real security changes,
validate the result, and merge only after every required PR check passes.

The user's explicit decision is:

> Do not dismiss or suppress the CodeQL findings. Preserve SimBrief protocol
> compatibility while using a safer design for credentials and opaque tokens.

## Repository and pull request

- Repository: `shiftbloom-studio/va-dispatcher`
- Worktree: `/Users/fzwork/.codex/worktrees/25e5/va-dispatch`
- Branch: `codex/simbrief-navigraph-integration`
- Pull request: [#14](https://github.com/shiftbloom-studio/va-dispatcher/pull/14)
- Base branch: `main`
- Last pushed commit: `9a5e1cf9a9f706b4264377e1693fc475381ba838`
- Current hardening changes: uncommitted
- Production OAuth redirect URI:
  `https://www.va-dispatcher.world/api/v1/simbrief/oauth/callback`
- Navigraph authorization endpoint:
  `https://identity.api.navigraph.com/connect/authorize`

Do not discard, reset, or overwrite the current uncommitted changes.

## Why PR #14 is not mergeable yet

The original pushed implementation passed its normal CI, dependency, Socket,
Vercel, and CodeQL analysis jobs, but the pull-request CodeQL alert gate failed
with four high-severity `js/insufficient-password-hash` results:

1. OAuth state SHA-256 calculation in
   `apps/api/src/domain/simbrief/oauth-service.test.ts` (two results).
2. OAuth state SHA-256 calculation in
   `apps/api/src/domain/simbrief/oauth-service.ts`.
3. SimBrief's provider-required MD5 `apicode` calculation in
   `apps/api/src/simbrief/adapter.ts`.

Failed alert check:
[GitHub CodeQL run 94113455709](https://github.com/shiftbloom-studio/va-dispatcher/runs/94113455709)

The normal CodeQL workflow itself completed successfully; the separate PR
alert-status check failed because the analysis uploaded these new alerts.

## Protocol constraints

### Navigraph OAuth

Navigraph requires Authorization Code with S256 PKCE and an opaque random
`state`. The callback URI must exactly match the registered URI. See the
[official Authorization Code documentation](https://developers.navigraph.com/docs/authentication/authorization-code).

The PKCE SHA-256 operation is protocol-mandated and is not password hashing. It
must remain S256.

### SimBrief Dispatch Redirect

SimBrief's official integration uses a server-side helper that holds the issued
API credential and returns the legacy `apicode`. See the
[official SimBrief API documentation](https://developers.navigraph.com/docs/simbrief/using-the-api).

The expected `apicode` bytes cannot be changed to bcrypt, Argon2, PBKDF2, or
HMAC without breaking the SimBrief protocol. Do not replace the digest with a
different algorithm, implement a disguised/custom MD5, rename variables merely
to evade analysis, add a suppression, or dismiss the alert.

The defensible approach is to isolate the mandated legacy operation behind a
narrow server-only compatibility boundary and minimize exposure of the API
credential. If CodeQL still rejects that design, obtain and integrate the
official server helper supplied by SimBrief or clarify an updated protocol with
Navigraph rather than forcing the PR through.

## Current uncommitted design

The current worktree contains the following incomplete hardening changes:

- `apps/api/src/lib/crypto.ts`
  - Adds HKDF-derived, purpose-separated HMAC-SHA-256 token authenticators.
  - Adds constant-time MAC verification.
  - Zeroizes temporary root, derived, encryption, and plaintext buffers where
    practical.
- `apps/api/src/lib/crypto.test.ts`
  - New tests for authenticated encryption, MAC verification, tampering, and
    purpose separation.
- `apps/api/src/domain/simbrief/oauth-service.ts`
  - Replaces the stored SHA-256 OAuth-state hash with a versioned state token:
    `v1.<22-character random ID>.<43-character HMAC>`.
  - Stores only the random lookup ID in the database.
  - Verifies the HMAC before querying or consuming the OAuth transaction.
- `apps/api/src/db/schema.ts` and
  `apps/api/src/db/repositories/navigraph-oauth.ts`
  - Rename the OAuth field from `stateHash`/`state_hash` to
    `stateId`/`state_id`.
- `apps/api/src/domain/simbrief/service.ts`
  - Replaces the callback token's plain SHA-256 hash with a purpose-separated
    HMAC.
  - Requires `TENANT_SECRETS_KEY` for SimBrief dispatch creation and callback
    verification.
- `apps/api/src/db/schema.ts` and
  `apps/api/src/db/repositories/simbrief.ts`
  - Rename `callbackTokenHash`/`callback_token_hash` to
    `callbackTokenMac`/`callback_token_mac`.
- `apps/api/src/simbrief/legacy-signer.ts`
  - New narrow compatibility signer for the provider-mandated MD5 operation.
  - Holds the credential in a `KeyObject`.
  - Feeds request fields into the digest separately rather than creating one
    immutable concatenated secret string.
  - Zeroizes the temporary exported credential buffer after every signature.
- `apps/api/src/simbrief/adapter.ts`
  - Accepts the compatibility signer rather than an API-key string.
- Related tests, route validation, OpenAPI text, and privacy documentation are
  partially updated.

No validation has run against these uncommitted changes.

## Known incomplete or broken points

1. **OAuth state validation is currently inconsistent.**
   `oauth-service.ts` now emits the versioned state format, and the callback
   route accepts it, but `buildNavigraphAuthorizationUrl` in
   `apps/api/src/navigraph/oauth-adapter.ts` still requires exactly 43
   base64url characters. It will reject the new state before returning an
   authorization URL. Update the adapter and its tests to validate the agreed
   state format or revise the design coherently.

2. **Formatting has not run.**
   `pnpm exec prettier --write ...` aborted before modifying files because pnpm
   attempted a non-interactive modules-directory purge:

   ```text
   ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY
   Aborted removal of modules directory due to no TTY
   ```

   The checked-in workspace currently has a usable local formatter at
   `./node_modules/.bin/prettier`; invoking that binary directly should avoid
   the failed `pnpm exec` resolution path.

3. **Types and tests may still expose stale field names or assumptions.**
   Search all source and test files for:

   ```sh
   rg -n "stateHash|state_hash|callbackTokenHash|callback_token_hash" apps/api
   ```

4. **Use the checked-in migration history.**
   SimBrief/Navigraph is part of the immutable PR29 baseline. Existing
   ledger-less pre-PR14, post-PR14, or PR29 databases must use the guarded
   adoption process in
   `docs/database-migrations.md`; never apply schema changes with production
   `db:push`.

5. **The new legacy signer has not been evaluated by CodeQL.**
   Local tests can prove output compatibility, but only a pushed CodeQL run
   will show whether the credential data flow is accepted. The expected
   compatibility vector remains:

   ```text
   credential: secret
   origin: KORD
   destination: KSFO
   aircraft type: B738
   timestamp: 1700000000
   output page: https://api.example.com/api/v1/simbrief/callback?dispatchId=123
   expected apicode: 8633764465e2af1d7a736ef3b22acbac
   ```

6. **Do not overstate the cryptography.**
   The token handling is strengthened with keyed authenticators. SimBrief's
   legacy digest itself is not made cryptographically strong; it is isolated as
   a required compatibility operation.

## Current worktree inventory

Modified files:

```text
apps/api/src/db/repositories/navigraph-oauth.ts
apps/api/src/db/repositories/simbrief.ts
apps/api/src/db/schema.ts
apps/api/src/docs/openapi.ts
apps/api/src/domain/simbrief/oauth-service.test.ts
apps/api/src/domain/simbrief/oauth-service.ts
apps/api/src/domain/simbrief/service.test.ts
apps/api/src/domain/simbrief/service.ts
apps/api/src/lib/crypto.ts
apps/api/src/routes/simbrief.test.ts
apps/api/src/routes/simbrief.ts
apps/api/src/simbrief/adapter.test.ts
apps/api/src/simbrief/adapter.ts
docs/privacy-compliance.md
```

New files:

```text
apps/api/src/lib/crypto.test.ts
apps/api/src/simbrief/legacy-signer.ts
docs/handover-simbrief-security.md
```

## Recommended continuation sequence

1. Read this handover and inspect the complete diff and repository guidance.
2. Resolve the OAuth state-format mismatch before running tests.
3. Finish stale field/type/test updates and review the crypto APIs for error
   paths and zeroization behavior.
4. Format with the local formatter binary or repair the pnpm installation
   safely without deleting user work.
5. Run focused crypto, OAuth, SimBrief adapter, service, and route tests.
6. Run the full API and repository validation proportional to the change:
   typecheck, tests, coverage, lint, format check, build, and security audit.
7. Review `git diff` and `git diff --check`; ensure no credential or token is
   logged, serialized, or persisted in clear text.
8. Commit and push only after local validation succeeds.
9. Wait for every PR #14 check. Inspect the new CodeQL paths rather than
   relying only on the workflow's green analysis job.
10. Merge PR #14 only when the PR alert gate and all required checks are green.
    If the mandated SimBrief compatibility operation remains blocked, stop and
    report the provider constraint instead of dismissing or suppressing it.

This handover is operational context. Decide explicitly whether it belongs in
the final product commit or should remain outside the merged change.
