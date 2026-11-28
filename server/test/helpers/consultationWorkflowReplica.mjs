import assert from "node:assert/strict";
import mongoose from "mongoose";

const { ObjectId } = mongoose.Types;

export async function verifyConsultationWorkflow({ database, request, signIn, deanToken, env }) {
  const imports = "/dean/account-imports";
  const facultyEmail = `pei07-provider@${env.facultyDomain}`;
  const studentEmail = `pei07-learner@${env.studentDomain}`;
  const csv = [
    "Surname,Campus Number,Given Name,Email Address,Kind,Unused",
    `Fixture,FIX-1,Provider,${facultyEmail},faculty,discard`,
    `Fixture,FIX-LEARNER,Learner,${studentEmail},student,discard`,
  ].join("\n");
  const mapping = { columns: [["last_name", 0], ["institutional_id", 1], ["first_name", 2], ["official_email", 3], ["role", 4]] };
  const upload = (contents, columns) => {
    const body = new FormData();
    body.append("file", new Blob([contents], { type: "text/csv" }), "pei07-fixture.csv");
    if (columns) body.append("mapping", JSON.stringify(columns));
    return request(`${imports}/validate`, { token: deanToken, method: "POST", body });
  };
  const confirm = id => request(`${imports}/${id}/confirm`, { token: deanToken, method: "POST" });
  const ok = (result, status = 200) => {
    assert.equal(result.status, status, Buffer.isBuffer(result.body) ? result.contentType : JSON.stringify(result.body));
    return result.body;
  };
  assert.equal((await upload('"unterminated')).status, 400);
  const expired = ok(await upload(csv, mapping));
  assert.equal(expired.canConfirm, true);
  // Age only the disposable preview fixture. Keep purgeAt in the future so TTL cannot hide the expiry check.
  assert.equal((await database.collection("accountimports").updateOne({ previewId: expired.previewId },
    { $set: { expiresAt: new Date(0) } })).modifiedCount, 1);
  assert.equal((await confirm(expired.previewId)).body.code, "PREVIEW_UNAVAILABLE");

  const preview = ok(await upload(csv, mapping));
  assert.equal(preview.canConfirm, true);
  const created = ok(await confirm(preview.previewId), 201);
  assert.deepEqual([created.successfulRows, created.failedRows, created.studentCount, created.facultyCount], [2, 0, 1, 1]);
  const duplicate = ok(await upload(csv, mapping));
  assert.equal(duplicate.canConfirm, false);
  assert.equal((await confirm(duplicate.previewId)).status, 409);
  assert.equal(await database.collection("users").countDocuments({ email: { $in: [facultyEmail, studentEmail] } }), 2);

  const facultyLogin = ok(await signIn("faculty", facultyEmail, "FIX-1"));
  const studentLogin = ok(await signIn("student", studentEmail, "FIX-LEARNER"));
  const { user: faculty, token: facultyToken } = facultyLogin;
  const { user: student, token: studentToken } = studentLogin;
  assert.deepEqual([faculty.role, faculty.employeeId, student.role, student.studentId], ["faculty", "FIX-1", "student", "FIX-LEARNER"]);
  assert.equal((await request("/dean/users", { token: facultyToken })).status, 403);
  assert.equal((await request("/availability/mine", { token: studentToken })).status, 403);

  const publish = async (day, start, end) => ok(await request("/availability", { token: facultyToken, method: "POST", body: {
    startAt: `${day}T${start}:00+08:00`, endAt: `${day}T${end}:00+08:00`, mode: "Face-to-Face", location: "Fixture room",
  } }), 201).availability;
  const historical = await publish("2090-01-15", "00:15", "01:00");
  const reserved = await publish("2090-01-16", "10:00", "11:00");
  const eligible = await publish("2090-01-16", "11:00", "12:00");
  const changed = await publish("2090-01-16", "12:00", "13:00");
  const book = (slot, subject) => request("/appointments", { token: studentToken, method: "POST", body: {
    availabilityId: slot._id, subject, reason: "Review a fictional capstone plan",
  } });
  const appointment = ok(await book(historical, "Fixture capstone review"), 201).appointment;
  assert.equal(appointment.status, "Pending");
  const appointmentId = new ObjectId(appointment._id);
  const appointments = database.collection("appointments");
  const holds = database.collection("onetimescheduleholds");
  const storedBooking = await appointments.findOne({ _id: appointmentId });
  assert.deepEqual([String(storedBooking.availability), storedBooking.status], [historical._id, "Pending"]);
  assert.equal(await holds.countDocuments({ appointment: appointmentId }), 45);
  assert.equal((await book(historical, "Duplicate request")).status, 409);
  assert.equal(await holds.countDocuments({ appointment: appointmentId }), 45);
  assert.equal(ok(await request(`/appointments/requests/${appointment._id}`, { token: facultyToken })).appointment._id, appointment._id);
  const approved = ok(await request(`/appointments/${appointment._id}/status`, { token: facultyToken, method: "PUT",
    body: { status: "Confirmed", expectedVersion: appointment.__v } })).appointment;
  assert.equal(approved.status, "Confirmed");

  // Advance only the existing services' clocks. Booking and approval above used the HTTP routes.
  const now = new Date(Date.parse(historical.endAt) + 60000);
  const { default: AttendanceResponse } = await import("../../src/models/AttendanceResponse.js");
  const { processAttendance } = await import("../../src/services/attendanceService.js");
  const { saveConsultationRecord } = await import("../../src/services/consultationRecordService.js");
  await AttendanceResponse.init();
  await processAttendance({ id: appointment._id, actor: student, input: { outcome: "Completed" }, now });
  await saveConsultationRecord({ appointmentId: appointment._id, actor: faculty, input: { notes: "Fictional review notes" }, now });
  const snapshot = await appointments.findOne({ _id: appointmentId });
  assert.deepEqual([String(snapshot.student), String(snapshot.faculty), snapshot.status, snapshot.attendance.finalOutcome],
    [student.id, faculty.id, "Completed", "Completed"]);
  const studentRecord = ok(await request(`/appointments/${appointment._id}/consultation-record`, { token: studentToken }));
  assert.deepEqual([studentRecord.record.notes, studentRecord.canEdit], ["Fictional review notes", false]);

  const verifyReport = async token => {
    const result = await request("/faculty/reports/pdf", { token, method: "POST", body: { startDate: "2090-01-15", endDate: "2090-01-15", status: "Completed" } });
    const bytes = ok(result);
    assert.match(result.contentType, /^application\/pdf/);
    assert.equal(bytes.subarray(0, 4).toString(), "%PDF");
    assert.match(bytes.subarray(-20).toString(), /%%EOF\s*$/);
  };
  await verifyReport(facultyToken);
  assert.equal((await request("/faculty/reports/pdf", { token: studentToken, method: "POST", body: {} })).status, 403);

  const blocking = ok(await book(reserved, "Fixture semester reservation"), 201).appointment;
  const blockingId = new ObjectId(blocking._id);
  const blockingBefore = await appointments.findOne({ _id: blockingId });
  const mine = async () => new Map(ok(await request("/availability/mine", { token: facultyToken })).availability.map(slot => [slot._id, slot]));
  const before = await mine();
  assert.equal(before.get(reserved._id).protected, true);
  for (const slot of [eligible, changed]) assert.equal(before.get(slot._id).protected, false);
  const update = (slot, expectedVersion, body) => request(`/availability/${slot._id}`, {
    token: facultyToken, method: "PUT", body: { ...body, expectedVersion },
  });
  ok(await update(changed, before.get(changed._id).__v, { location: "Updated fixture room" }));
  ok(await update(eligible, before.get(eligible._id).__v, { isActive: false }));
  assert.equal((await update(changed, before.get(changed._id).__v, { isActive: false })).status, 409);
  assert.equal((await update(reserved, before.get(reserved._id).__v, { isActive: false })).status, 409);
  const after = await mine();
  assert.deepEqual([after.get(eligible._id).isActive, after.get(changed._id).isActive, after.get(reserved._id).isActive], [false, true, true]);
  assert.deepEqual(await appointments.findOne({ _id: blockingId }), blockingBefore);
  assert.deepEqual(await appointments.findOne({ _id: appointmentId }), snapshot);
  await verifyReport(facultyToken);
  console.log("PASS: mapped CSV onboarding, invalid and expired previews, booking and attendance, protected semester availability, stale versions, and retained history and PDF export.");
  return { faculty, studentToken, completedId: appointment._id, slotIds: [historical, reserved, eligible, changed].map(slot => slot._id), verifyReport };
}
