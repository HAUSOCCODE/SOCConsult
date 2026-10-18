# DEA-20: Dean responsive design and accessibility review

Branch: `qa/dean-responsive-accessibility`.

## Scope and inventory

Management routes: `/dean/dashboard`, `/dean/import`, `/dean/users`,
`/dean/consultations`, `/dean/attendance-review` (including record details),
`/dean/reports`, `/dean/notifications`, `/dean/account`, `/dean/audit-logs`.

Personal Faculty routes: `/dean/faculty/dashboard`, `/requests`, `/availability`,
`/consultations`, `/history`, `/calendar`, `/reports` (still deferred).
Notifications/account preserve the existing `workspace=faculty` context.
Legacy redirects and authorization are unchanged.

## Issue matrix and implemented changes

| Component | Mobile layout | Table overflow | Labels/semantics | Keyboard/focus | Non-color status | Long content | Date/time |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Layout/workspace selector | Preserve full-width mobile native selector and wrapping header | N/A | Name notification control; active workspace stays visible | Closed mobile drawer inert; opening/closing, containment and restoration; respond to desktop breakpoint | Unread count accessible as text | Wrap user/workspace content | N/A |
| Dashboard | Preserve responsive grids/range controls | Named overflow region | Scope headers; page owns H1; associate range feedback | Scroll region tabbable only if overflowing | Import/consultation status text retained | Wrap subjects/names | Manila display helper; format calendar ranges separately |
| CSV upload/preview/results | Preserve stacked actions and summaries | Named scroll regions for schema and row results | File label/error association; scoped headers | Preserve bulk confirmation and submission guards | Valid/Invalid and lifecycle text retained | Wrap filenames/emails/errors | Manila expiry/import display |
| User management | Preserve existing mobile account cards | Named account region | Required deactivation reason and associated inline error | Shared details/manual/confirmation focus management | Active/Inactive text retained | Wrap account/details/confirmation text | Shared Manila date display |
| Monitoring/attendance | Stack paired dates on narrow screens; wrap filter actions | Named regions; preserve native tables | Scope headers; describe filter, participant-option and resolution errors | Native details join shared focus stack; nested confirmation remains in native dialog | Existing status/outcome text retained | Wrap names, concerns and reasons | Shared Manila formatter |
| PDF/AI reports | Preserve existing filter grid and action wrapping | N/A | Associate report errors with fields/group | Preserve native controls and duplicate guards | Reviewed/Unreviewed text retained | Wrap narrative and filter snapshot | Format AI timestamps and date-only ranges; PDF already uses Manila |
| Notifications | Preserve Dean rows and Student/Faculty cards | Shared wrapper for existing tables | Named actions, scoped headers and dialog title | Shared details/confirmation stack | Read/Unread text retained | Full detail view retained for truncated titles | Manila display, including date parts |
| Audit | Preserve responsive master/detail view | Named management feed region | Role filters use toggle-button group; selected user uses aria-pressed | Focus mobile details and restore selected user on Back | Existing text statuses retained | Wrap metadata/long descriptions | Shared Manila display |
| Account/profile | Preserve stacked layout | N/A | Associate profile errors; name photo chooser and both responsive program inputs | Shared photo editor/preview focus stack | Existing progress/error text retained | Wrap profile content | Manila password-change timestamp |
| Personal Faculty | Preserve requests, availability, cards and calendar layouts | History cards retained; table headers scoped | Dialog/form names; decorative icons hidden | Shared request/schedule/reschedule/calendar dialogs; busy guards | Calendar event pills/week events now show status text | Truncated calendar topics have full accessible names and open full details | Replace host-local display formatting with Manila helper |

## Shared implementation

- `useDialogFocus` coordinates custom/native dialogs and mobile drawers. Only
  the top layer handles Tab/Escape and focus escape. Busy dialogs suppress
  cancellation. Connected openers regain focus after close; removed openers
  are skipped. Scroll locks are counted across nested layers. No positive
  tabindex is introduced.
- `ResponsiveTable` retains native tables and header relationships. Its region
  and table have accessible names. Resize observation measures actual horizontal
  overflow; fitting/hidden regions do not add a keyboard stop. Native horizontal
  scrolling remains available.
- `formatDateTime` uses `Intl.DateTimeFormat` and `Asia/Manila`. Timestamp display
  and date-only display are separate. Date-only formatting validates calendar
  dates and does not shift the day or modify filter/API values. Intentional date
  parts and contextual date/time granularity remain supported.
- Targeted wrapping, dialog viewport limits and focus outlines preserve the
  maroon/gold interface. Existing page layouts, filters, statuses and API payloads
  remain intact. No dependencies or runtime server logic changed.

## Confirmation regression coverage

Bulk CSV import, manual account creation, deactivation, password reset and final
attendance resolution retain explicit confirmation and synchronous submission
guards. Leave-under-review keeps its established non-final workflow. Existing
uncertain-result/conflict refresh handling is retained.

Tests cover the real shared focus hook using controlled DOM fixtures, nested
layers, busy Escape suppression, Tab boundaries, removed openers, scroll-lock
cleanup, real overflow measurement, field/error association, visible status text,
full calendar topic access, workspace switching and date boundaries across host
timezones. Existing component-only harnesses receive explicit dependency stubs;
the shared hook and overflow component have separate interaction coverage.

## Remaining manual QA (not yet performed)

- Test all listed routes at 320, 375, 390, 640, 768, 1024 and 1280 CSS pixels,
  portrait/landscape, 200% and 400% zoom. Check no page-wide horizontal overflow,
  overlapping actions or hidden workspace; test opening the drawer then resizing.
- Exercise CSV previews/errors and account, monitoring, attendance, notification,
  audit and history views with many records and long unbroken names, emails,
  filenames, subjects, concerns, descriptions and status text. Scroll tables by
  keyboard and touch; fitting tables should not add an extra Tab stop.
- Keyboard-test all five confirmations: opening, initial focus, Tab/Shift+Tab,
  Enter/Space buttons, safe Escape, busy cancellation suppression, repeated
  activation and restoration. Test attendance native dialog plus its nested
  confirmation and request/schedule dialogs plus nested photo/detail dialogs.
- Verify dialogs at short landscape heights and with the mobile software keyboard;
  content/actions must remain reachable through internal scrolling.
- With NVDA/Firefox or Chrome and VoiceOver/Safari, verify landmarks/headings,
  labels, required/disabled fields, associated errors, status announcements,
  named scroll regions, table headers, active workspace and unread counts.
  Check that lower dialog layers are not announced as active and updates do not
  repeatedly interrupt reading.
- Verify text statuses without color and visible keyboard focus against maroon,
  white and gold surfaces. Check contrast with browser tooling.
- Test Audit role selection and mobile user/detail/Back focus; test selected-user
  removal during refresh and stale/empty/error states.
- Compare consultation timestamps around Manila midnight using browsers set to
  UTC and other host timezones. Verify date-only filter inputs, report ranges,
  sorting and API payloads remain unchanged.
- Smoke-test Student/Faculty shared navigation, notifications, profile/security,
  photo dialogs, appointment details, calendar and confirmations. No Student or
  Faculty page redesign is part of this work.

Source and simulated interaction tests do not establish WCAG compliance. Real
browser, screen-reader and device validation remains required.

## Automated validation

- Focused implementation suite: 65/65 tests passed.
- Complete isolated server suite: run once, 308/309 passed. The sole failure was
  a Student attendance source assertion expecting the timezone literal in the
  component rather than the new shared formatter. Updated that assertion to
  verify the imported helper and actual Manila midnight-boundary output.
- After that test-only adjustment: 10/10 affected Student attendance, DEA-20
  interaction and date-formatting tests passed. The complete suite was not rerun,
  following the requested once-only full-suite validation.
- Client production build: passed once (1,736 modules). PowerShell blocked the
  npm.ps1 launcher before execution; npm.cmd ran the single Vite build. Vite
  reported an application chunk-size advisory (main JS 692.61 kB).
- Client syntax transforms: all 99 JavaScript/JSX source files passed.
- Changed JavaScript files: Node syntax checks passed.
- git diff --check: passed.
- No dependency installation, .env access, live database access, migration or
  processor execution, commit, push or PR creation was performed. The isolated
  suite uses test-only service configuration and mocked database operations.

## Changed files

- `client/src/components/ConfirmDialog.jsx`
- `client/src/components/ResponsiveTable.jsx`
- `client/src/components/RoleLayout.jsx`
- `client/src/components/UI.jsx`
- `client/src/components/accounts/CSVErrorTable.jsx`
- `client/src/components/accounts/CSVImportResult.jsx`
- `client/src/components/accounts/CSVUploadPanel.jsx`
- `client/src/components/accounts/CSVValidationPreview.jsx`
- `client/src/components/accounts/ManualAccountForm.jsx`
- `client/src/components/appointments/AppointmentRequestDetailsModal.jsx`
- `client/src/components/appointments/AppointmentsView.jsx`
- `client/src/components/appointments/FacultyAppointmentDetailsModal.jsx`
- `client/src/components/appointments/FacultyRescheduleModal.jsx`
- `client/src/components/appointments/FacultyScheduleDetailsModal.jsx`
- `client/src/components/appointments/OneTimeScheduleRequests.jsx`
- `client/src/components/attendance/AttendanceResolutionForm.jsx`
- `client/src/components/attendance/AttendanceResponseSummary.jsx`
- `client/src/components/attendance/AttendanceReviewDetails.jsx`
- `client/src/components/calendar/ConsultationCalendar.jsx`
- `client/src/components/dashboard/DashboardOverview.jsx`
- `client/src/components/dean/ConsultationDetailsDialog.jsx`
- `client/src/components/dean/ReportNarrativePanel.jsx`
- `client/src/components/navigation/WorkspaceSwitcher.jsx`
- `client/src/components/notifications/NotificationsView.jsx`
- `client/src/components/profile/ProfileForm.jsx`
- `client/src/components/profile/ProfileImagePreview.jsx`
- `client/src/components/profile/ProfilePictureEditor.jsx`
- `client/src/hooks/useDialogFocus.js`
- `client/src/index.css`
- `client/src/pages/Dean/AttendanceReview.jsx`
- `client/src/pages/Dean/AuditLogs.jsx`
- `client/src/pages/Dean/ConsultationMonitoring.jsx`
- `client/src/pages/Dean/CsvImport.jsx`
- `client/src/pages/Dean/DeanAccountSettings.jsx`
- `client/src/pages/Dean/DeanDashboard.jsx`
- `client/src/pages/Dean/ManagementAuditFeed.jsx`
- `client/src/pages/Dean/ReportsAnalytics.jsx`
- `client/src/pages/Dean/UserManagement.jsx`
- `client/src/pages/Faculty/AppointmentRequests.jsx`
- `client/src/pages/Faculty/ManageAvailability.jsx`
- `client/src/utils/formatDateTime.js`
- `server/DEA20.md`
- `server/test/attendanceReviewUi.test.js`
- `server/test/csvImportConfirmationUi.test.js`
- `server/test/csvImportPreview.test.js`
- `server/test/dateTimeFormatting.test.js`
- `server/test/deanConsultationMonitoringUi.test.js`
- `server/test/deanDashboardUi.test.js`
- `server/test/deanLayout.test.js`
- `server/test/deanReportsUi.test.js`
- `server/test/deanResponsiveAccessibility.test.js`
- `server/test/deanUiStates.test.js`
- `server/test/helpers/clientImports.js`
- `server/test/manualAccountUi.test.js`
- `server/test/reportNarrativeUi.test.js`
- `server/test/studentAttendanceResponse.test.js`
- `server/test/userManagementUi.test.js`
- `server/test/userPasswordResetUi.test.js`
