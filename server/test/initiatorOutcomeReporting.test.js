import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import cloudinary from "../src/config/cloudinary.js";
import { attendanceEnrollment, INITIATOR_ATTENDANCE_POLICY } from "../src/config/attendance.js";
import { disputeInitiatorOutcome, processAttendance, readAttendance, readOutcomeProof } from "../src/services/attendanceService.js";
import { appointmentHarness, fixture } from "./helpers/appointmentHarness.js";
import { detectOutcomeProofType } from "../src/middleware/outcomeProofUpload.js";

const setup = initiatedByRole => {
  const harness = appointmentHarness();
  const appointment = fixture({ status: "Confirmed", initiatedByRole });
  appointment.attendance = attendanceEnrollment(appointment.endAt, { initiatedByRole });
  harness.state.appointments.push(appointment);
  return { harness, appointment, now: new Date(appointment.endAt), actor: role => ({ id: appointment[role], role }) };
};

test("new attendance enrollment records the immutable original initiator", () => {
  assert.equal(attendanceEnrollment(new Date(), { initiatedByRole: "student" }).policyVersion, INITIATOR_ATTENDANCE_POLICY);
  assert.equal(attendanceEnrollment(new Date(), { initiatedByRole: "faculty" }).initiatorRole, "faculty");
  assert.equal(attendanceEnrollment(new Date()).initiatorRole, undefined, "legacy fixtures remain two-party");
});

test("proof signatures accept JPEG, PNG, and WebP content and reject forged bytes", () => {
  assert.equal(detectOutcomeProofType(Buffer.from([0xff, 0xd8, 0xff, 0xd9])), "image/jpeg");
  assert.equal(detectOutcomeProofType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
  assert.equal(detectOutcomeProofType(Buffer.from("RIFF0000WEBP", "ascii")), "image/webp");
  assert.equal(detectOutcomeProofType(Buffer.from("<script>not an image</script>")), null);
});

for (const initiatorRole of ["student", "faculty"]) test(`${initiatorRole} initiator finalizes a no-show outcome without a second response`, async () => {
  const current = setup(initiatorRole);
  try {
    const otherRole = initiatorRole === "student" ? "faculty" : "student";
    await assert.rejects(processAttendance({ id: current.appointment._id, actor: current.actor(otherRole),
      input: { outcome: "Completed" }, now: current.now }), /original consultation initiator/);
    await processAttendance({ id: current.appointment._id, actor: current.actor(initiatorRole),
      input: { outcome: otherRole === "student" ? "Student No-show" : "Faculty No-show", reason: "Did not attend" }, now: current.now });
    assert.equal(current.harness.state.responses.length, 1);
    assert.equal(current.harness.state.appointments[0].status, "Completed");
    assert.equal(current.harness.state.appointments[0].attendance.finalizationSource, "initiator_report");
    const view = await readAttendance({ id: current.appointment._id, actor: current.actor(otherRole), now: current.now });
    assert.equal(view.recordedOutcome.reportedByRole, initiatorRole);
    assert.equal(view.recordedOutcome.outcome, current.harness.state.responses[0].outcome);
    assert.equal(view.eligible, false);
  } finally { current.harness.restore(); }
});

test("Completed accepts optional proof and stores only controlled metadata when attached", async () => {
  const withoutProof = setup("student");
  try {
    await processAttendance({ id: withoutProof.appointment._id, actor: withoutProof.actor("student"),
      input: { outcome: "Completed" }, now: withoutProof.now });
    assert.equal(withoutProof.harness.state.appointments[0].status, "Completed");
    assert.equal(withoutProof.harness.state.responses[0].proof, undefined);
  } finally { withoutProof.harness.restore(); }

  const current = setup("student");
  const oldUpload = cloudinary.uploader.upload_stream;
  cloudinary.uploader.upload_stream = (_options, callback) => ({ end: () => callback(null, {
    secure_url: "https://provider.invalid/private", public_id: "consultio/outcome-proofs/private-id", resource_type: "image",
  }) });
  try {
    const proofFile = { originalname: "proof.jpg", mimetype: "image/jpeg", size: 4,
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) };
    await processAttendance({ id: current.appointment._id, actor: current.actor("student"),
      input: { outcome: "Completed", proofFile }, now: current.now });
    const stored = current.harness.state.responses[0];
    assert.equal(stored.proof.mimeType, "image/jpeg");
    assert.doesNotMatch(JSON.stringify(stored), /secure_url|provider\.invalid|buffer/);
    assert.equal((await readOutcomeProof({ id: current.appointment._id, actor: current.actor("faculty") })).mimeType, "image/jpeg");
    assert.equal((await readOutcomeProof({ id: current.appointment._id,
      actor: { id: "000000000000000000000001", role: "dean", management: true } })).mimeType, "image/jpeg");
    await assert.rejects(readOutcomeProof({ id: current.appointment._id,
      actor: { id: "000000000000000000000002", role: "student" } }), /not found/);
  } finally { cloudinary.uploader.upload_stream = oldUpload; current.harness.restore(); }
});

test("untouched legacy attendance with explicit initiator safely adopts initiator-only reporting", async () => {
  const current = setup("student");
  current.appointment.attendance = attendanceEnrollment(current.appointment.endAt);
  try {
    const facultyView = await readAttendance({ id: current.appointment._id,
      actor: current.actor("faculty"), now: current.now });
    assert.equal(facultyView.workflow, "initiator_report");
    assert.equal(facultyView.eligible, false);
    await assert.rejects(processAttendance({ id: current.appointment._id, actor: current.actor("faculty"),
      input: { outcome: "Completed" }, now: current.now }), /original consultation initiator/);
    await processAttendance({ id: current.appointment._id, actor: current.actor("student"),
      input: { outcome: "Completed" }, now: current.now });
    assert.equal(current.harness.state.appointments[0].attendance.policyVersion, INITIATOR_ATTENDANCE_POLICY);
    assert.equal(current.harness.state.responses.length, 1);
  } finally { current.harness.restore(); }
});

test("initiator policy rejects early and duplicate outcome submissions", async () => {
  const current = setup("student");
  try {
    await assert.rejects(processAttendance({ id: current.appointment._id, actor: current.actor("student"),
      input: { outcome: "Student No-show" }, now: new Date(+current.now - 1) }), /not opened/);
    await processAttendance({ id: current.appointment._id, actor: current.actor("student"),
      input: { outcome: "Student No-show" }, now: current.now });
    await assert.rejects(processAttendance({ id: current.appointment._id, actor: current.actor("student"),
      input: { outcome: "Faculty No-show" }, now: current.now }), /unavailable|already/);
  } finally { current.harness.restore(); }
});

test("non-initiator can dispute without creating a competing attendance response", async () => {
  const current = setup("student");
  try {
    await processAttendance({ id: current.appointment._id, actor: current.actor("student"),
      input: { outcome: "Faculty No-show" }, now: current.now });
    await assert.rejects(disputeInitiatorOutcome({ id: current.appointment._id,
      actor: current.actor("student"), reason: "Self dispute", now: current.now }), /cannot dispute their own/);
    await disputeInitiatorOutcome({ id: current.appointment._id, actor: current.actor("faculty"),
      reason: "The report is inaccurate", now: new Date(+current.now + 1) });
    assert.equal(current.harness.state.responses.length, 1);
    assert.equal(current.harness.state.appointments[0].status, "Attendance Review");
    assert.equal(current.harness.state.appointments[0].attendance.reviewReason, "initiator_report_disputed");
    assert.equal(current.harness.state.appointments[0].attendance.finalOutcome, null);
  } finally { current.harness.restore(); }
});

test("image proof middleware and both role UIs enforce the initiator policy contract", async () => {
  const [middleware, student, faculty, studentDetails, studentView, facultyView] = await Promise.all([
    readFile(new URL("../src/middleware/outcomeProofUpload.js", import.meta.url), "utf8"),
    readFile(new URL("../../client/src/components/attendance/StudentAttendanceResponseForm.jsx", import.meta.url), "utf8"),
    readFile(new URL("../../client/src/components/attendance/FacultyAttendanceForm.jsx", import.meta.url), "utf8"),
    readFile(new URL("../../client/src/components/appointments/StudentAppointmentDetailsModal.jsx", import.meta.url), "utf8"),
    readFile(new URL("../../client/src/components/appointments/StudentConsultationsView.jsx", import.meta.url), "utf8"),
    readFile(new URL("../../client/src/components/appointments/FacultyConsultationsView.jsx", import.meta.url), "utf8"),
  ]);
  assert.match(middleware, /5 \* 1024 \* 1024/);
  assert.match(middleware, /RIFF/); assert.match(middleware, /image\/jpeg/); assert.match(middleware, /image\/png/); assert.match(middleware, /image\/webp/);
  for (const form of [student, faculty]) {
    assert.match(form, /Attach Photo Proof \(Optional\)/);
    assert.match(form, /allowProof/);
    assert.doesNotMatch(form, /proof before reporting a completed consultation/);
  }
  assert.match(faculty, /FormData/); assert.match(studentDetails, /FormData/);
  assert.match(studentView, /Awaiting Faculty Outcome Report/);
  assert.match(facultyView, /Awaiting Student Outcome Report/);
});
