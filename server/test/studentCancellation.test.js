import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import Appointment from "../src/models/Appointment.js";
import { appointmentHttp } from "./helpers/appointmentHttp.js";
import { fixture, addSlot } from "./helpers/appointmentHarness.js";

test("Student cancellation is owner-only, pre-start, transactional and private through HTTP", async () => {
  const h = await appointmentHttp();
  try {
    for (const status of ["Pending", "Confirmed", "Reschedule Proposed"]) {
      const record = fixture({ status, student: h.users.student.id, faculty: h.users.faculty.id });
      if (status === "Reschedule Proposed") Object.assign(record, { proposedAt: new Date(), proposedBy: record.faculty,
        proposedStartAt: new Date("2099-02-01"), proposedEndAt: new Date("2099-02-01T00:30:00Z"), proposedConsultationMode: "Face-to-Face", proposedLocation: "Office" });
      h.state.appointments.push(record); addSlot(h, record);
      assert.equal((await h.request('/appointments/'+record._id+'/cancel', "otherStudent", "PUT", {})).status, 404);
      const response = await h.request('/appointments/'+record._id+'/cancel', "student", "PUT", { reason: "Unavailable", expectedVersion: 0 });
      assert.equal(response.status, 200);
      const result = (await response.json()).appointment;
      assert.equal(result.status, "Cancelled"); assert.equal(result.reservationToken, undefined);
      assert.equal(result.statusHistory.length, 1);
      assert.equal((await h.request('/appointments/'+record._id+'/cancel', "student", "PUT", {})).status, 409);
    }
    assert.equal(h.state.audits.length, 3); assert.equal(h.state.notifications.length, 3);
    const started = fixture({ student: h.users.student.id, startAt: new Date(0) }); h.state.appointments.push(started);
    assert.equal((await h.request('/appointments/'+started._id+'/cancel', "student", "PUT", {})).status, 409);
  } finally { await h.close(); }
});

test("cancellation schema and Student UI expose one canonical bounded flow", () => {
  assert.ok(Appointment.schema.path("statusHistory"));
  assert.equal(Appointment.schema.path("cancellationReason").options.maxlength, 500);
  assert.ok(Appointment.schema.path("cancelledBy"));
  assert.ok(Appointment.schema.path("cancelledAt"));
  const routes = readFileSync(new URL("../src/routes/appointmentRoutes.js", import.meta.url), "utf8");
  const view = readFileSync(new URL("../../client/src/components/appointments/StudentConsultationsView.jsx", import.meta.url), "utf8");
  const proposal = readFileSync(new URL("../../client/src/components/appointments/StudentRescheduleResponseModal.jsx", import.meta.url), "utf8");
  const status = readFileSync(new URL("../../client/src/utils/appointmentStatus.js", import.meta.url), "utf8");
  assert.equal((routes.match(/router\.put\("\/:id\/cancel"/g) || []).length, 1);
  assert.match(routes, /transitionAppointment/);
  assert.doesNotMatch(routes.slice(routes.indexOf('router.put("/:id/reschedule-response"')), /decision === "cancel"/);
  assert.match(view, /Cancellation Reason \(Optional\)/);
  assert.match(view, /canStudentCancelAppointment/);
  assert.match(proposal, /onCancelConsultation/);
  assert.match(status, /"Pending",[\s\S]*"Reschedule Proposed",[\s\S]*"Confirmed"/);
  assert.doesNotMatch(routes.slice(routes.indexOf('router.put("/:id/cancel"'), routes.indexOf('router.put("/:id/reschedule-response"')), /deleteOne|findByIdAndDelete|findOneAndDelete|deleteMany/);
});
