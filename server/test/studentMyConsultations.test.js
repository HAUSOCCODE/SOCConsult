import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import Appointment from "../src/models/Appointment.js";
import {
  ACTIVE_REQUEST_STATUSES,
  ATTENDANCE_REQUIRED_STATUSES,
  UNDER_REVIEW_STATUSES,
  TERMINAL_STATUSES,
  getAppointmentDisplayStatus,
  getStudentConsultationGroup,
} from "../../client/src/utils/appointmentStatus.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Appointment schema exposes only the revised consultation lifecycle", () => {
  assert.deepEqual(Appointment.schema.path("status").enumValues, [
    "Pending",
    "Reschedule Proposed",
    "Confirmed",
    "Rejected",
    "Cancelled",
    "Expired",
    "Awaiting Attendance Update",
    "Completed",
    "Attendance Review",
  ]);
});

test("Student consultation groups are exact, terminal-safe, and unknown-safe", () => {
  assert.deepEqual(ACTIVE_REQUEST_STATUSES, ["Pending", "Reschedule Proposed", "Confirmed"]);
  assert.deepEqual(ATTENDANCE_REQUIRED_STATUSES, ["Awaiting Attendance Update"]);
  assert.deepEqual(UNDER_REVIEW_STATUSES, ["Attendance Review"]);
  assert.deepEqual(TERMINAL_STATUSES, ["Rejected", "Cancelled", "Expired", "Completed"]);
  for (const status of ACTIVE_REQUEST_STATUSES) assert.equal(getStudentConsultationGroup(status), "active");
  assert.equal(getStudentConsultationGroup("Awaiting Attendance Update"), "attendance");
  assert.equal(getStudentConsultationGroup("Attendance Review"), "review");
  for (const status of TERMINAL_STATUSES) assert.equal(getStudentConsultationGroup(status), "terminal");
  assert.equal(getStudentConsultationGroup("Unexpected"), "unknown");
  assert.equal(getAppointmentDisplayStatus({ status: "Unexpected" }), "Status unavailable");
});

test("canonical Student consultations UI uses revised groups and no legacy actions", async () => {
  const [page, view, details] = await Promise.all([
    read("../../client/src/pages/Student/StudentAppointments.jsx"),
    read("../../client/src/components/appointments/StudentConsultationsView.jsx"),
    read("../../client/src/components/appointments/StudentAppointmentDetailsModal.jsx"),
  ]);
  assert.match(page, /StudentConsultationsView/);
  for (const text of [
    "Active Requests",
    "Attendance Required",
    "Under Review",
    "Consultation Concern",
    "View Details",
  ]) assert.match(view, new RegExp(text));
  for (const legacy of [
    "Approved",
    "Rescheduled",
    "Needs Reschedule",
    "Awaiting Faculty Schedule",
    "No Show",
    "Awaiting Faculty Update",
  ]) {
    assert.doesNotMatch(page + view + details, new RegExp(legacy));
  }
  assert.match(view, /appointment\.status === "Pending"/);
  assert.doesNotMatch(view, /Accept|Reject|Download|Attendance Response/);
  assert.match(details, /allowLink=\{\["Confirmed", "Completed"\]/);
  assert.doesNotMatch(details, /reservationToken|StudentAvailability/);
});

test("backend status producers use revised Appointment statuses", async () => {
  const sources = await Promise.all([
    read("../src/routes/appointmentRoutes.js"),
    read("../src/routes/scheduleRequestRoutes.js"),
    read("../src/controllers/facultyAppointmentController.js"),
    read("../src/services/availabilityExpirationService.js"),
  ]);
  const source = sources.join("\n");
  for (const creation of [
    'status: "Approved"',
    'status: "Rescheduled"',
    'status: "Needs Reschedule"',
    'status: "Awaiting Faculty Schedule"',
    'status: "No Show"',
  ]) assert.doesNotMatch(source, new RegExp(creation.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(source, /status: "Pending"/);
  assert.match(source, /status: "Confirmed"/);
  assert.match(source, /status: "Reschedule Proposed"/);
  assert.match(source, /status: "Expired"/);
});
