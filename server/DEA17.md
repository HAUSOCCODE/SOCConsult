# DEA-17 — Preserve audit records and traceability

Audit records are append-only through the application model. New writes validate
action-specific metadata keys and typed values, target references, actor roles,
and bounded state changes. Descriptions are derived from canonical actions.
Legacy documents are not rewritten, validated on read, or deleted. Historical
`admin` actor roles display as Dean without changing storage.

## Coverage

| Workflow | Action | Target | Safe metadata | Commit boundary |
| --- | --- | --- | --- | --- |
| Dean authentication | `login`, `logout`, existing `login_failed` | User; failed anonymous login may have no target | Role | Successful Dean events acknowledged before HTTP success; local logout still clears the session on server failure |
| CSV validation | `accounts_csv_validated` | AccountImport or rejected-input AuditAttempt | Bounded counts, validation outcome, fixed code | Preview and audit in one transaction; rejected input acknowledged separately |
| CSV provisioning | `accounts_imported` | AccountImport | Batch reference, role/row counts, completion state/time | Existing provisioning transaction |
| Manual provisioning | `account_created_manually` | User | Role, manual source | Existing provisioning transaction |
| Account state | `account_activated`, `account_deactivated` | User | Role, account/registration state enums | Existing state transaction |
| Password reset/change | `dean_password_reset`, `password_changed` | User | Role, fixed reset context where applicable | Existing credential transaction |
| Attendance Review | `attendance_review_retained`, `attendance_review_resolved` | Appointment | Review reference and decision enum; bounded status/final outcome changes | Existing review transaction |
| PDF generation | `report_generated` | ReportExport | Report type, total count, generation time | Existing metadata/notification/audit transaction |
| AI narrative | `ai_generation_started`, `ai_generation_attempt`, `report_narrative_generated`, `report_narrative_reviewed` | AuditAttempt or ReportNarrative | Attempt reference, stage, outcome/fixed code; timestamps | Start acknowledged before provider; successful outcome and generated record atomic; review atomic; failure/uncertainty appended outside aborted transaction |
| Consultation state | `appointment_<transition>`, `attendance_open/finalize/review` | Appointment | Transition/source enums and bounded state changes | Existing status/history/reservation/notification transaction |

There is no consultation-note update endpoint. Existing notes display is retained.
Generic multi-subject activity uses one record with subject references rather than
one duplicate per participant. Existing strict workflow writers remain strict.

## Read access and compatibility

Only active Dean accounts can reach audit queries. The management feed at
`GET /api/dean/audit-logs` includes Dean/system events; existing user history and
CSV export routes remain protected and available. All use approved projection
paths and action-specific serialization. Historical descriptions, reasons,
names/topics in metadata, arbitrary changes and unknown action strings are not
returned. Known historical actions and references remain readable.

Audit queries accept only route-specific scalar filters. Pagination is bounded
to 1,000 pages and at most 100 records per page (50 for the user browser). Event
date ranges default to 366 days and cannot exceed 366 days. Older records can be
read using an explicit historical date range. Sort order is timestamp descending,
then ID descending. Existing CSV export is capped at 5,000 records. Responses,
including authorization and audit-specific errors, use `Cache-Control: no-store`.

The existing `/dean/audit-logs` page remains and has a management feed plus the
existing Student/Faculty browser. Its entry is User Accounts → Advanced. There
is no primary sidebar entry.

## Storage and operations

- No TTL, cleanup, historical backfill or data migration is introduced.
- A `{ createdAt: -1, _id: -1 }` index is declared for stable feed sorting.
  Existing indexes are retained. No database index command is run by this task.
- Model guards block saves of persisted documents, query updates/replacements,
  document/query deletion and bulk mutation. Creation and validated insertMany
  remain available; lean insertMany and validation-bypass saves cannot admit
  unvalidated audit payloads.
- Raw database/collection credentials bypass Mongoose protections. Database
  append-only permissions and index deployment require separate operational work.
- A durable AI start without an outcome means unresolved work. If outcome
  recording fails during an outage, a fixed warning is logged and the original
  operation error is retained. Timeouts, transport errors, provider server errors
  and unknown transaction commits are never labelled definite failures. A
  successful generation record describes persisted output, not browser delivery.

## Validation

`test/systemAuditTrail.test.js` exercises storage/privacy boundaries for every
registered action, safe legacy projection/history/export, real model insertion,
mutation guards, filtering/pagination, authorization before query, safe errors,
CSV rollback/retry, acknowledged Dean authentication and AI outcome distinctions.
Existing workflow suites retain transaction and business behavior coverage. The
appointment harness also validates actual audit writes with asynchronous model
validation, including immutable-model hooks.

Use `node scripts/test-isolated.mjs` from `server` for the isolated complete suite;
it supplies test-only configuration and does not load `.env` or connect to the
live database. Client production validation is `npm run build` from `client`.
