# DEA-14: Dean Reports AI-assisted narrative

AI is available only in the optional panel on `/dean/reports`. General Public,
Student, Faculty and Dean chat APIs and floating widgets have been removed.

## Authoritative data boundary

`deanReportDataService` supplies the exact DEA-13 filter parser, bounded query and
count calculation for both PDF and narrative generation. Dates remain request
`createdAt` in Asia/Manila, at most 366 inclusive days and 1,000 records. Attendance
uses the existing trusted provenance classifier; workflow completion does not
prove attendance. The authorized SOC database deployment boundary is unchanged.

The browser submits only report filters: start, end, optional facultyId, status,
attendanceOutcome and mode. Unknown fields and query parameters are rejected.
The AI query never populates participant identities. Groq receives only selected
date range, total consultations, status counts, attendance-outcome counts and
consultation-mode counts. Faculty selection IDs remain internal filter metadata;
they never enter the provider payload. No rows, identities, concerns, participant
reasons, documents, links, credentials, prompts or chat history are persisted.
The fixed system prompt exists in source only, not in stored records.

Only `reportNarrativeAdapter` imports `groq-sdk`; `groqModel` retains existing model
configuration. There are no tools, function calls or arbitrary user instructions.
Provider requests use zero retries, a 25-second timeout and 650-token limit.
Empty, truncated, tool-call, oversized and unsafe text responses are rejected.
Output is limited to 3,000 characters and displayed as React plain text.

## API and immutable review workflow

- `POST /api/dean/reports/ai-summaries`: generate a new unreviewed snapshot.
- `GET /api/dean/reports/ai-summaries/:id`: read a snapshot and its review state.
- `POST /api/dean/reports/ai-summaries/:id/review`: explicitly approve with
  `{ "expectedVersion": 1 }`. A successful review returns version 2.

All endpoints require an active Dean. Generation and review recheck active Dean
identity inside their persistence transaction. Rate limits per Dean per minute
are generation 4, reads 30, reviews 8, independent of PDF generation. Narrative
request bodies are limited to 2 KiB. Parser, authorization and service responses
are no-store and errors are sanitized without logging rejected input/provider text.

ReportNarrative stores immutable allowlisted filters, aggregate snapshot,
narrative, generating Dean, timestamp, prompt/schema version, date basis,
timezone and initial unreviewed state. ReportNarrativeReview stores an append-only
approval, reviewing Dean, timestamp and expected/result versions. Its unique
summary index prevents concurrent/repeated approvals; duplicate inserts return
409. Effective state is derived from the review record. Regeneration always
inserts a new summary. No narrative editing or deletion API exists. Model hooks
block application updates, replacements, existing-record saves, bulk mutations
and deletes. Direct database administration is outside these guarantees.

Summary/review persistence and its audit event commit atomically. Audit metadata
contains only a fixed action, Dean actor, summary reference and timestamp; no
narrative or private/free-text input. Failures do not produce a successful record.
Groq generation happens outside the transaction and is not repeated on a
transaction retry. AI has no appointment, attendance, account or report mutations.

The panel displays AI-assisted labeling and exactly:

“This narrative was generated from authorized aggregate SOCConsult data. It must be reviewed by the Dean before inclusion in an official report.”

## PDF and deployment follow-up

Narrative PDF inclusion is deferred. PDFs neither import nor call AI and remain
available when Groq is unconfigured or unavailable. AI loading/errors cannot
change the report filters or disable PDF generation. The panel shows the saved
snapshot filters and disables approval when they differ from current filters.

Before deployment, verify replica-set transactions and the unique review index
are ready, and perform browser interaction/download checks. No migrations or
live database operations were performed for this change. Prompt constraints do
not guarantee model factuality: Dean review remains mandatory. Summary retention
and backup policies remain deployment responsibilities.
