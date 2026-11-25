import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { appointmentHttp } from "./helpers/appointmentHttp.js";
import { fixture, clone } from "./helpers/appointmentHarness.js";
import { safeAppointment } from "../src/services/appointmentTransitionService.js";
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

test("ordinary appointment responses keep file metadata and omit storage references", async () => {
  const h = await appointmentHttp();
  const docId = "507f1f77bcf86cd799439011";
  const legacy = "507f1f77bcf86cd799439012";
  const embedded = { _id: docId, originalName: "notes.pdf", mimeType: "application/pdf", size: 12,
    cloudinaryUrl: "https://storage.test/private", cloudinaryPublicId: "provider-id", resourceType: "raw" };
  const malformed = { cloudinaryUrl: "https://storage.test/private", data: "confidential" };
  const old = { name: "historical.txt", mimeType: "text/plain", size: 4, data: "data:text/plain;base64,dGVzdA==" };
  const safeMetadata = { _id: docId, originalName: "notes.pdf", mimeType: "application/pdf", size: 12 };
  try {
    const record = fixture({ student: h.users.student.id, faculty: h.users.faculty.id, bookingMethod: "schedule_request",
      supportingDocuments: [embedded, malformed], supportingDocument: old });
    h.state.appointments.push(record);
    const mutation = JSON.parse(JSON.stringify(safeAppointment({ ...record, supportingDocuments: [embedded, malformed, legacy] }, "student")));
    assert.deepEqual(mutation.supportingDocuments, [safeMetadata, legacy]);
    assert.equal(safeAppointment({ supportingDocuments: malformed }, "student").supportingDocuments, undefined);
    for (const [path, role, key] of [["/appointments/mine", "student", "appointments"], ["/schedule-requests/mine", "faculty", "requests"]]) {
      const response = await h.request(path, role);
      assert.equal(response.status, 200);
      const [appointment] = (await response.json())[key];
      assert.deepEqual(appointment.supportingDocuments, [safeMetadata]);
      assert.deepEqual(appointment.supportingDocument, { name: old.name, mimeType: old.mimeType, size: old.size });
    }
    assert.equal(record.supportingDocuments[0].cloudinaryPublicId, "provider-id");
    assert.equal(record.supportingDocument.data, old.data);
  } finally { await h.close(); }
});
