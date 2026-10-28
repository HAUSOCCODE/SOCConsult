# DEA-13: School of Computing PDF Reports

The existing Dean-only `/dean/reports` route now generates server-side landscape
A4 consultation PDFs. Its two primary actions are Generate PDF Report and
Generate AI Summary. AI Summary is disabled and explicitly deferred. PDF generation
does not import or call AI services. The obsolete client appointment-list/CSV
contract and registration export UI are removed from this page. Other report and
AI endpoints are unchanged.

## API and scope

`POST /api/dean/reports/pdf` requires an authenticated active Dean. Faculty and
Student requests fail. JSON accepts only `start`, `end`, optional `facultyId`,
`status`, `attendanceOutcome`, and `mode`, each a string. Query parameters are
rejected. Dates are required, strict calendar-valid YYYY-MM-DD, ordered, and at
most 366 inclusive days. The date basis is request `createdAt`, using Asia/Manila
midnight inclusive and following-end-day midnight exclusive, exactly as DEA-11.

DEA-11's deployment boundary remains: the database contains authorized SOC records
only. Optional program/department fields do not establish tenant membership.
Faculty options reuse the bounded monitoring endpoint and include Dean providers.
Canonical CORE-02 statuses and CORE-03 outcomes are accepted as filters; modes
are Online or Face-to-Face. Legacy statuses cannot be selected, but matching
historical records in otherwise unfiltered reports remain clearly labeled Legacy.
Unknown historical statuses receive a neutral Legacy: Unknown label.

An outcome filter requires Completed workflow status and participant_agreement or
dean_review provenance. The shared reporting classifier distinguishes verified
Completed, Student No-show, Faculty No-show, historical unverified Completed,
Attendance Review, and no verified final outcome. Status alone never establishes
attendance; missing responses never establish absence or misconduct.

The bounded aggregation reads at most 1,001 rows, sorted by request date and ID;
more than 1,000 fails with 413. Query/population budgets are ten seconds. Rows and
every authoritative count derive from that same result, without accepting client
totals or independently querying count snapshots. Requests are rate limited to
four per minute per Dean. No PDF bytes are persisted.

## PDF and privacy

PDFKit 0.20.2 embeds bundled Noto Sans Regular under the included SIL OFL 1.1.
The report includes title, School of Computing, request date range, sanitized
filters, generation time, total consultations, status/attendance/mode counts,
record table, repeated table headers, page numbers and administrative footer.
Faculty selection is labeled Selected faculty rather than printing a filter ID.
Table cells contain row number, request date, safe participant display names,
scheduled start/end time, canonical or labeled legacy status, mode and safe
attendance classification. Unscheduled records remain visible. Unsafe historical
names become Unavailable. Empty results produce a valid zero-record report.

Subject, concern, reasons, notes, raw responses, review triggers, emails,
institutional/consultation IDs, actor IDs, meeting details, locations, credentials,
links and document information never enter the report projection or PDF.
Counts are explicitly administrative records, not Faculty rankings or disciplinary
findings. PDFs buffer under an 8 MiB output limit before delivery.

Success returns application/pdf, a server-generated attachment filename,
Cache-Control: no-store and nosniff. X-Report-Total provides the authoritative
total for the client's empty state. Only report response headers expose the
download filename and total to cross-origin clients. Errors are sanitized, with
400 invalid filters/body, 403 forbidden, 413 safety limits and 503 operational
failure. No-store also covers authorization and parser failures. The client
prevents duplicate submissions, shows generating/error/download/empty states,
downloads a Blob and revokes its object URL. It calculates no report totals.

## Immutable metadata and audit

After rendering succeeds, a transaction rereads active Dean identity and inserts
ReportExport plus a strict audit event atomically. Either failure prevents PDF
delivery and rolls back both inserts. Retry callbacks do not render again.
Metadata includes Dean, allowlisted filters, fixed report type, generation time,
date basis/timezone and safe aggregate counts. The selected Faculty ID is retained
only as an explicitly authorized sanitized filter. No consultation identities,
participant names or PDF bytes are stored. The audit records actor, report
reference, report type, timestamp and total; no participant data or free text.
Model middleware blocks application updates, replacements, saves of existing
records, bulk mutations and deletes. Raw database administration remains outside
these application guarantees. Generation metadata does not prove successful client
receipt or that a user saved the download.

## Validation and deployment follow-up

Isolated tests cover canonical/date filters, safe classification/totals, real PDF
Unicode text and pagination, zero results, byte/row limits, authorization,
transaction failure/retry behavior, immutable metadata, parser privacy, UI states,
duplicate clicks and no AI imports/calls. HTTP/model tests stub database operations;
they do not connect to a live database. Replica-set rollback and browser visual/
download checks remain deployment validation. No migrations/processors are run.
Noto Sans does not cover every Unicode script; see the font README for coverage.
