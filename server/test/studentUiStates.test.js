import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";

const source = (path) =>
  readFile(new URL(`../../client/src/${path}`, import.meta.url), "utf8");

test("shared Student UI states and render boundary provide safe recoverable fallbacks", async () => {
  const [ui, boundary, layout, api, auth, errors] = await Promise.all([
    "components/UI.jsx", "components/PageErrorBoundary.jsx", "components/RoleLayout.jsx",
    "api/apiClient.js", "context/AuthContext.jsx", "utils/studentUiErrors.js",
  ].map(source));
  for (const contract of ["EmptyState", "Loading", "ErrorState", "onRetry", "role=\"alert\""])
    assert.ok(ui.includes(contract), contract);
  assert.match(boundary, /getDerivedStateFromError/);
  assert.match(boundary, /Try Again/);
  assert.match(boundary, /Reload Page/);
  assert.doesNotMatch(boundary, /error\.stack|String\(error\)|\{error\}/);
  assert.match(layout, /<PageErrorBoundary[\s\S]*<Outlet \/>[\s\S]*<\/PageErrorBoundary>/);
  assert.match(api, /response\.status === 401/);
  assert.match(api, /auth:session-expired/);
  assert.match(auth, /addEventListener\("auth:session-expired"/);
  assert.match(errors, /Network connection interrupted/);
  assert.match(errors, /don't have permission/);
  assert.match(ui, /retryable = Boolean\(onRetry\)/);
  assert.doesNotMatch(ui, /message !==|message ===/);
  assert.match(errors, /isRecoverableStudentError/);
  assert.match(api, /sessionStorage\.getItem\("consultio_token"\) !== token/);
  assert.doesNotMatch(errors, /error\.message|response\.data|JSON\.stringify/);
});

test("Student pages expose required loading, empty, retry, and stale-slot states", async () => {
  const files = await Promise.all([
    "components/dashboard/StudentDashboardContent.jsx",
    "pages/Student/FindFaculty.jsx",
    "components/student/StudentAvailabilityList.jsx",
    "components/student/StudentAvailabilityForm.jsx",
    "components/appointments/StudentConsultationsView.jsx",
    "components/calendar/ConsultationCalendar.jsx",
    "pages/Student/StudentConsultationHistory.jsx",
    "components/notifications/NotificationsView.jsx",
    "pages/Student/StudentAccountSettings.jsx",
    "components/student/ConsultationRequestForm.jsx",
    "pages/Student/StudentCalendar.jsx",
  ].map(source));
  const all = files.join("\n");
  for (const copy of [
    "No Faculty found.", "No available consultation slots.",
    "No private availability entered.", "No active consultations.",
    "No attendance update required.", "No consultations are currently under review.",
    "No consultation history yet.", "No notifications yet.",
    "No consultations scheduled for this period.",
    "This consultation slot is no longer available. Please choose another time.",
  ]) assert.ok(all.includes(copy), copy);
  assert.match(files[0], /<Loading \/>/);
  assert.match(files[0], /<ErrorState/);
  assert.match(files[1], /scheduleError/);
  assert.match(files[1], /onRetry=/);
  assert.match(files[3], /if \(pending\.current\) return/);
  assert.match(files[4], /onRetry=\{load\}/);
  assert.match(files[5], /CalendarSkeleton/);
  assert.match(files[5], /onRetry=/);
  assert.match(files[6], /No historical consultations match the selected filters/);
  assert.match(files[7], /Loading notifications/);
  assert.match(files[9], /if \(submittingRef\.current\) return/);
  assert.doesNotMatch(all, /SMTP|nodemailer|invalid_grant|Email failed/);
});

test("Student mutation errors are normalized and raw technical errors are not rendered", async () => {
  const paths = [
    "components/student/ConsultationRequestForm.jsx",
    "components/student/StudentAvailabilityForm.jsx",
    "components/attendance/StudentAttendanceResponseForm.jsx",
    "components/appointments/StudentRescheduleResponseModal.jsx",
    "components/appointments/StudentAppointmentDetailsModal.jsx",
  ];
  const code = (await Promise.all(paths.map(source))).join("\n");
  assert.match(code, /safeStudentError/);
  assert.doesNotMatch(code, /setError\(requestError\.message|setAttendanceError\(error\.message/);
  assert.doesNotMatch(code, /response\.data|JSON\.stringify\([^)]*error|\.stack/);
});
