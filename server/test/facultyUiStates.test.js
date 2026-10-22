import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";

const source = (path) =>
  readFile(new URL(`../../client/src/${path}`, import.meta.url), "utf8");

test("Faculty pages expose intentional loading, empty, and retry states", async () => {
  const [dashboard, requests, availability, calendar, consultations, history, reports, notifications] = await Promise.all([
    "pages/Faculty/FacultyDashboard.jsx",
    "pages/Faculty/AppointmentRequests.jsx",
    "pages/Faculty/ManageAvailability.jsx",
    "components/calendar/ConsultationCalendar.jsx",
    "components/appointments/FacultyConsultationsView.jsx",
    "pages/Faculty/FacultyConsultationHistory.jsx",
    "pages/Faculty/FacultyReports.jsx",
    "components/notifications/NotificationsView.jsx",
  ].map(source));
  assert.match(dashboard, /Loading your dashboard/);
  assert.match(dashboard, /ErrorState/);
  assert.match(dashboard, /No upcoming Confirmed consultation/);
  assert.match(requests, /Loading consultation requests/);
  assert.match(requests, /No pending consultation requests/);
  assert.match(availability, /No consultation schedules published yet/);
  assert.match(calendar, /CalendarSkeleton/);
  assert.match(consultations, /No upcoming consultations/);
  assert.match(history, /No consultation history yet/);
  assert.match(history, /No historical consultations match the selected filters/);
  assert.match(reports, /Generating PDF/);
  assert.match(reports, /No consultation records match the selected report filters/);
  assert.match(notifications, /Loading notifications/);
  assert.match(notifications, /No notifications yet/);
});

test("Faculty mutations use pending state and synchronous duplicate guards", async () => {
  const paths = [
    "pages/Faculty/AppointmentRequests.jsx",
    "pages/Faculty/ManageAvailability.jsx",
    "components/appointments/FacultyRescheduleModal.jsx",
    "components/appointments/FacultyConsultationsView.jsx",
    "pages/Faculty/FacultyReports.jsx",
    "components/notifications/NotificationsView.jsx",
    "pages/Faculty/FacultyAccountSettings.jsx",
    "components/profile/ProfilePictureEditor.jsx",
    "components/attendance/FacultyAttendanceForm.jsx",
    "components/consultations/ConsultationRecordForm.jsx",
  ];
  const code = (await Promise.all(paths.map(source))).join("\n");
  for (const guard of ["busyRef.current", "mutationBusy.current", "submittingRef.current", "inFlight.current", "actionPending.current", "pending.current"])
    assert.ok(code.includes(guard), guard);
  assert.match(code, /disabled=\{saving\}/);
  assert.match(code, /disabled=\{submitting\}/);
  assert.match(code, /disabled=\{busy\}/);
});

test("shared Faculty-facing errors are safe and categorize common failures", async () => {
  const [errors, api, attendance, records] = await Promise.all([
    "utils/safeUiErrors.js",
    "api/apiClient.js",
    "components/attendance/FacultyAttendanceForm.jsx",
    "components/consultations/ConsultationRecordForm.jsx",
  ].map(source));
  for (const copy of [
    "Your session has expired. Please sign in again.",
    "Unable to connect to SOCConsult. Check your connection and try again.",
    "This record is unavailable or you no longer have access to it.",
    "This consultation has already been updated. Refresh the details to see the latest status.",
  ]) assert.ok(errors.includes(copy), copy);
  assert.match(api, /response\.status === 401/);
  assert.match(api, /auth:session-expired/);
  assert.match(attendance, /pending\.current/);
  assert.match(records, /load\(\{ preserveDraft: true \}\)/);
  assert.doesNotMatch([errors, attendance, records].join("\n"), /setError\([^)]*error\.message|response\.data|JSON\.stringify\([^)]*error|\.stack/);
});

test("FAC-18 leaves workflow vocabulary and business services unchanged", async () => {
  const paths = [
    "pages/Faculty/AppointmentRequests.jsx",
    "components/appointments/FacultyConsultationsView.jsx",
    "pages/Faculty/FacultyConsultationHistory.jsx",
  ];
  const code = (await Promise.all(paths.map(source))).join("\n");
  assert.doesNotMatch(code, /status:\s*["']Approved["']|status:\s*["']Rescheduled["']|status:\s*["']No Show["']/);
  assert.doesNotMatch(code, /appointment\.status\s*=/);
});
