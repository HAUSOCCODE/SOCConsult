# DEA-15: Dean notification center

Both Dean workspaces use `/dean/notifications`. The workspace query parameter
only selects the surrounding navigation; it never limits notification ownership.
Management activity and personal Faculty activity addressed to the same user ID
appear together. Student and Faculty access remains limited to their own records.

## API

`GET /api/notifications` accepts only `page` (default 1, maximum 1,000,000),
`limit` (default 20, maximum 100), `category`, and `readState` (`all`, `read`,
`unread`). Categories are Management, Consultation, Attendance, Report. Results
sort by createdAt and _id descending. Pagination totals honor filters; unreadCount
always counts every unread notification belonging to the authenticated user.
Legacy records receive categories at read time, including server category filters.

Every read and mutation binds recipient to `req.user.id`; clients cannot supply
an owner. Responses use allowlisted fields and validated internal destinations,
and notification routes set Cache-Control: no-store before authentication.
Existing PUT read-one/read-all/unread-all and DELETE operations remain available.
The UI uses server pagination and retains its existing 15-second/focus refresh.

## Events and delivery

CSV completion/failure, manual creation, and account deactivation/reactivation
notify the acting Dean/import owner in Management. Links open the import preview
or account detail. Invalid CSV parsing notifies the authenticated Dean with a
generic import-page link; row validation feedback alone is not a completed import.
Confirmed revalidation invalidation and failed import outcomes generate failure
notices. Expired/unowned previews and uncertain commit outcomes do not.

Attendance Review creation notifies active Deans in Attendance and links directly
to the review. Personal consultation and attendance notices keep personal Faculty
destinations under `/dean/faculty/*`, including legacy consultation links.
Report PDF generation and AI summary failures use Report and `/dean/reports`.
Registration notices remain Management; personal action items use Consultation.

There is no Dean review deadline. `responseDeadlineAt` is the participant response
deadline, and `reviewStartedAt` records entry into review. Neither authorizes a
Dean review due date, so no nearing-deadline event or scheduler is added.

Successful management notifications join their source database transactions.
Notification failures therefore roll back those intentional transactions.
External AI calls remain outside transactions. Confirmed failures create generic
best-effort notices without exposing errors or replacing the original outcome.
Unknown transaction commit outcomes never generate failure notices. Helpers emit
fixed operational warnings and return failure; transactional failures propagate.
No email delivery exists or is introduced. No historical events are reconstructed.

## Deployment follow-up

The model declares a partial unique index on recipient and deduplicationKey, plus
a stable ownership/sort index. No index creation, migration, or database operation
is performed as part of this change. Deployment must separately review/provision
the indexes before relying on database-enforced concurrent deduplication.
Source keys identify import outcomes, account creation/status versions, review
creation, and individual report exports. Independent AI requests remain distinct.
Text equality never defines event identity. Deleting notifications also removes
their deduplication records; terminal source states prevent ordinary replay.

Failed import links may expire under existing retention policy. Reports link to
the reports page because no retained PDF-detail/download record endpoint exists.
Validation uses isolated mocked persistence, not a live MongoDB deployment.
