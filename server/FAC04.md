# FAC-04 availability management

Active availability uses half-open intervals; adjacent slots are allowed. Inactive
slots are drafts and may overlap. Activation rechecks active availability and
Pending, Reschedule Proposed, and Confirmed appointment conflicts. Only slots
starting in the future are mutable. Tokens or linked blocking appointments protect
all mutations; historically referenced slots cannot be deleted. Appointments are
never deleted by availability management.

`providerSchedulingLock.js` increments the provider's hidden `schedulingRevision`
inside the same MongoDB transaction as the scheduling write. Missing legacy fields
initialize through `$inc`; no migration or new index is needed. Multiple providers
are deduplicated and locked in sorted ID order. Availability create/update/delete,
published booking, unscheduled request creation, and every appointment transition
(including proposal, acceptance, confirmation/custom assignment, rejection,
cancellation and expiration) participate. Schedule-request approval and Faculty
rescheduling route through that transition service. Attendance changes operate
after the consultation ends and do not assign or release future schedules.
Reservation tokens and unique provider/Student minute holds remain in place.

Booking rereads the slot in its transaction and checks owner, activity, reservation,
future dates and valid mode/details. A changed time requires refreshing; current
mode/details are copied from that transaction's slot. Proposal acceptance rejects
changed published-slot snapshots. Uploads, cleanup and email delivery remain outside
retryable transaction callbacks.

Student discovery/matching contracts remain backend-owned. Private slot meeting
links and internal revisions/tokens are excluded from discovery. Existing authorized
Confirmed appointment link access is retained. `estimatedDurationMinutes` remains
duration/history metadata, never capacity. The legacy Faculty-only
`availabilityCapacity` response key remains an empty array for compatibility.
Obsolete capacity totals and override warnings are removed from both the request
schedule list and the shared appointment view.

The combined Faculty/Dean calendar is opt-in; the shared Student rendering remains
unchanged. It adds Available, Pending request, Confirmed consultation and Inactive
events and suppresses occupied available-slot duplicates. Wider filters/history
refinements remain FAC-09. Form parsing/prefilling explicitly uses Asia/Manila;
stored UTC instants are unchanged.

## Verification boundary

The isolated suite uses mocked models/transactions. Tests force competing operation
orders, verify lock participation and deterministic provider ordering, and cover
reservation/hold rollback and transaction retries. They do not reproduce MongoDB
snapshot isolation, write-conflict retries, commit ambiguity or unique-index behavior
on a real replica set. Real isolated replica-set concurrency verification is deferred.
No live database, migration, processor, dependency installation or deployment is
required or performed for this change.
