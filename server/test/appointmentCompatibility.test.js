import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { appointmentHttp } from "./helpers/appointmentHttp.js";
import { fixture, clone } from "./helpers/appointmentHarness.js";
import { LEGACY_APPOINTMENT_STATUSES, getAppointmentDisplayStatus, getStudentConsultationGroup, canStudentCancelAppointment } from "../../client/src/utils/appointmentStatus.js";

test("legacy labels preserve exact status and unsupported actions remain disabled without mutation", async () => {
  const h = await appointmentHttp();
  try {
    for (const status of LEGACY_APPOINTMENT_STATUSES) {
      const record = fixture({ status, student: h.users.student.id, faculty: h.users.dean.id });
      h.state.appointments.push(record);
      assert.equal(getAppointmentDisplayStatus(record), `${status} (Legacy)`);
      assert.equal(getStudentConsultationGroup(status), "legacy"); assert.equal(canStudentCancelAppointment(record), false);
      assert.equal((await h.request('/appointments/'+record._id+'/status', "dean", "PUT", { status: "Confirmed" })).status, 409);
    }
    const before = clone(h.state.appointments);
    const response = await h.request('/appointments/mine'); assert.equal(response.status, 200);
    assert.equal((await response.json()).appointments.length, LEGACY_APPOINTMENT_STATUSES.length);
    assert.deepEqual(h.state.appointments, before); assert.equal(h.state.audits.length, 0);
    const availabilitySource = await readFile(new URL("../src/controllers/availabilityController.js", import.meta.url), "utf8");
    const dashboardSource = await readFile(new URL("../src/routes/dashboardRoutes.js", import.meta.url), "utf8");
    assert.doesNotMatch(availabilitySource + dashboardSource, /processExpiredAvailability/);
  } finally { await h.close(); }
});
