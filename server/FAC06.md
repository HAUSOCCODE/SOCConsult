# FAC-06 Faculty request decisions

Fresh personal request details expose Confirm, Reject, and Propose Schedule for Pending requests. Confirm requires a second explicit action; Reject requires a reason; proposals use a review/send step, Asia/Manila inputs, and support unscheduled legacy records. Updated forms require the loaded integer version, block synchronous duplicate submissions, hide unsafe server errors, and refresh after conflicts. Legacy backend callers may still omit a version.

All decisions reuse the canonical transition service and assigned Faculty ownership, including Dean personal workspace. Rejection and proposal reasons are sanitized and bounded to 500 characters. Reasons remain in authorized appointment/history fields; DEA-17 audit metadata contains only the approved source and status changes.

Confirmation preserves an owned availability token and upserts existing owned minute holds. Proposing preserves the current schedule and original reservation and creates no proposed-slot hold. Acceptance rechecks both participants' conflicts and published-slot details before exchanging reservations atomically. Student decline returns Pending, archives the rejected proposal, clears proposal fields, and retains the original schedule/reservation. Reject is terminal and releases only matching owned tokens and appointment-owned holds.

Appointment changes, history, reservations, audit, and in-app notifications commit together under the existing provider scheduling locks and CAS fence. Transition notification keys include the resulting appointment version, allowing separate proposal/decline cycles while transaction retries retain one committed event. Non-transition notification producers keep their existing keys. Email remains best-effort after commit, outside retry callbacks; failure does not reverse the decision. Existing calendar and Student Confirmed-only ICS routes remain authoritative.

## Integration limitations retained intentionally

- Proposed schedules are not held and may become unavailable before acceptance.
- Proposals do not automatically expire. The existing expiration processor handles scheduled Pending requests only; no processor or migration was added or executed.
- Decline preserves even an elapsed original schedule and reservation. Minute holds have the existing end-time TTL, while an original availability token can remain until an existing release transition occurs.
- Email is not a durable outbox: a process exit after commit can lose delivery. No new delivery/retry infrastructure is introduced.
- Tests use isolated model/HTTP harnesses with mocked SMTP, not a real MongoDB replica set or external delivery.
