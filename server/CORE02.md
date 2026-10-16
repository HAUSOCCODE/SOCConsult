# CORE-02 appointment workflow foundation

Baseline: `refactor/appointment-status-workflow`, `d0211c0` (local dev baseline).

## Implemented behavior

The canonical statuses are Pending, Reschedule Proposed, Confirmed, Awaiting Attendance Update,
Attendance Review, Completed, Rejected, Cancelled and Expired. Only commands in
`src/config/appointmentStatus.js` are executable. Legacy enum values remain recognized for
compatibility; they are not destinations or sources for normal workflow commands.

All current creation/decision/cancellation/proposal producers call
`appointmentTransitionService.js`. Commands validate the actor and participant ownership,
including a Dean acting as the owning Faculty member. The service fences writes using source
status, `__v`, `updatedAt`, and proposal identity where applicable. Frontend commands also send
the displayed version when available. Older clients can omit a version, but still receive
server-side compare-and-set protection. Proposal responses must send the displayed `proposedAt`.

Every successful command adds one chronological status history entry, one shared participant
audit record, and one notification to the other participant. The shared audit is visible under
both participants through `subjectUsers`; historical audit records and wording remain readable.
System expiration records a System actor without fabricating a user ID. Reasons are bounded,
stripped of markup/control characters, and redact URLs and recognizable credential assignments.
Status history does not copy meeting links, documents, reservation tokens, or consultation bodies.

The appointment, status/schedule history, required audit, notification, availability token and
minute holds commit in one MongoDB transaction. Failure aborts all of those writes. Notifications
are database records; no email transport was added. Uploaded documents are staged outside
transaction retries and cleaned up if the database operation fails.

Published and Faculty-assigned schedules share the existing unique participant/minute holds to
prevent concurrent cross-path booking races. Owned minutes are upserted and retained during
confirmation or overlapping rescheduling; obsolete minutes are removed in the transaction.
This enforces the existing exclusive booking rules, without adding a capacity policy.

Faculty may confirm/reject Pending, propose from Pending/Confirmed, or cancel an eligible
Pending/Reschedule Proposed/Confirmed appointment. Faculty cancellation requires a sanitized,
nonempty reason. Scheduled cancellation requires a future current start time; an unscheduled
Pending schedule request remains cancellable without inventing a date. No Faculty cancellation
interface was added. Direct Faculty completion and its UI controls were removed.

Student rejection of a proposal returns Pending, archives the proposed/current snapshots,
clears proposal fields, preserves the current schedule and reservation, and notifies Faculty.
An elapsed retained schedule is not replaced. A missing/invalid previous schedule is marked
unavailable in schedule history rather than represented by a fabricated snapshot.
Acceptance validates the future proposal, exchanges reservations, and confirms its schedule.
Cancellation during a proposal archives it with response Cancelled before clearing its fields.

`currentScheduleSource` distinguishes an accepted Faculty-assigned schedule from the original
booking method, so later lifecycle states do not incorrectly require a published availability.

## Expiration and attendance boundaries

`processExpiredAvailability()` now selects scheduled Pending appointments with `startAt <= now`.
The reason code is `faculty_response_deadline_passed`. It releases owned reservations and records
the transition atomically. Unscheduled Pending, Reschedule Proposed, Confirmed and attendance
states are excluded. UTC instants are compared; schedule parsing/display and dashboard calendar
boundaries use Asia/Manila.

Reads no longer invoke this processor or rewrite appointment statuses. Document reads also no
longer remove metadata when a remote file is missing. Dean management permits document viewing
but blocks mutation; personal Faculty document routes still require participant ownership.

The supported one-shot invocation, from the server directory, is:

```text
npm run appointments:expire
```

Required environment: `MONGODB_URI`, supplied securely by the deployment environment.
The command reads no `.env` and connects with automatic index creation disabled. MongoDB must
support multi-document transactions (a replica set or compatible sharded deployment); the job
must have permission to update appointments/reservations and create audit/notification records.
The command was tested using isolated models and injected command dependencies, without a live
connection. Only a missing-URI invocation was exercised as a subprocess, which cannot connect.

Each invocation takes one fixed deadline snapshot and sweeps eligible records in ascending
appointment-ID order, using a cursor across batches of 100. Every attempted record advances the
cursor even if blocked. Blocked records remain Pending and are eligible for a later invocation;
they cannot fill the same batch forever or prevent visiting later IDs. A defensive limit of
1,000 batches terminates very large/changing sweeps and reports incomplete work rather than
claiming success. A non-advancing cursor also terminates with an operational error. A full final
batch at the limit conservatively reports incomplete even if it was the last eligible batch.
Newly due records or records changed concurrently behind the cursor are revisited on the next
invocation; neither their status nor their deadline is silently rewritten.

Output is one JSON object containing numeric aggregate counts only:

| Count | Meaning |
| --- | --- |
| attempted | Candidate records visited in this sweep |
| changed | Successfully committed expirations |
| skipped | Explicit compare-and-set conflicts or records removed/transitioned by another worker |
| failed | Blocked/invalid records or per-record processing failures; no raw error is printed |
| errors | Connection/query/cleanup errors or a non-advancing cursor |
| incomplete | 1 when traversal failed or reached its safety limit; otherwise 0 |

`attempted = changed + skipped + failed` for successfully returned batches. A failed query
retains counts from earlier batches and sets errors/incomplete. The command returns exit code
0 only when failed, errors and incomplete are all zero. Concurrent skips alone are successful;
blocked records, missing configuration, connection failures and incomplete sweeps return 1.
An invocation that processes valid records but also encounters blocked records still returns 1.
Driver messages, IDs, participant information and consultation content are never printed.

All effects of one expiration commit together: one status-history entry, one shared audit event,
one Student notification, release of a matching owned token and removal of only that appointment's
minute holds. A token owned by another appointment is preserved. Concurrent invocation is expected
to be safe through transactions and compare-and-set checks, but the mocked tests serialize
transactions and cannot establish actual multi-instance MongoDB behavior. Verify this on an
isolated replica-set staging deployment before production.

### DEPLOY-01 ? Configure the appointment-expiration scheduled job

Automatic scheduling is not yet configured. CORE-02 is complete as the shared code foundation
once validation passes; DEPLOY-01 is a separate follow-up required before production deployment,
not before merging CORE-02. After hosting is selected, configure a managed periodic one-shot job
that invokes `npm run appointments:expire`, injects `MONGODB_URI` securely, sets execution limits,
and monitors exit status and aggregate failure/incomplete counts. Choose the cadence when the
hosting/runtime requirements are known: cadence determines expiration latency after startAt.
Overlapping jobs should be safe, but require the staging concurrency check above. Alert on
nonzero exits, investigate blocked records, and rerun after repair; do not suppress these failures.
No persistent timer, new scheduler dependency, GET-triggered mutation or platform-specific
schedule is included. Availability-expiration notifications formerly triggered by reads have
no replacement availability-notification job in this foundation.

Confirmed-to-attendance and subsequent attendance transitions are documented as deferred rules
but are not executable commands. There is no attendance processor, attendance deadline,
automatic attendance expiration, Dean attendance resolution, or DEA-11 implementation.

## Legacy compatibility and migration

The frontend status utility preserves legacy values with a `(Legacy)` suffix. Student and
Faculty views provide a Legacy filter/tab; Dean filters and the existing overview use the
canonical values plus explicit legacy compatibility. Legacy records have no normal transition
actions. Account, import and task statuses remain separate; account AI reporting accepts
Approved rather than the appointment-only Confirmed value.

Legacy records are not silently mapped in calendars, dashboard categories, or AI workflow
categories. Their total counts may therefore differ from the sum of canonical category counts.
The Dean dashboard total continues to count stored legacy records. Calendars keep their existing
canonical event selection. Historical Completed records retain their historical meaning; this
work does not assert that two-party attendance verified them.

Migration classifications:

| Stored value | Treatment |
| --- | --- |
| Pending | Identity when structurally valid |
| Awaiting Faculty Schedule | Pending only for a proven undecided, unscheduled schedule request |
| Approved | Confirmed only with a coherent valid stored schedule |
| Rescheduled | Confirmed only with a coherent committed schedule; slotless published-origin changes require schedule-history evidence |
| Completed | Identity, with legacy provenance |
| Rejected / Cancelled | Identity, with provenance |
| Needs Reschedule / No Show | Manual review; no automatic mapping |
| Other canonical values | Preserve current workflow |
| Unknown, conflicting, incomplete records | Stop for manual review |

The tooling reads raw records, so removed historical reschedule fields remain available for
inspection. It checks participant existence, duplicate Pending schedule-request mappings and
overlapping confirmed commitments. Pending historical reschedule decisions and inconsistent
history are not guessed. Dry-run output contains counts, never record IDs, participant details,
consultation contents, tokens, or credentials.

**Neither migration mode was executed.** The following commands are future operator instructions,
not a record of execution. Supply an explicitly selected database connection securely outside
this repository. Inspect a restored backup/staging database first.

```text
node server/scripts/migrate-appointment-status.mjs
```

This defaults to dry-run. Before apply, obtain the separately required permission and database
backup, resolve every manual-review/conflict count, pause concurrent writes, and review deployed
indexes. The unique `{ student: 1, faculty: 1 }` partial index must target
`{ bookingMethod: "schedule_request", status: "Pending" }`. An old Awaiting Faculty Schedule
index, a missing required index, or an incompatible partial index blocks apply. The script never
creates/drops indexes; that rollout requires a reviewed operator action after inspecting data.

```text
node server/scripts/migrate-appointment-status.mjs --apply --backup-confirmed
```

Apply repeats preflight inside a transaction and stops before writes if ambiguity/conflicts
exist. It guards each update against concurrent changes. It only changes status, appends a
history entry, and sets `statusMigration` with original status, version `CORE-02-v1`, and migration
time. Raw collection updates preserve appointment IDs, participants, schedules, documents,
`createdAt`, `updatedAt`, `__v` and other fields. Reruns skip the migration version already applied.
There is no startup migration hook. The transaction is all-or-nothing; very large collections
may require a separately reviewed batching design rather than enlarging this script casually.

## Validation and manual checks

`npm test` in `server` runs the complete suite through `scripts/test-isolated.mjs`, which supplies
test-only configuration with generated ephemeral signing/password values. The runner explicitly
selects test/*.test.js so it cannot discover and recursively invoke itself or count helpers as tests.
It resolves paths relative to the repository, has no machine-specific or temporary-directory paths,
and needs no real service credentials. It is an intentional reusable project runner for group
members after cloning, not a temporary verification artifact.

The npm test command uses this runner because a bare node --test import of app.js would otherwise
load the developer's real .env through env.js. The sole environment-loader behavior change is that
NODE_ENV=test skips dotenv loading. Development and production still call dotenv.config() normally;
spy-based tests verify both paths without opening a real .env file. Tests use isolated model/HTTP
harnesses; they do not connect to a database or run either migration command. Coverage includes
the canonical action matrix, role/ownership, Dean management, direct completion rejection,
start-boundary expiration, proposal identity/rejection, reservation preservation/release,
transaction failures/retries, exactly-once events, legacy reads, and migration classification,
dry-run purity, ambiguity refusal, provenance/timestamp preservation and reruns.

Final expiration-runner validation passed: 204 actual server tests across 8 suites, 9 focused
expiration tests, the client production build, syntax checks for 37 changed JavaScript modules,
and git diff --check. The explicit test-file selection excludes the runner and helper modules
previously counted as discovered test files; no functional test was removed for this correction.
This follow-up changes/adds 10 files; the complete CORE-02 working-tree change contains 53 files.
CORE-02 is complete as the shared code foundation. DEPLOY-01 remains required before production.
No migration is authorized by this work: require a verified backup and reviewed dry-run results
before any separately approved apply.
The production build reports the existing large-bundle warning; no bundle redesign is included.

Manual checks still needed on an approved isolated replica-set/staging deployment:

1. Confirm transactions and unique hold indexes exist and support the deployed topology; writes
   deliberately fail closed on deployments that cannot transact.
2. Race published bookings against Faculty-assigned bookings and verify a single winner. Check
   confirmation and partially overlapping reschedule acceptance retain owned minute locks.
3. Exercise Student and Faculty/Dean personal workflows, including stale browser tabs, rejection
   with an elapsed original schedule, and cancellation with a past proposal/future current schedule.
4. Verify legacy labels/filter visibility and absence of unsupported actions, including Dean
   document viewing with management mutations blocked.
5. Invoke the expiration processor on staging data at/before the Manila start boundary, inspect
   history/audit/notification and owned-slot release, and verify rerun safety.
6. After separate migration authorization and backup, inspect staging aggregate dry-run results,
   review index readiness, apply there, compare preserved fields/timestamps, and rerun.

No browser-driven manual checks, real replica-set integration checks, deployment, live database
access, `.env` access, migration execution, commit, push, merge or pull request occurred here.

## Changed files

The manifest below lists every source, test, configuration, script and documentation change.

- `client/src/components/UI.jsx`
- `client/src/components/appointments/AppointmentRequestDetailsModal.jsx`
- `client/src/components/appointments/AppointmentsView.jsx`
- `client/src/components/appointments/FacultyAppointmentDetailsModal.jsx`
- `client/src/components/appointments/FacultyRescheduleModal.jsx`
- `client/src/components/appointments/FacultyScheduleDetailsModal.jsx`
- `client/src/components/appointments/OneTimeScheduleRequests.jsx`
- `client/src/components/appointments/StudentAppointmentDetailsModal.jsx`
- `client/src/components/appointments/StudentConsultationsView.jsx`
- `client/src/components/appointments/StudentRescheduleResponseModal.jsx`
- `client/src/components/calendar/ConsultationCalendar.jsx`
- `client/src/components/dean/DeanRecordsList.jsx`
- `client/src/pages/Dean/ConsultationOverview.jsx`
- `client/src/pages/Faculty/AppointmentRequests.jsx`
- `client/src/utils/appointmentStatus.js`
- `server/CORE02.md`
- `server/package.json`
- `server/scripts/migrate-appointment-status.mjs`
- `server/scripts/process-appointment-expiration.mjs`
- `server/scripts/test-isolated.mjs`
- `server/src/config/appointmentStatus.js`
- `server/src/config/env.js`
- `server/src/controllers/auditController.js`
- `server/src/controllers/availabilityController.js`
- `server/src/controllers/facultyAppointmentController.js`
- `server/src/middleware/errorHandler.js`
- `server/src/models/Appointment.js`
- `server/src/models/AuditLog.js`
- `server/src/routes/appointmentRoutes.js`
- `server/src/routes/dashboardRoutes.js`
- `server/src/routes/deanRoutes.js`
- `server/src/routes/scheduleRequestRoutes.js`
- `server/src/services/aiReportingService.js`
- `server/src/services/appointmentClassificationService.js`
- `server/src/services/appointmentDocumentService.js`
- `server/src/services/appointmentHistoryService.js`
- `server/src/services/appointmentStatusMigrationService.js`
- `server/src/services/appointmentTransitionService.js`
- `server/src/services/availabilityExpirationService.js`
- `server/test/appointmentCompatibility.test.js`
- `server/test/appointmentExpiration.test.js`
- `server/test/appointmentStatusMigration.test.js`
- `server/test/appointmentTransitions.test.js`
- `server/test/deanDashboard.test.js`
- `server/test/deanRole.test.js`
- `server/test/facultyInitiatedReschedule.test.js`
- `server/test/helpers/appointmentHarness.js`
- `server/test/helpers/appointmentHttp.js`
- `server/test/scheduleRequestRoutes.test.js`
- `server/test/studentCancellation.test.js`
- `server/test/studentConsultationRequest.test.js`
- `server/test/studentMyConsultations.test.js`
- `server/test/studentRescheduleResponse.test.js`

## Final working-tree status

```text
 M client/src/components/UI.jsx
 M client/src/components/appointments/AppointmentRequestDetailsModal.jsx
 M client/src/components/appointments/AppointmentsView.jsx
 M client/src/components/appointments/FacultyAppointmentDetailsModal.jsx
 M client/src/components/appointments/FacultyRescheduleModal.jsx
 M client/src/components/appointments/FacultyScheduleDetailsModal.jsx
 M client/src/components/appointments/OneTimeScheduleRequests.jsx
 M client/src/components/appointments/StudentAppointmentDetailsModal.jsx
 M client/src/components/appointments/StudentConsultationsView.jsx
 M client/src/components/appointments/StudentRescheduleResponseModal.jsx
 M client/src/components/calendar/ConsultationCalendar.jsx
 M client/src/components/dean/DeanRecordsList.jsx
 M client/src/pages/Dean/ConsultationOverview.jsx
 M client/src/pages/Faculty/AppointmentRequests.jsx
 M client/src/utils/appointmentStatus.js
 M server/package.json
 M server/src/config/env.js
 M server/src/controllers/auditController.js
 M server/src/controllers/availabilityController.js
 M server/src/controllers/facultyAppointmentController.js
 M server/src/middleware/errorHandler.js
 M server/src/models/Appointment.js
 M server/src/models/AuditLog.js
 M server/src/routes/appointmentRoutes.js
 M server/src/routes/dashboardRoutes.js
 M server/src/routes/deanRoutes.js
 M server/src/routes/scheduleRequestRoutes.js
 M server/src/services/aiReportingService.js
 M server/src/services/appointmentClassificationService.js
 M server/src/services/availabilityExpirationService.js
 M server/test/deanDashboard.test.js
 M server/test/deanRole.test.js
 M server/test/facultyInitiatedReschedule.test.js
 M server/test/scheduleRequestRoutes.test.js
 M server/test/studentCancellation.test.js
 M server/test/studentConsultationRequest.test.js
 M server/test/studentMyConsultations.test.js
 M server/test/studentRescheduleResponse.test.js
?? server/CORE02.md
?? server/scripts/migrate-appointment-status.mjs
?? server/scripts/process-appointment-expiration.mjs
?? server/scripts/test-isolated.mjs
?? server/src/config/appointmentStatus.js
?? server/src/services/appointmentDocumentService.js
?? server/src/services/appointmentHistoryService.js
?? server/src/services/appointmentStatusMigrationService.js
?? server/src/services/appointmentTransitionService.js
?? server/test/appointmentCompatibility.test.js
?? server/test/appointmentExpiration.test.js
?? server/test/appointmentStatusMigration.test.js
?? server/test/appointmentTransitions.test.js
?? server/test/helpers/
```
