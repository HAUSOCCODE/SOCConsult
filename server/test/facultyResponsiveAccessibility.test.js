import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";

const source = path => readFile(new URL(`../../client/src/${path}`, import.meta.url), "utf8");

test("Faculty workspace uses the shared responsive, keyboard-operable navigation", async () => {
  const [faculty, layout] = await Promise.all([source("layouts/FacultyLayout.jsx"), source("components/RoleLayout.jsx")]);
  assert.match(faculty, /<RoleLayout/);
  assert.match(layout, /aria-expanded=\{open\}/);
  assert.match(layout, /role=\{!desktop && open \? "dialog" : undefined\}/);
  assert.match(layout, /useDialogFocus\(/);
  assert.match(layout, /inert=\{!desktop && !open\}/);
  assert.match(layout, /min-w-0/);
  assert.doesNotMatch(layout, /\bw-screen\b/);
});

test("Faculty pages use responsive grids, wrapping, and scoped narrow-screen layouts", async () => {
  const paths = ["pages/Faculty/FacultyDashboard.jsx", "pages/Faculty/AppointmentRequests.jsx", "pages/Faculty/ManageAvailability.jsx", "pages/Faculty/FacultyConsultationHistory.jsx", "pages/Faculty/FacultyReports.jsx", "pages/Faculty/FacultyAccountSettings.jsx", "components/appointments/FacultyConsultationsView.jsx", "components/notifications/NotificationsView.jsx"];
  const files = await Promise.all(paths.map(source));
  for (const raw of files) assert.match(raw, /min-w-0|w-full/);
  assert.match(files[0], /sm:grid-cols-3/);
  assert.match(files[1], /break-words/);
  assert.match(files[2], /grid-cols-1/);
  assert.match(files[3], /sm:grid-cols-2/);
  assert.match(files[7], /break-words/);
  assert.match(files[6], /flex flex-wrap items-center gap-3/);
});

test("Faculty long concerns and identity values remain readable", async () => {
  const [requests, details, history, account] = await Promise.all([source("pages/Faculty/AppointmentRequests.jsx"), source("components/appointments/FacultyAppointmentDetailsModal.jsx"), source("pages/Faculty/FacultyConsultationHistory.jsx"), source("pages/Faculty/FacultyAccountSettings.jsx")]);
  assert.match(requests, /whitespace-pre-wrap break-words/);
  assert.match(details, /className="mt-1 break-words/);
  assert.match(history, /break-words/);
  assert.match(account, /<dd className="mt-1 break-words/);
});

test("shared dialogs contain focus, support Escape, and restore focus", async () => {
  const [hook, modal, confirm] = await Promise.all([source("hooks/useDialogFocus.js"), source("components/UI.jsx"), source("components/ConfirmDialog.jsx")]);
  assert.match(hook, /event\.key === "Tab"/);
  assert.match(hook, /event\.shiftKey/);
  assert.match(hook, /event\.key === "Escape"/);
  assert.match(hook, /restoreTarget/);
  assert.match(hook, /const previous = latest\.current\.restoreTarget \|\| document\.activeElement/);
  for (const raw of [modal, confirm]) {
    assert.match(raw, /role="dialog"/);
    assert.match(raw, /aria-modal="true"/);
    assert.match(raw, /aria-labelledby/);
    assert.match(raw, /useDialogFocus\(/);
    assert.match(raw, /100dvh/);
    assert.match(raw, /overflow-y-auto/);
  }
  assert.match(confirm, /aria-label="Close confirmation dialog"/);
});

test("Faculty custom dialog surfaces use shared focus behavior and mobile viewport bounds", async () => {
  const paths = ["pages/Faculty/AppointmentRequests.jsx", "components/appointments/FacultyAppointmentDetailsModal.jsx", "components/appointments/FacultyScheduleDetailsModal.jsx", "components/appointments/FacultyRescheduleModal.jsx", "components/appointments/OneTimeScheduleRequests.jsx", "components/calendar/ConsultationCalendar.jsx", "components/profile/ProfilePictureEditor.jsx", "components/notifications/NotificationsView.jsx"];
  for (const path of paths) {
    const raw = await source(path);
    assert.match(raw, /useDialogFocus\(/, path);
    assert.match(raw, /role="dialog"/, path);
    assert.match(raw, /aria-labelledby/, path);
    assert.doesNotMatch(raw, /tabIndex=\{[1-9]/, path);
  }
  const history = await source("pages/Faculty/FacultyConsultationHistory.jsx");
  assert.match(history, /<Modal title="Consultation record"/);
  assert.match(await source("components/appointments/FacultyAppointmentDetailsModal.jsx"), /restoreTarget: opener/);
});

test("cancellation and rejection require explicit confirmation", async () => {
  const [consultations, attendance, schedule, requests] = await Promise.all([source("components/appointments/FacultyConsultationsView.jsx"), source("components/attendance/FacultyAttendanceForm.jsx"), source("components/appointments/FacultyScheduleDetailsModal.jsx"), source("pages/Faculty/AppointmentRequests.jsx")]);
  assert.match(consultations, /<ConfirmDialog[^>]*open=\{cancelling\}/s);
  assert.match(consultations, /confirmLabel="Cancel consultation"/);
  assert.match(schedule, /title="Reject Appointment Request"/);
  assert.match(schedule, /confirmLabel="Reject"/);
  assert.match(requests, /setRejecting\(true\)/);
  assert.match(requests, /Confirm rejection/);
  assert.match(attendance, /<ConfirmDialog/);
});

test("Faculty controls expose labels and field-error semantics", async () => {
  const [availability, reports, account, profile, attendance] = await Promise.all([source("pages/Faculty/ManageAvailability.jsx"), source("components/reports/FacultyReportFilters.jsx"), source("pages/Faculty/FacultyAccountSettings.jsx"), source("components/profile/ProfilePictureEditor.jsx"), source("components/attendance/FacultyAttendanceForm.jsx")]);
  assert.match(availability, /<label/);
  assert.match(reports, /<label/);
  assert.match(account, /<label/);
  assert.match(profile, /type="file"/);
  assert.match(profile, /aria-label="Choose profile photo"/);
  assert.match(attendance, /<fieldset/);
  assert.match(attendance, /role="alert"/);
});

test("status and notification read state include text rather than color alone", async () => {
  const [ui, notifications] = await Promise.all([source("components/UI.jsx"), source("components/notifications/NotificationsView.jsx")]);
  assert.match(ui, /\{status\}/);
  assert.match(notifications, /Unread/);
  assert.match(notifications, /Read/);
  assert.match(notifications, /aria-label/);
});

test("Faculty display time stays centralized on Asia/Manila semantics", async () => {
  const [utility, dashboard, requests, history, calendar] = await Promise.all([source("utils/formatDateTime.js"), source("pages/Faculty/FacultyDashboard.jsx"), source("pages/Faculty/AppointmentRequests.jsx"), source("pages/Faculty/FacultyConsultationHistory.jsx"), source("components/calendar/ConsultationCalendar.jsx")]);
  assert.match(utility, /Asia\/Manila/);
  for (const raw of [dashboard, requests, history]) assert.match(raw, /formatManila/);
  assert.match(calendar, /const TIMEZONE = "Asia\/Manila"/);
  for (const raw of [dashboard, requests, history, calendar]) assert.doesNotMatch(raw, /toLocale(?:DateString|TimeString|String)\(/);
});

test("responsive tables scroll within named regions rather than the page", async () => {
  const [table, css] = await Promise.all([source("components/ResponsiveTable.jsx"), source("index.css")]);
  assert.match(table, /role="region"/);
  assert.match(table, /aria-label=\{label\}/);
  assert.match(table, /tabIndex=\{scrollable \? 0/);
  assert.match(css, /responsive-table-scroll/);
  assert.match(css, /responsive-table-scroll[\s\S]*overflow-x-auto/);
});

test("Faculty account tabs expose keyboard and ARIA tab behavior", async () => {
  const raw = await source("pages/Faculty/FacultyAccountSettings.jsx");
  assert.match(raw, /role="tablist"/);
  assert.match(raw, /role="tab"/);
  assert.match(raw, /aria-selected/);
  assert.match(raw, /aria-controls/);
  assert.match(raw, /ArrowRight|ArrowLeft/);
});

test("FAC-19 production scope remains client-side and does not add positive tabindex", async () => {
  const paths = ["components/RoleLayout.jsx", "components/UI.jsx", "pages/Faculty/AppointmentRequests.jsx", "pages/Faculty/FacultyConsultationHistory.jsx", "components/appointments/FacultyAppointmentDetailsModal.jsx", "components/appointments/FacultyScheduleDetailsModal.jsx", "components/appointments/FacultyConsultationsView.jsx", "components/notifications/NotificationsView.jsx"];
  for (const path of paths) assert.doesNotMatch(await source(path), /tabIndex=\{?[1-9]/, path);
});
