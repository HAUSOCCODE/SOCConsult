# CSV validation previews (DEA-06)

POST `/api/dean/account-imports/validate` accepts exactly one multipart file named
`file`; GET `/api/dean/account-imports/:previewId` recovers its preview. Both require
the existing active Dean session. There is no account creation endpoint.

Defaults are 1 MiB per upload, 1,000 data rows, 16 KiB per parsed record, a 30-minute
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

Previews store only normalized results, sanitized errors, owner, UUID, summary,
schema version, and creation/expiry timestamps. No uploaded file is retained.
MongoDB TTL cleanup is asynchronous; retrieval independently filters by owner
and expiry. A valid result returns canConfirm=true, but the UI confirmation
control remains disabled until DEA-07. API responses prohibit caching.

DEA-07 must revalidate conflicts immediately before writes: previews reserve
neither identifiers nor emails. User identifier fields currently lack unique
indexes; DEA-06 intentionally does not change them. TTL index deployment and
multi-instance rate-limit coordination require operational verification.
