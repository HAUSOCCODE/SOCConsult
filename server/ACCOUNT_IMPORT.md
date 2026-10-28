# Confirmed CSV account imports (DEA-05/06/07)

POST `/api/dean/account-imports/validate` accepts exactly one multipart file named
`file`; GET `/api/dean/account-imports/:previewId` recovers its preview. Both require
the existing active Dean session. POST `/api/dean/account-imports/:previewId/confirm`
creates accounts using only the owned server-stored preview; accept no body or `{}`.

Defaults are 1 MiB per upload, 200 accounts per batch, 16 KiB per parsed record, a 30-minute
preview lifetime, and 10 uploads per Dean per 15 minutes. Optional positive integer
overrides `CSV_IMPORT_MAX_BYTES`, `CSV_IMPORT_MAX_ROWS`, `CSV_IMPORT_MAX_RECORD_SIZE`,
`CSV_IMPORT_LIFETIME_MS`, and `CSV_IMPORT_UPLOAD_LIMIT` may lower these defaults.
Invalid or larger overrides fall back to defaults; no new configuration is required.

The five required headers are institutional_id, first_name, last_name,
official_email, and role. middle_name may be omitted; its normalized value is empty.
The six-column downloadable template is unchanged. Recognized columns may be
reordered. IDs remain strings; emails and roles are trimmed and lowercased.
The existing configured Student/Faculty email domains apply.

Rows report their physical start/end lines and data ordinal. Empty and wrong-width
data records are invalid rows, never silently skipped. Unrecoverable quoting or
file structure failures reject the entire upload. All repeated IDs/emails are
marked on every affected row. duplicateRows counts unique rows with any in-file
duplicate or existing-account conflict, including cross-role identifier reuse.

New previews also capture a display filename: strip both path separators and control
characters, limit to 120 characters, and never use it as a filesystem path. No uploaded
bytes are retained. Legacy previews without schema version 2 and filename require reupload.

## Account mapping and password handling

| Field | CSV account value |
| --- | --- |
| email / username | Normalized official email |
| institutionalId | Trimmed, case-sensitive ID preserving leading zeros |
| studentId / employeeId | Same ID in the role's appropriate field |
| Structured names / name | CSV name parts / existing full-name formatter |
| role | student or faculty only; never Dean |
| registrationStatus / accountStatus | Approved / Active |
| accountSource | csv |
| password | bcrypt hash, cost 12, of exact normalized institutional ID |

Approved means immediately eligible, not that CSV provisioning passed through
self-registration approval. No approval actor, timestamp, or method is assigned.
Program and position remain unset; users may supply them in their profiles later.
Public registration is removed. Historical accountSource=self_registration values remain provenance only. Active accounts may sign in with Approved or missing/null registration state; explicit Pending, Rejected, and unknown states are denied without rewriting records.

Reject IDs over 72 UTF-8 bytes because bcrypt truncates longer input. Initial ID
passwords need not meet password-change strength rules. No forced change or email
is added; users may change the password later using existing strength requirements.
Hashing concurrency is two and confirmation batches are capped at 200. Use multiple
files for larger populations.

The approved tradeoff: institutional IDs remain stored/displayed as identifiers and
also function as initial passwords. No plaintext password field is created. Hashes
exist only in memory and User.password. Confirmation success, terminal results, and
batch audits exclude IDs, emails, names, and hashes. Invalidated previews can show
identifiers and safe row errors so the Dean can correct files.

## Explicit deployment migration/preflight

The script never loads `.env` or imports models. Provide MONGODB_URI through the
execution environment, avoiding credentials in shell history. From `server/`:

```text
node scripts/migrate-account-import.mjs
node scripts/migrate-account-import.mjs --apply
node scripts/migrate-account-import.mjs
```

Default inspection is read-only and prints aggregate counts only. First test on a
controlled nonproduction replica set. Apply requires a backup, reviewed inspection,
and a write-maintenance window across all app instances and external writers.
Resolve missing role IDs, invalid types, conflicting IDs within a record, and
duplicate IDs/emails/usernames manually; the script refuses automatic resolution.
Checks cover all three institutional-ID fields and all roles; empty values are counted.
Missing optional Dean IDs are allowed.

Apply backfills only unambiguous canonical IDs with compare-and-set filters and
explicitly creates a unique binary/case-sensitive index on `{ institutionalId: 1 }`,
named `institutionalId_unique_nonempty`, with partial filter
`{ institutionalId: { $type: "string", $gt: "" } }` and simple collation.
The User model intentionally does not declare this index for automatic creation.
Existing unique email/username indexes are verified, not replaced. Apply may stop
midway on infrastructure failure; rerun inspection/apply under maintenance. It is
idempotent and never merges or deletes accounts.

The same script drops the old AccountImport expiresAt TTL, initializes temporary
purgeAt dates, removes completed rows/cleanup dates, and creates purgeAt TTL. Do not
substitute syncIndexes. The old TTL must be absent before confirmation is available.
Confirmation fails closed (503) unless identity/retention indexes, canonical legacy
coverage, and replica-set/sharded topology prerequisites are established. It never
creates indexes or backfills records. Future external writers must preserve canonical
IDs; supported app creation paths populate them.

Identity coverage/indexes and transaction topology are checked by the shared
account-provisioning prerequisite. CSV confirmation additionally checks its own
AccountImport retention indexes. Shared validation, duplicate queries, bcrypt
hashing, and User construction also serve manual provisioning; CSV retains its
bounded hashing concurrency, source `csv`, and existing batch lifecycle.

## Lifecycle, atomicity, and recovery

States: validated, processing, completed, invalidated, failed. Confirmation atomically
claims validated → processing using an attempt token and timestamp. Fresh processing
rejects repeated confirmation (409). An attempt older than five minutes may be reclaimed
by confirmation while the preview is eligible. The token fences old workers. There
is no background job or renewable lease; measure host timeout/CPU behavior before deployment.

Revalidate stored rows before hashing. In withTransaction, fence owner/expiry/state/token
and timeout, recheck institutionalId/studentId/employeeId/email/username conflicts,
validate and save each User with the same session, complete the batch, and record one
safe batch audit in that session. Transaction operations are sequential. Unique indexes
protect races after conflict checks. Any User/batch/audit failure rolls back all writes.
No nontransactional fallback, skip-invalid, or partial-import behavior exists.

Driver retries use fresh User instances and already computed hashes. Duplicate-key
errors are sanitized and rechecked for row feedback. Unknown commit outcomes are read
back before state changes; unresolved uncertainty retains processing for recovery.
GET state before retrying an uncertain response. Completed imports cannot run again.
Known failures record zero successful rows; failure-recording errors retain recoverable
processing. Success is the only batch audit event, and audit failure aborts creation.
Import errors never log raw database/validation exceptions or request bodies.

expiresAt governs eligibility independently of asynchronous TTL. Temporary previews
use purgeAt, normally a day after expiry/failure with a processing timeout buffer.
Completed batches retain owner, filename, UUID, counts, validation summary, status,
and import timestamp, with no purgeAt. They remove normalized rows, row errors,
processing tokens, and failure code. User IDs are neither retained nor returned.

## API and frontend

- 201: created; 200 can recover a verified committed success after uncertainty.
- 404: indistinguishable malformed/missing/unowned/expired preview.
- 409: processing/completed/invalidated/failed/legacy preview or new conflict.
- 422: row-level revalidation failure.
- 503: prerequisite/infrastructure failure.
- 400: invalid or nonempty confirmation body.

Success contains only import ID, status/message, total/successful/failed counts,
Student/Faculty counts, and import timestamp. GET returns retained completed results
even after preview expiry. All endpoints prohibit caching.

Confirmation is enabled only for valid, unexpired, validated previews with canConfirm
and no request processing. The existing dialog explains counts, roles, email login,
ID initial password, optional later change, and password-free results. A synchronous
guard prevents repeat clicks. After an uncertain response, retrieve GET and poll
processing state. Safe results link to User Management and Start New Import. There
is no password export.

## Verification limits and manual nonproduction checks

Automated coverage follows existing mocked HTTP/transaction conventions: session
propagation, rollback paths, claims, conflicts, revalidation, hashing/login, retries,
migration inspection/apply/rerun, filename sanitization, and result/audit/UI secrecy.
Mocks cannot prove real MongoDB transactions, unique-index enforcement, or TTL behavior.

On a controlled nonproduction replica set before deployment:

1. Inspect/apply/rerun migration and verify actual indexes/canonical coverage.
2. Confirm Student/Faculty/mixed batches and log in using email and initial ID.
3. Race same-preview confirmations and separate batches sharing IDs/emails; verify
   one winning batch and zero partial users from losers.
4. Inject insertion/audit failures and verify no users or success audit persist.
5. Verify expiresAt TTL is absent, temporary previews clean up asynchronously, and
   completed summaries remain past preview expiry.
6. Test uncertain commits, network loss, stale-attempt recovery, host request timeout,
   and maximum-size batches; measure bcrypt CPU/time and transaction duration.
7. Check templates, removed-registration rejection, profiles, password changes, booking, management,
   and existing Approved/Active reporting.

Existing process-local upload rate limiting needs operational coordination for
multiple instances; distributed rate limiting is outside DEA-07.
