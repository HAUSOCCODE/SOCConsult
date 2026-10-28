import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import mongoose from "mongoose";
import Appointment from "../src/models/Appointment.js";
import AuditLog from "../src/models/AuditLog.js";
import ConsultationRecord from "../src/models/ConsultationRecord.js";
import { readConsultationRecord, saveConsultationRecord } from "../src/services/consultationRecordService.js";

const objectId = () => String(new mongoose.Types.ObjectId());
const clone = value => structuredClone(value);
const query = work => {
  const result = { then: (resolve, reject) => Promise.resolve().then(work).then(resolve, reject) };
  for (const name of ["select", "session", "lean", "populate"]) result[name] = () => result;
  return result;
};
function harness(overrides = {}) {
  const restores = [], student = objectId(), faculty = objectId(), appointmentId = objectId();
  const state = { appointment: { _id: appointmentId, student, faculty, status: "Awaiting Attendance Update",
    startAt: new Date("2026-01-01T01:00:00Z"), endAt: new Date("2026-01-01T02:00:00Z"), attendance: { finalOutcome: "Completed" }, ...overrides }, record: null, audits: [] };
  const patch = (object, key, replacement) => { const original = object[key]; object[key] = replacement; restores.push(() => object[key] = original); };
  patch(mongoose, "startSession", async () => ({ withTransaction: async work => work(), endSession: async () => {} }));
  patch(Appointment, "findById", id => query(() => String(id) === appointmentId ? clone(state.appointment) : null));
  patch(ConsultationRecord, "findOne", filter => query(() => state.record && String(filter.appointment) === appointmentId ? clone(state.record) : null));
  patch(ConsultationRecord, "findById", id => query(() => state.record && String(state.record._id) === String(id) ? { ...clone(state.record), facultyAuthor: { name: "Assigned Faculty" } } : null));
  patch(ConsultationRecord, "create", async ([value]) => {
    if (state.record) throw Object.assign(new Error("duplicate"), { code: 11000 });
    const model = new ConsultationRecord(value); await model.validate();
    state.record = { ...clone(value), _id: String(model._id), __v: 0 };
    return [clone(state.record)];
  });
  patch(ConsultationRecord, "findOneAndUpdate", (filter, update) => query(() => {
    if (!state.record || String(filter._id) !== String(state.record._id) || filter.__v !== state.record.__v) return null;
    Object.assign(state.record, clone(update.$set)); state.record.__v += update.$inc.__v;
    return { ...clone(state.record), facultyAuthor: { name: "Assigned Faculty" } };
  }));
  patch(AuditLog, "create", async records => { for (const record of records) await new AuditLog(record).validate(); state.audits.push(...clone(records)); return records; });
  return { state, student, faculty, appointmentId, restore: () => restores.reverse().forEach(fn => fn()) };
}

test("assigned Faculty creates and updates one trimmed record without mutating appointment or attendance", async () => {
  const h = harness(), now = new Date("2026-01-01T03:00:00Z"), before = clone(h.state.appointment);
  try {
    const created = await saveConsultationRecord({ appointmentId: h.appointmentId, actor: { id: h.faculty, role: "faculty" },
      input: { notes: "  Summary  ", recommendations: "  Review the material  " }, now });
    assert.equal(created.record.notes, "Summary"); assert.equal(created.record.recommendations, "Review the material");
    assert.equal(h.state.record.facultyAuthor, h.faculty); assert.equal(h.state.audits[0].action, "consultation_record_created");
    const createdAt = +new Date(h.state.record.createdAt);
    const updated = await saveConsultationRecord({ appointmentId: h.appointmentId, actor: { id: h.faculty, role: "faculty" },
      input: { notes: "Updated", recommendations: "", expectedVersion: 0 }, now: new Date(+now + 1000) });
    assert.equal(updated.record.version, 1); assert.equal(+new Date(h.state.record.createdAt), createdAt);
    assert.equal(+new Date(h.state.record.updatedAt), +now + 1000); assert.equal(h.state.record.facultyAuthor, h.faculty);
    assert.equal(h.state.audits[1].action, "consultation_record_updated"); assert.deepEqual(h.state.appointment, before);
  } finally { h.restore(); }
});

test("time, lifecycle, ownership, role and Dean management restrictions fail closed", async () => {
  for (const scenario of [
    { actor: "faculty", now: "2026-01-01T01:59:59Z", status: "Awaiting Attendance Update" },
    { actor: "other", now: "2026-01-01T03:00:00Z", status: "Awaiting Attendance Update" },
    { actor: "student", now: "2026-01-01T03:00:00Z", status: "Awaiting Attendance Update" },
    { actor: "faculty", now: "2026-01-01T03:00:00Z", status: "Rejected" },
    { actor: "faculty", now: "2026-01-01T03:00:00Z", status: "Cancelled" },
  ]) {
    const h = harness({ status: scenario.status });
    try {
      const id = scenario.actor === "faculty" ? h.faculty : scenario.actor === "student" ? h.student : objectId();
      await assert.rejects(saveConsultationRecord({ appointmentId: h.appointmentId, actor: { id, role: scenario.actor === "student" ? "student" : "faculty" }, input: { notes: "Note" }, now: new Date(scenario.now) }));
      assert.equal(h.state.record, null);
    } finally { h.restore(); }
  }
  const h = harness();
  try {
    await saveConsultationRecord({ appointmentId: h.appointmentId, actor: { id: h.faculty, role: "dean" }, input: { recommendations: "Recommendation" }, now: new Date("2026-01-01T03:00:00Z") });
    assert.equal(h.state.record.facultyAuthor, h.faculty);
    await assert.rejects(saveConsultationRecord({ appointmentId: h.appointmentId, actor: { id: h.faculty, role: "dean", management: true }, input: { notes: "Replace" }, now: new Date("2026-01-01T03:00:00Z") }));
  } finally { h.restore(); }
});

test("validation allowlist rejects empty, oversized, forged and stale writes", async () => {
  const h = harness(), actor = { id: h.faculty, role: "faculty" }, now = new Date("2026-01-01T03:00:00Z");
  try {
    for (const input of [{ notes: " ", recommendations: "\n" }, { notes: "x".repeat(3001) }, { notes: "ok", facultyAuthor: objectId() },
      { notes: "ok", appointment: objectId() }, { notes: "ok", createdAt: now }, { notes: "ok", status: "Completed" }])
      await assert.rejects(saveConsultationRecord({ appointmentId: h.appointmentId, actor, input, now }));
    await saveConsultationRecord({ appointmentId: h.appointmentId, actor, input: { notes: "Original" }, now });
    await assert.rejects(saveConsultationRecord({ appointmentId: h.appointmentId, actor, input: { notes: "Stale", expectedVersion: 4 }, now }));
    assert.equal(h.state.record.notes, "Original"); assert.equal(h.state.audits.length, 1);
  } finally { h.restore(); }
});

test("only assigned participants read the professional record and Student cannot write", async () => {
  const h = harness(), now = new Date("2026-01-01T03:00:00Z");
  try {
    await saveConsultationRecord({ appointmentId: h.appointmentId, actor: { id: h.faculty, role: "faculty" }, input: { notes: "Participant visible" }, now });
    const student = await readConsultationRecord({ appointmentId: h.appointmentId, actor: { id: h.student, role: "student" }, now });
    assert.equal(student.record.notes, "Participant visible"); assert.equal(student.canEdit, false);
    await assert.rejects(readConsultationRecord({ appointmentId: h.appointmentId, actor: { id: objectId(), role: "student" }, now }), /not found/);
    await assert.rejects(readConsultationRecord({ appointmentId: h.appointmentId, actor: { id: objectId(), role: "faculty" }, now }), /not found/);
    assert.doesNotMatch(JSON.stringify(student), /attendance|password|audit/);
  } finally { h.restore(); }
});

test("FAC-12 UI is scoped to notes and recommendations with Faculty edit and Student read-only rendering", async () => {
  const [form, view, student, facultyDetails, studentDetails, service] = await Promise.all([
    readFile(new URL("../../client/src/components/consultations/ConsultationRecordForm.jsx", import.meta.url), "utf8"),
    readFile(new URL("../../client/src/components/consultations/ConsultationRecordView.jsx", import.meta.url), "utf8"),
    readFile(new URL("../../client/src/components/consultations/StudentConsultationRecord.jsx", import.meta.url), "utf8"),
    readFile(new URL("../../client/src/components/appointments/PersonalConsultationDetails.jsx", import.meta.url), "utf8"),
    readFile(new URL("../../client/src/components/appointments/StudentAppointmentDetailsModal.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/services/consultationRecordService.js", import.meta.url), "utf8"),
  ]);
  assert.match(form, /Consultation Notes \/ Summary/); assert.match(form, /Recommendations/); assert.match(form, /Saving\.\.\./);
  assert.match(form, /pending\.current/); assert.match(form, /expectedVersion/); assert.match(view, /Date recorded/); assert.match(view, /Last updated/);
  assert.match(facultyDetails, /ConsultationRecordForm/); assert.match(studentDetails, /StudentConsultationRecord/);
  assert.doesNotMatch(student, /textarea|method:\s*"PUT"/);
  assert.doesNotMatch(form + view + student, /action.?item|assignee|dueDate|priority|mark complete/i);
  assert.doesNotMatch(service, /req\.body|Object\.assign\(.*input|attendance\s*:/);
});
