# Manual account creation (DEA-08)

POST `/api/dean/users` requires an active authenticated Dean. Accept only string
fields `institutional_id`, `first_name`, `middle_name`, `last_name`, `official_email`,
and `role`. Middle name may be omitted. Student and Faculty are the only allowed
roles. Unknown keys, including passwords, permissions, creator, status, source,
and approval fields, are rejected.

Shared DEA-07 validation trims case-sensitive IDs without losing leading zeros,
normalizes emails/roles, validates names and role-specific configured email domains,
and checks all canonical/legacy ID fields, email, and username. IDs over 72 UTF-8
bytes are rejected. Shared construction hashes the normalized ID once with bcrypt
cost 12, maps canonical and role IDs, composes the full name, and sets Approved/Active.
Manual accounts have source `manual` and `createdBy` from the authenticated Dean.
Schema timestamps are server-generated. Program, position, and approval actor/date
are unset; the existing approvalMethod default remains null.

The same provisioning prerequisite as CSV checks unique identity indexes, canonical
coverage, and replica-set/sharded transaction topology. Manual creation does not
inspect AccountImport or its TTL indexes. Use the existing documented
`migrate-account-import.mjs` maintenance procedure to establish prerequisites;
this endpoint never migrates records or creates indexes.

After validation and hashing, one transaction rechecks conflicts, saves the User,
and writes exactly one strict `account_created_manually` Account audit. The audit
contains only User identity reference, role/source, Dean actor, fixed description,
and schema timestamp. It excludes names, email, institutional ID, request body,
and credentials. Audit failure aborts creation; no nontransactional fallback exists.
Driver retries construct fresh documents and reuse the computed hash.

Responses: 201 success; 400 unexpected fields/types or malformed JSON; 422 field
validation; 409 conflicts; 429 rate limit; 503 prerequisites/infrastructure or
uncertain commit. Oversized JSON returns 413. Success contains only message and
User ID, full name, email, role, accountStatus, accountSource, and createdAt. Errors
are sanitized and field-specific where possible. Raw database/index errors and
request bodies are never logged by this endpoint. Responses prohibit caching
where the route/error handler runs, without changing global middleware ordering.

Missing identity indexes, canonical coverage, or transaction topology return 503
with `PROVISIONING_SETUP_UNAVAILABLE` and a safe provisioning-setup message, before
hashing or transaction writes. Generic infrastructure failures use `SERVICE_UNAVAILABLE`.
An unresolved transaction commit uses `ACCOUNT_CREATION_UNCERTAIN`; only this code
prompts the form to refresh the user list before retrying. No private setup details
are included in these responses.

Ten attempts per authenticated Dean per 15 minutes use the existing process-local
rate-limit architecture. Multiple application processes do not share counters.

User Management opens an accessible responsive form, then requires a separate
confirmation. A synchronous guard prevents repeat clicks, and processing disables
controls. No password/status/source/permission/approval controls exist. Success
clears/closes the form, shows a generic message, and refreshes the list preserving
the selected filter/page where valid. No initial password value appears in results.
Existing login accepts these Active/Approved accounts immediately using official
email and institutional ID. Password change remains optional through the existing
security settings; no password email or forced change is introduced.

After an uncertain response, refresh the list before retrying: the transaction may
have committed. Unique indexes protect duplicate attempts, but this endpoint has
no idempotency/recovery token. Institutional IDs remain stored/displayed account
identifiers and also serve as initial passwords, as in DEA-07.

Automated tests use mocked HTTP/database/transaction operations and exercise UI
handlers. On a controlled nonproduction replica set, still verify actual index
enforcement, concurrent same-ID/email requests, rollback on insertion/audit failure,
immediate login, and uncertain commits. Check keyboard/focus behavior, confirmation,
field feedback, and desktop/mobile layouts in a browser. No live creation is needed
or authorized for repository validation.
