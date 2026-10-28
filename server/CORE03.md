# CORE-03: Two-party attendance foundation

Policy `CORE-03-v1` opens at the confirmed `endAt` and closes exactly 48 hours
later. UTC instants authorize writes; all user-facing schedule displays use
Asia/Manila. Submission is allowed at the opening instant and rejected at the
deadline instant. Silence never establishes attendance, absence, admission, or misconduct.

## Storage and decisions

`AttendanceResponse` is an immutable, separately stored record containing the
appointment, authenticated participant, derived student/faculty slot, outcome,
optional sanitized reason (string, at most 500 input characters), server timestamp,
and policy version. Both roles may select Completed, Student No-show, or Faculty
No-show. Unique indexes enforce `(appointment, participant)` and
`(appointment, participantRole)`. Application write/delete operations are blocked;
there are no edit, replacement, or delete endpoints. Raw database administration
is outside application immutability guarantees.

Matching responses finalize the appointment as Completed with their agreed
outcome. Different responses enter Attendance Review with no final outcome.
At the deadline, missing Student, Faculty, or both responses enter Attendance
Review with the corresponding missing-role category. No attendance path expires
an appointment. DEA-12 resolution and disciplinary decisions are not implemented.

Appointment stores only policy/timing, response flags, finalization and review
summary. It is excluded from ordinary model selection. Participant status
commands still cannot select Completed or attendance destinations. All attendance
status transitions are System events through the attendance service.

## APIs and privacy

- `GET /api/appointments/:id/attendance`: authenticated owner-only read; no writes.
- `POST /api/appointments/:id/attendance-responses`: accepts only `outcome` and
  optional `reason`; derives participant identity and role. A Dean must own the
  appointment's Faculty slot. Dean management routes remain read-only.

Both endpoints use no-store caching and explicit response fields. Before submitting,
participants see eligibility and timing, with no counterpart presence, outcome,
reason, or timestamp. Afterwards they see their immutable response and a neutral
waiting state. Both outcomes become visible after both submit; counterpart reasons
never appear. Reasons are not copied into status history, ordinary audit metadata,
notifications, AI data, or monitoring. Submission audit events remain stored but
are excluded from general activity lists, exports, and last-activity calculations
to prevent a Dean-as-Faculty from learning counterpart submission presence.

Dean Monitoring receives final outcome, provenance, policy/timing, review category,
and missing roles after review begins. No raw responses or reasons are returned.
There is no Dean resolution endpoint or participant response form in CORE-03.

## Transactions and processors

Each write uses a MongoDB transaction covering response insertion, guarded
Appointment version update, summary, status history, audit and required in-system
notifications. Every submission writes the shared appointment to serialize
concurrent decisions. Retry callbacks reread state. Only one finalization commits.
Failed required events roll back all writes. Future email delivery must occur
after commit and must not reverse committed attendance.

Opening notifies both participants independently. Finalization notifies both of
the allowed outcome; review notifications neutrally request authorized review.
Dean-as-Faculty notifications link to the personal Faculty workspace.

`appointments:attendance` is a one-shot, bounded processor command. It opens
enrolled ended Confirmed consultations and processes elapsed attendance deadlines.
One fixed time snapshot, increasing ID cursors, version guards and transactions
support retries and concurrent workers. Overdue Confirmed records can open and
enter review in the same transaction. Invalid policy/schedule records are skipped
without rewriting history and require operator investigation. Output is numeric
aggregate counts only; errors or incomplete sweeps return nonzero. The command
does not load .env. No processor executes from GET, startup, or setInterval.

The submission transaction can open an ended Confirmed record before the job has
visited it, producing the same System history, audit and opening notifications.
After the deadline, submission is rejected; the explicit processor performs review.

## Prospective rollout and deployment prerequisites

New confirmations and valid accepted reschedules receive policy metadata. A valid
reschedule before opening recomputes both instants and preserves schedule history.
Ordinary rescheduling is blocked after opening or any recorded response.
Existing Confirmed backlog, Completed, legacy No Show, and attendance states lacking
metadata are never automatically enrolled or rewritten. Historical enrollment needs
a separately approved procedure. Completed without authoritative provenance is
unverified; No Show does not identify who was absent. No destructive migration is needed.

Before enabling attendance in staging/production:

1. Use a transaction-capable MongoDB replica set and controlled deployment credentials.
2. Deploy the AttendanceResponse collection and both required **non-sparse,
   non-partial unique indexes**, plus Appointment processor indexes defined by the
   schemas. If autoIndex is disabled, explicitly create and inspect these indexes
   through the controlled deployment process. No request creates indexes. Attendance
   writes fail closed if the required unique indexes cannot be verified.
3. On an **isolated replica set**, verify real index creation, duplicate-key rejection,
   simultaneous distinct/same-party submissions, competing workers, transaction retry,
   rollback on required event failure, and exactly one finalization. Mock tests are
   not proof of database uniqueness or real isolation behavior.
4. Review historical exceptions separately. Do not backfill deadlines without approval.
5. As a later deployment action, externally schedule **both** `appointments:expire`
   and `appointments:attendance` (suggested five-minute interval), monitor aggregate
   failures/incomplete runs, and verify retries. No external scheduler is configured here.

## Reporting and validation

Attendance summary categories are verifiedCompleted, studentNoShow, facultyNoShow,
historicalUnverifiedCompleted and attendanceReview. Completed status counts remain
workflow-finalization counts; only outcome Completed with participant-agreement
provenance counts as verified successful attendance. Faculty completion metrics
and consultation narrative inputs use that verified filter. Dashboard/AI summaries
include the separate aggregate categories and never read raw attendance reasons.

The isolated suite covers all nine outcome pairs, end/deadline boundaries,
ownership including Dean personal versus management, input impersonation, duplicate
and concurrent submissions, rollback/retry, private reads, immutability/index
definitions, prospective rescheduling, historical exclusion, processors, command
output, direct-completion blocking, and reporting classification.

Manual follow-up: isolated replica-set checks above; visual review of dashboard
categories, Faculty Awaiting Update discovery, Dean Monitoring summaries and Manila
timestamps; later Student/Faculty submission UI and DEA-12 review/resolution.

The existing ReportsAnalytics page still uses the legacy `/dean/appointments`
list contract, which DEA-11 replaced with paginated `/dean/consultations`.
CORE-03 corrects its attendance classification and labels; repairing that report
loader/export contract remains a separate reporting task. The authoritative
attendance aggregation service and current dashboard/monitoring APIs are available.

Implementation validation: 234 isolated server tests passed; client production
build passed (Vite reports a large-bundle warning); syntax checks passed for all
28 changed JavaScript/module files; `git diff --check` passed. No live database,
operational processor, migration, or external scheduler was used.

## Implementation files

Added:

```text
client/src/components/appointments/AttendanceSummary.jsx
server/CORE03.md
server/scripts/process-appointment-attendance.mjs
server/src/config/attendance.js
server/src/models/AttendanceResponse.js
server/src/routes/attendanceRoutes.js
server/src/services/attendancePrivacyService.js
server/src/services/attendanceProcessingService.js
server/src/services/attendanceReportingService.js
server/src/services/attendanceService.js
server/test/attendance.test.js
```

Modified:

```text
client/src/components/appointments/AppointmentsView.jsx
client/src/components/appointments/FacultyAppointmentDetailsModal.jsx
client/src/components/appointments/StudentAppointmentDetailsModal.jsx
client/src/components/dashboard/DashboardOverview.jsx
client/src/components/dashboard/StudentDashboardContent.jsx
client/src/components/dean/ConsultationDetailsDialog.jsx
client/src/pages/Dean/ConsultationMonitoring.jsx
client/src/pages/Dean/DeanDashboard.jsx
client/src/pages/Dean/ReportsAnalytics.jsx
server/package.json
server/src/app.js
server/src/config/appointmentStatus.js
server/src/controllers/auditController.js
server/src/middleware/errorHandler.js
server/src/models/Appointment.js
server/src/routes/appointmentRoutes.js
server/src/routes/dashboardRoutes.js
server/src/services/aiReportingService.js
server/src/services/appointmentTransitionService.js
server/src/services/consultationSummaryService.js
server/src/services/deanConsultationService.js
server/src/services/deanDashboardService.js
server/src/services/groqService.js
server/src/services/roleAiDataService.js
server/src/services/roleAiService.js
server/test/deanDashboard.test.js
server/test/helpers/appointmentHarness.js
server/test/helpers/appointmentHttp.js
server/test/studentDashboard.test.js
```
