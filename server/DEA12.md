# DEA-12: Dean Attendance Review

The active authenticated Dean management workspace provides an unresolved-only
queue at `/dean/attendance-review`. Direct detail links at
`/dean/attendance-review/:reviewId` also retain access to resolved Dean reviews.
Consultation Monitoring links to these details and remains read-only. Personal
Faculty pages and participant APIs gain no management review capability.

## Data and transitions

`AttendanceResponse` remains authoritative and unchanged. `AttendanceReview`
stores append-only actions with appointment, Dean, action, private sanitized reason,
server timestamp, previous/resulting status, final outcome, reviewed version and
nullable references to the original Student/Faculty responses. No mutable response
copies are stored. Application model updates, replacements and deletes are blocked;
raw database administration is outside these guarantees.

`confirm_completed`, `confirm_student_no_show` and `confirm_faculty_no_show` move
`Attendance Review` to `Completed`, with the respective canonical outcome
`Completed`, `Student No-show` or `Faculty No-show`. Summary provenance is
`dean_review`; original review triggers, timing and response flags remain intact.
The shared reporting classifier and verified-completion filter recognize this
provenance. The unrelated ReportsAnalytics loader/export contract remains unchanged.

`leave_under_review` records an action and audit event, increments appointment
version and retains the unresolved status/outcome. It creates neither a fabricated
status transition nor participant notifications. Multiple such actions are allowed.
Final decisions cannot be repeated or replaced.

Every action requires a reason, nonempty after the existing markup/control/link/
credential sanitization, with a 500-character input limit. Reasons are stored only
in the protected review action. Final status history uses neutral generic wording.

## API

All endpoints require an active authenticated Dean and set `Cache-Control: no-store`,
including authorization failures:

- `GET /api/dean/attendance-review`
- `GET /api/dean/attendance-review/filter-options`
- `GET /api/dean/attendance-review/:id`
- `POST /api/dean/attendance-review/:id/actions`

Queue filters are `start`, `end`, `studentId`, `facultyId`, `reviewReason`, `page`,
`limit` and `sort`. Unknown, duplicated/non-string or invalid inputs fail with 400.
Date ranges use the date placed under review in Asia/Manila, inclusive start and
exclusive following-day end; both dates are required, maximum 366 inclusive days.
Pagination defaults to 20, maximum 100; sorting uses review date and ID. Database
reads have a ten-second query budget. Participant options reuse bounded monitoring
search and may include historical participants outside the current queue.

POST accepts only `{ action, reason, expectedVersion }`. The version is mandatory
and must be a nonnegative safe integer. Successful writes return 201 with review
ID, resulting status/outcome, version and state. Stale/resolved records return 409.
Invalid references return 400; unavailable cases return 404; operational failures
return a generic 503 without provider/database details.

## Transactions and privacy

The service rereads active Dean identity, appointment status/version and authoritative
responses inside every transaction retry. A shared appointment compare-and-set on
status, version and updatedAt serializes all actions. Review insertion, summary,
final status/history, audit and required notifications commit atomically. Required
event failures propagate and roll everything back. No external transport runs from
the retry callback. Unique final-review conflicts become 409.

Both participants receive neutral in-system notifications only for final decisions,
stating that the attendance record was reviewed and the recorded outcome. Dean
providers receive the personal Faculty destination. Private reasons never appear
in notifications, ordinary monitoring or audit metadata. Generic consultation notes
are omitted. Detail reads check the appointment version again before returning to
avoid combining data across concurrent actions.

Documents reuse existing authorized metadata projections and authenticated binary
delivery, with relationship checks and no storage URLs. Existing single-school
database scope and provider ACL limitations from DEA-11 still apply. No AI service
is imported or invoked by this workflow.

## Deployment and manual validation

Before enabling writes, the controlled deployment process must create and inspect
the AttendanceReview unique `{ appointment: 1 }` index with partial filter
`{ isFinal: true }`, plus its history index and the Appointment queue index. Requests
verify the required final index and fail closed if it is missing or unsuitable;
they never create indexes. No migration or operational processor is part of DEA-12.

Use a transaction-capable MongoDB replica set. Isolated model/HTTP/UI tests exercise
rollback, retry and competing calls but cannot prove real MongoDB isolation/index
behavior. Separately authorize isolated replica-set tests of simultaneous writes,
duplicate finals, transaction retries and audit/notification rollback. Manually
check desktop/mobile layout, keyboard/focus/Escape behavior of nested confirmation,
resolved detail links, Manila dates, document previews/downloads and participant
notification destinations before deployment.
