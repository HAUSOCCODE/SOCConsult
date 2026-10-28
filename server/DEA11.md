# DEA-11: School of Computing Consultation Monitoring

The authenticated Dean Management page is `/dean/consultations`. It is read-only.
The deployment/database is assumed to contain only authorized School of Computing
records, as in DEA-04. Optional program/department fields do not establish school
membership. Multi-school/tenant isolation requires an authoritative scope field and
is outside this change.

## API

All monitoring routes require an active authenticated Dean and return
`Cache-Control: no-store`, including authorization failures. Non-GET/HEAD methods
under the monitoring and legacy management appointment resources return 403.

- `GET /api/dean/consultations`
- `GET /api/dean/consultations/filter-options?role=student|faculty&search=...&limit=20`
- `GET /api/dean/consultations/:consultationId`
- `GET /api/dean/consultations/:consultationId/documents/:documentId`
- `GET /api/dean/consultations/:consultationId/document` (singular legacy attachment)

Legacy GET `/api/dean/appointments` uses the same safe, paginated list contract.
Legacy management document GET routes use the same protected binary response.
These are compatibility handlers, not HTTP redirects; old list JSON and document
JSON shapes are intentionally replaced. Mutation requests are never redirected.

List parameters are `search`, `start`, `end`, `facultyId`, `studentId`, `status`,
`mode`, `page`, `limit`, and `sort`. Unknown parameters, arrays/objects, invalid
values, and any supplied `attendanceOutcome` are rejected with 400. Pagination
defaults to page 1 and 20 records (maximum 100). Page is bounded at 1,000,000.
`sort=newest` (default) orders by `createdAt` descending, then `_id` descending;
`oldest` reverses both. An out-of-range page returns an empty page with metadata.
All-time queries remain paginated in MongoDB. Queries have a ten-second budget.

Search uses literal escaped subject/course and participant-name matching in
MongoDB. A complete 24-hex Record ID also matches exactly; partial IDs are not
matched against `_id`. IDs are authenticated operational references, not public
appointment numbers. No cryptographic reference or new persisted identifier exists.
Participant lookups return only filter ID, name, role and `hasMore`, at most 50
options (default 20). Searchable options include inactive/historical participants
with referenced consultations. Faculty options include Dean providers.

## Dates and attendance

The UI labels the date range “Request date — Asia/Manila”. Its basis is `createdAt`,
not a scheduled/proposed time. There is no default date restriction. Both strict
calendar-valid `YYYY-MM-DD` endpoints are required when filtering. Start is Manila
midnight inclusive; end is the following Manila midnight exclusive. The maximum
is 366 inclusive days. Partial, malformed, reversed and excessive ranges fail.
Unscheduled Pending requests remain discoverable by their request creation date.

No authoritative attendance outcomes or response records exist in this foundation.
The attendance filter is disabled with an explanation. Nothing infers attendance
from Completed, No Show, elapsed schedules, notes or any other status. Canonical
Attendance Review records link to the existing separate placeholder workflow.
No attendance fields/model, inference, submission or resolution is added.

## Response safety

List/detail records are explicitly projected and serialized using allowlists.
The list includes Record ID, participant display names, subject/course, current
schedule, mode, exact status and Legacy marker, and creation/update timestamps.
Details additionally include concern, booking method, available schedule snapshots,
safe physical location, chronological allowlisted history, and document metadata.
Missing original schedule snapshots are labeled “Unavailable”; mutable availability
is never used to reconstruct them. History omits actor IDs, migration versions and
audit identifiers, redacts recognizable secrets/URLs from reasons, and labels
system and legacy migration entries. Faculty notes are excluded.

Neither response exposes emails, institutional IDs, private availability, passwords,
meeting links, document bodies/storage URLs, reservation/lock tokens or raw audit
metadata. Participant and document IDs are returned only where needed for filters
and protected document access. Record IDs are not newly added to dashboard summaries.

## Documents

Shared authorization preserves Student/assigned-Faculty ownership and Dean personal
Faculty ownership. Management read access requires the Dean role. IDs are validated
before database access, appointment membership is checked, and legacy document
records must also reference the selected appointment.

Monitoring content is returned through the authenticated server endpoint. Database
attachments are decoded only after authorization. Remote files use the configured
Cloudinary SDK's signed, 60-second download API with validated stored public ID and
resource type, `type=upload` matching the existing uploader. The server does not
fetch stored URLs or request-supplied URLs and refuses redirects. Signed URLs and
credentials never reach the browser. Downloads are capped at 10 MiB with a
15-second provider timeout. Missing/invalid metadata or provider errors fail closed.
No read removes stale metadata or otherwise writes to the database.

Content has attachment disposition, sanitized filename, an allowlisted MIME type,
`nosniff`, a sandbox CSP and `no-store`. Unknown/unsafe MIME types are octet-stream.
The dedicated component previews safe image/text/PDF blobs and offers a download;
PDF previews are sandboxed. Blob URLs are revoked on replacement/unmount. Some
browsers may block sandboxed PDF previews; the authorized download remains usable.

Existing provider assets were uploaded using public `upload` delivery. This task
does not change their underlying provider ACLs, invalidate previously exposed URLs,
or change Student/Faculty delivery contracts. Moving existing assets to private
storage would require a separate coordinated storage migration. Old files lacking
validated provider identifiers cannot be served through monitoring until repaired.

Provider reference: https://cloudinary.com/documentation/control_access_to_media
and https://cloudinary.com/documentation/image_upload_api_reference#private_download_url

## Frontend and compatibility

One sidebar entry is labeled Consultation Monitoring. The dashboard already links
to this route. Old `/dean/appointments` and `/dean/consultation-overview` redirect
with replacement history, preserving only validated monitoring parameters and
dropping unknown/unsafe query values and fragments. Existing `/admin/*` frontend
compatibility remains. Personal Faculty pages remain under `/dean/faculty/*` and
use ownership-scoped existing participant APIs.

The page has loading, error/retry, empty/no-match states, reset, server pagination,
responsive filters and a horizontally scrollable table. Applying filters resets
page 1. Browser back/forward restores query filters. Fetch cancellation and response
guards prevent stale list/detail/option/document responses from replacing current
state. The native modal dialog supplies modal focus containment and Escape behavior.

## Validation and remaining manual checks

New isolated tests cover query/date validation, API authorization, bounded database
query pipelines, safe serializers/history, exact ID search, disabled attendance,
document relationship substitution, controlled provider delivery, content headers,
no-write contracts, redirects, loading/error/retry/reset and stale UI responses.
The existing CORE-02/Dean/DEA-04 suite remains the regression baseline.

Tests inject models and provider responses; they do not connect to MongoDB or
Cloudinary. Verify real aggregation performance and signed remote delivery in a
separately authorized staging environment. Check responsive layout, keyboard focus,
PDF behavior and real document downloads in a browser before release. No live
database/service or browser checks are claimed by automated isolated tests.

No transition rules, attendance workflow, AI/reporting, scheduler, migration command,
expiration command or deployment configuration is changed.

## File inventory

Added (10):

- `client/src/pages/Dean/ConsultationMonitoring.jsx`
- `client/src/components/dean/ConsultationDetailsDialog.jsx`
- `client/src/components/dean/ConsultationDocumentViewer.jsx`
- `server/src/controllers/deanConsultationController.js`
- `server/src/services/deanConsultationService.js`
- `server/src/services/appointmentDocumentAuthorizationService.js`
- `server/test/deanConsultationMonitoring.test.js`
- `server/test/deanConsultationDocuments.test.js`
- `server/test/deanConsultationMonitoringUi.test.js`
- `server/DEA11.md`

Modified (9):

- `client/src/App.jsx`
- `client/src/layouts/DeanLayout.jsx`
- `client/src/components/RouteDocumentTitle.jsx`
- `client/src/utils/deanWorkspace.js` (shared validated compatibility-query helper)
- `server/src/controllers/deanController.js`
- `server/src/routes/deanRoutes.js`
- `server/src/routes/appointmentRoutes.js`
- `server/test/deanLayout.test.js`
- `server/test/deanRole.test.js`

Removed (3):

- `client/src/pages/Dean/ConsultationOverview.jsx`
- `client/src/pages/Dean/AppointmentsManagement.jsx`
- `client/src/components/dean/DeanRecordsList.jsx`

No renamed files. The shared helper in the existing `deanWorkspace.js` is the only
additional modified file beyond the Phase 1 proposal; it is exercised directly by
redirect tests instead of duplicating query validation inside the route component.

Validation: the complete isolated server suite passes (213 tests, 8 suites), and the
production client build passes (with Vite's chunk-size warning). Build invocation
uses Vite's programmatic `build({ envDir: false })`, preserving the production build
while preventing `.env` reads. JavaScript syntax checks and `git diff --check` pass.
No temporary validation/configuration files were created. Final changes remain
uncommitted on `feature/dean-consultation-monitoring`.

Recommended next task: the attendance foundation with authoritative response/outcome
records, followed by the separate Dean Attendance Review workflow. Before deployment,
perform the staging/browser checks above and assess query indexes against real data
volume without changing this task's authorization assumptions.
