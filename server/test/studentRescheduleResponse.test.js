import assert from "node:assert/strict";
import { test } from "node:test";
import Appointment from "../src/models/Appointment.js";
import { appointmentHttp } from "./helpers/appointmentHttp.js";
import { fixture, addSlot } from "./helpers/appointmentHarness.js";

test("Student proposal response uses identity, ownership, archived schedules and exactly one event", async () => {
  const h = await appointmentHttp();
  try {
    for (const decision of ["accept", "reject"]) {
      const record = fixture({ status: "Reschedule Proposed", student: h.users.student.id, faculty: h.users.faculty.id,
        proposedAt: new Date(), proposedStartAt: new Date("2099-02-01"), proposedEndAt: new Date("2099-02-01T00:30:00Z"),
        proposedConsultationMode: "Face-to-Face", proposedLocation: "Office", proposedBy: h.users.faculty.id });
      h.state.appointments.push(record); addSlot(h, record);
      const path = '/appointments/'+record._id+'/reschedule-response';
      const body = { decision, proposedAt: record.proposedAt, expectedVersion: 0, startAt: new Date(0), location: "Spoofed" };
      assert.equal((await h.request(path, "otherStudent", "PUT", body)).status, 404);
      assert.equal((await h.request(path, "student", "PUT", { ...body, proposedAt: new Date(0) })).status, 409);
      const response = await h.request(path, "student", "PUT", body); assert.equal(response.status, 200);
      const result = (await response.json()).appointment;
      assert.equal(result.status, decision === "accept" ? "Confirmed" : "Pending");
      assert.equal(result.scheduleHistory.length, 1); assert.equal(result.statusHistory.length, 1);
      assert.equal(result.proposedStartAt, undefined); assert.equal(result.reservationToken, undefined);
      assert.equal((await h.request(path, "student", "PUT", body)).status, 409);
    }
    assert.equal(h.state.audits.length, 2); assert.equal(h.state.notifications.length, 4);
    assert.equal(h.state.notifications.filter(notification => notification.type === "reschedule_response_recorded").length, 2);
  } finally { await h.close(); }
});

test("proposal schema separates current and proposed schedules and excludes private links by default", () => {
  for (const path of ["proposedStartAt", "proposedEndAt", "proposedConsultationMode", "proposedLocation", "proposedMeetingPlatform", "proposalNote", "proposedAt", "proposedBy"])
    assert.ok(Appointment.schema.path(path), `${path} must exist`);
  assert.equal(Appointment.schema.path("proposedMeetingLink").options.select, false);
  assert.equal(Appointment.schema.path("reservationToken").options.select, false);
  assert.equal(Appointment.schema.path("scheduleHistory.response").enumValues.includes("Accepted"), true);
  assert.equal(Appointment.schema.path("scheduleHistory.next.meetingLink"), undefined);
});

test("Student proposal UI is read-only and exposes all three responses", async () => {
  const { readFileSync } = await import("node:fs");
  const modal = readFileSync(new URL("../../client/src/components/appointments/StudentRescheduleResponseModal.jsx", import.meta.url), "utf8");
  const view = readFileSync(new URL("../../client/src/components/appointments/StudentConsultationsView.jsx", import.meta.url), "utf8");
  assert.match(modal, /Original Schedule/);
  assert.match(modal, /Proposed Schedule/);
  assert.match(modal, /Faculty Note \/ Reason/);
  assert.match(modal, /Accept Proposal/);
  assert.match(modal, /Reject Proposal/);
  assert.match(modal, /Cancel Consultation/);
  assert.doesNotMatch(modal, /type="date|datetime-local|availabilityId/);
  assert.match(view, /Respond to Proposal/);
});
