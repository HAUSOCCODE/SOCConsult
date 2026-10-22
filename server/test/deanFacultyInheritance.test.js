import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { authorize } from "../src/middleware/auth.js";

const source = (path) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8");
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

test("active role middleware permits Faculty and Dean personal use but rejects Student and legacy admin", () => {
  const guard = authorize("faculty", "dean");
  for (const role of ["faculty", "dean"]) {
    let called = false;
    guard({ user: { role } }, response(), () => { called = true; });
    assert.equal(called, true, role);
  }
  for (const role of ["student", "admin", "program_chair"]) {
    const res = response();
    guard({ user: { role } }, res, () => assert.fail("unauthorized role advanced"));
    assert.equal(res.statusCode, 403, role);
  }
});

test("personal Faculty routes support Dean while deriving every owner from the authenticated user", async () => {
  const [faculty, appointments, availability, dashboard, attendance, auth] = await Promise.all([
    "routes/facultyRoutes.js", "routes/appointmentRoutes.js", "routes/availabilityRoutes.js",
    "routes/dashboardRoutes.js", "routes/attendanceRoutes.js", "routes/authRoutes.js",
  ].map(source));
  assert.match(faculty, /router\.use\(authenticate, authorize\("faculty", "dean"\)\)/);
  assert.match(faculty, /facultyCalendar\(\{ faculty: req\.user\.id/);
  assert.match(faculty, /postFacultyReport/);
  for (const route of ["requests", "faculty-history", "consultations"])
    assert.match(appointments, new RegExp(`router\\.get\\(\"/${route}`));
  assert.match(appointments, /listFacultyRequests\(\{ faculty: req\.user\.id/);
  assert.match(appointments, /listFacultyConsultationHistory\(\{ faculty: req\.user\.id/);
  assert.match(appointments, /listFacultyConsultations\(\{ faculty: req\.user\.id/);
  assert.match(appointments, /req\.user\.role === "student"[\s\S]*\{ faculty: req\.user\.id \}/);
  assert.match(availability, /authorize\("faculty", "dean"\)/);
  assert.match(dashboard, /router\.get\("\/faculty", authorize\("faculty", "dean"\)/);
  assert.match(attendance, /authorize\("student", "faculty", "dean"\)/);
  assert.match(attendance, /id: req\.user\.id/);
  assert.match(auth, /router\.put\("\/me"[\s\S]*authorize\("student", "faculty", "dean"\)/);
});

test("personal services keep Dean inside the same consultant ownership boundary", async () => {
  const [dashboard, requests, consultations, calendar, history, report, records, attendance, availability] = await Promise.all([
    "services/facultyDashboardService.js", "services/facultyRequestService.js",
    "services/facultyConsultationService.js", "services/facultyCalendarService.js",
    "services/facultyConsultationHistoryService.js", "services/facultyReportService.js",
    "services/consultationRecordService.js", "services/attendanceService.js",
    "services/availabilityManagementService.js",
  ].map(source));
  assert.match(dashboard, /const owned = \{ faculty: user\.id \}/);
  assert.match(requests, /faculty: new mongoose\.Types\.ObjectId\(faculty\)/);
  assert.match(consultations, /\$match: \{ faculty: new mongoose\.Types\.ObjectId\(faculty\) \}/);
  assert.match(calendar, /Availability\.find\(\{ faculty,/);
  assert.match(calendar, /Appointment\.find\(\{ faculty,/);
  assert.match(history, /const query = \{ faculty, status:/);
  assert.match(report, /facultyReportQuery\(actor\.id/);
  assert.match(records, /\["faculty", "dean"\]\.includes\(actor\.role\)[\s\S]*appointment\.faculty[\s\S]*actor\.id/);
  assert.match(attendance, /participation\(row, actor\)/);
  assert.match(availability, /faculty: actor\.id/);
  const combined = [dashboard, requests, consultations, calendar, history, report, records, attendance, availability].join("\n");
  assert.doesNotMatch(combined, /role\s*===\s*["']dean["'][\s\S]{0,120}\?\s*\{\s*\}/);
});

test("Student booking remains provider-selectable while personal availability ignores injected owner IDs", async () => {
  const [routes, controller] = await Promise.all([source("routes/availabilityRoutes.js"), source("controllers/availabilityController.js")]);
  assert.match(routes, /"\/faculty\/:facultyId"[\s\S]*authorize\("student", "faculty", "dean"\)/);
  assert.match(controller, /req\.user\.role === "student" \? req\.params\.facultyId : req\.user\.id/);
  assert.match(controller, /getMyAvailability[\s\S]*Object\.keys\(req\.query\)\.length[\s\S]*Owner IDs are not accepted/);
  assert.match(controller, /findOne\(\{[\s\S]*_id: req\.params\.id,[\s\S]*faculty: req\.user\.id/);
  assert.match(controller, /mutateAvailability\(\{ actor: req\.user/);
});

test("Dean management scope remains on separate Dean-only routes and cannot be inherited by Faculty", async () => {
  const [dean, faculty, monitoring, reports, review] = await Promise.all([
    "routes/deanRoutes.js", "routes/facultyRoutes.js", "services/deanConsultationService.js",
    "services/deanReportService.js", "controllers/attendanceReviewController.js",
  ].map(source));
  assert.match(dean, /router\.use\(authenticate, authorize\("dean"\)\)/);
  assert.match(dean, /router\.post\("\/reports\/pdf"/);
  assert.match(dean, /router\.get\("\/attendance-review"/);
  assert.match(dean, /router\.get\("\/consultations"/);
  assert.match(dean, /router\.get\("\/users"/);
  assert.doesNotMatch(dean, /authorize\("faculty", "dean"\)/);
  assert.match(faculty, /router\.post\("\/reports\/pdf"/);
  assert.doesNotMatch(faculty, /getConsultations|getReviews|getUsers|postDeanReport/);
  assert.match(monitoring, /facultyId/);
  assert.match(reports, /createDeanReport/);
  assert.match(review, /management: true/);
});

test("notifications and account settings remain authenticated-recipient and authenticated-self scoped", async () => {
  const [notifications, auth, transition] = await Promise.all([
    "controllers/notificationController.js", "controllers/authController.js",
    "services/appointmentTransitionService.js",
  ].map(source));
  assert.match(notifications, /recipient: req\.user\.id/);
  assert.match(auth, /User\.findByIdAndUpdate\(req\.user\.id, updates/);
  assert.match(auth, /User\.findById\(req\.user\.id\)\.select\("\+password"\)/);
  assert.match(transition, /actor\.role === "student"[\s\S]*student: actor\.id[\s\S]*faculty: actor\.id/);
  assert.doesNotMatch(transition, /actor\.role === "dean"\s*\?\s*\{\}/);
});
