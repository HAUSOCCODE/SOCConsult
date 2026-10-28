import { appointmentHttp } from "./helpers/appointmentHttp.js";
import { fixture, addSlot } from "./helpers/appointmentHarness.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import mongoose from "mongoose";
import Appointment from "../src/models/Appointment.js";
import {
  facultyAppointmentInternals,
} from "../src/controllers/facultyAppointmentController.js";

const { parseManilaDateTime, validateInput } = facultyAppointmentInternals;
const ids = {
  appointment: new mongoose.Types.ObjectId(),
  faculty: new mongoose.Types.ObjectId(),
  student: new mongoose.Types.ObjectId(),
};
const requestBody = (overrides = {}) => ({
  consultationDate: "2099-01-02",
  startTime: "14:00",
  duration: 30,
  mode: "Online",
  meetingPlatform: "Google Meet",
  meetingLink: "https://meet.google.com/example",
  location: "",
  reason: "Faculty emergency requiring a schedule adjustment.",
  ...overrides,
});
test("parses faculty schedules in Asia/Manila and validates required fields", () => {
  assert.equal(
    parseManilaDateTime("2026-09-30", "14:00").toISOString(),
    "2026-09-30T06:00:00.000Z",
  );
  assert.equal(parseManilaDateTime("2026-02-30", "14:00"), null);
  const now = new Date("2026-09-27T00:00:00.000Z");
  assert.equal(validateInput(requestBody(), now).error, undefined);
  assert.match(
    validateInput(requestBody({ consultationDate: "2020-01-01" }), now).error,
    /future/i,
  );
  assert.match(
    validateInput(requestBody({ duration: 0 }), now).error,
    /duration/i,
  );
  assert.match(
    validateInput(requestBody({ reason: " " }), now).error,
    /reason/i,
  );
  assert.match(
    validateInput(
      requestBody({ mode: "Face-to-Face", location: "", meetingPlatform: "" }),
      now,
    ).error,
    /location/i,
  );
  assert.match(
    validateInput(requestBody({ meetingLink: "javascript:alert(1)" }), now)
      .error,
    /HTTP/i,
  );
});

test("appointment schema preserves faculty reschedule history", () => {
  const history = Appointment.schema.path("scheduleHistory");
  assert.ok(history);
  assert.ok(history.schema.path("previous.startAt"));
  assert.ok(history.schema.path("next.endAt"));
  assert.ok(history.schema.path("reason"));
  assert.ok(history.schema.path("initiatedByRole"));
  assert.ok(history.schema.path("initiatedBy"));
});

for (const role of ["faculty", "dean"]) test(role+" proposal is owned, separate, atomic and cannot complete directly", async () => {
  const h = await appointmentHttp();
  try {
    const record = fixture({ student: h.users.student.id, faculty: h.users[role].id, status: "Confirmed" });
    h.state.appointments.push(record); addSlot(h, record);
    const path = '/faculty/appointments/'+record._id+'/reschedule';
    assert.equal((await h.request(path, "otherFaculty", "PATCH", requestBody())).status, 404);
    const response = await h.request(path, role, "PATCH", requestBody()); assert.equal(response.status, 200);
    const result = (await response.json()).appointment;
    assert.equal(result.status, "Reschedule Proposed"); assert.equal(result.startAt, record.startAt.toISOString());
    assert.equal(result.proposedStartAt, "2099-01-02T06:00:00.000Z"); assert.equal(result.statusHistory.length, 1);
    assert.equal(h.state.audits.length, 1); assert.equal(h.state.notifications.length, 1);
    assert.equal((await h.request('/appointments/'+record._id+'/status', role, "PUT", { status: "Completed" })).status, 400);
    assert.equal((await h.request(path, role, "PATCH", requestBody())).status, 409);
  } finally { await h.close(); }
});

test("faculty endpoint is role-protected and only the canonical Student proposal response route remains", () => {
  const facultyRoutes = fs.readFileSync(
    new URL("../src/routes/facultyRoutes.js", import.meta.url),
    "utf8",
  );
  const appointmentRoutes = fs.readFileSync(
    new URL("../src/routes/appointmentRoutes.js", import.meta.url),
    "utf8",
  );
  assert.match(
    facultyRoutes,
    /router\.use\(authenticate, authorize\("faculty", "dean"\)\)/,
  );
  assert.match(facultyRoutes, /\/appointments\/:appointmentId\/reschedule/);
  assert.match(appointmentRoutes, /"\/:id\/reschedule-response"/);
  assert.doesNotMatch(appointmentRoutes, /"\/:id\/request-reschedule"/);
  assert.doesNotMatch(appointmentRoutes, /router\.put\("\/:id\/reschedule"/);
});
