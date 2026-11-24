import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import app from "../src/app.js";
import { env } from "../src/config/env.js";
import Appointment from "../src/models/Appointment.js";
import User from "../src/models/User.js";
import SupportingDocument from "../src/models/SupportingDocument.js";

const id = () => new mongoose.Types.ObjectId().toString();
test("Student single details enforce ownership, status link policy, safe metadata and read-only behavior", async () => {
  const student = id(), other = id(), faculty = id(), appointmentId = id(), legacyId = id();
  const originals = { findOne: Appointment.findOne, user: User.findById, docs: SupportingDocument.find };
  const row = { _id: appointmentId, student, faculty: { _id: faculty, firstName: "Faculty", lastName: "Owner", password: "SECRET" }, status: "Confirmed", consultationMode: "Online", subject: "Subject", reason: "Concern", startAt: new Date(), endAt: new Date(Date.now() + 3600000), meetingLink: "https://meeting.example/owned", proposedMeetingLink: "SECRET", reservationToken: "SECRET", decisionLock: true, attendance: { studentResponse: { reason: "SECRET" } }, supportingDocuments: [{ _id: id(), originalName: "safe.pdf", cloudinaryPublicId: "SECRET", data: "SECRET" }, legacyId], supportingDocument: { name: "old.pdf", data: "SECRET" }, scheduleHistory: [{ previous: { meetingLink: "SECRET" }, next: { meetingLink: "SECRET" } }] };
  User.findById = async value => ({ _id: value, id: value, role: String(value) === faculty ? "faculty" : "student", accountStatus: "Active" });
  Appointment.findOne = query => {
    assert.ok([student, other].includes(query.student));
    const chain = { select: () => chain, populate: () => chain, maxTimeMS: () => chain, lean: async () => query.student === student && query._id === appointmentId ? structuredClone(row) : null }; return chain;
  };
  SupportingDocument.find = query => {
    assert.deepEqual(query, { $or: [{ appointment: appointmentId, _id: { $in: [legacyId] } }] });
    const chain = { select: () => chain, lean: async () => [{ _id: legacyId, appointment: appointmentId, originalName: "legacy.pdf", publicId: "SECRET" }] }; return chain;
  };
  const server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const call = async (actor, ref = appointmentId) => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/appointments/student-details/${ref}`, { headers: actor ? { Authorization: `Bearer ${jwt.sign({ sub: actor }, env.jwtSecret)}` } : {} });
    return { status: res.status, data: await res.json(), cache: res.headers.get("cache-control") };
  };
  try {
    assert.equal((await call()).status, 401); assert.equal((await call(faculty)).status, 403);
    assert.equal((await call(other)).status, 404); assert.equal((await call(student, "invalid")).status, 404); assert.equal((await call(student, id())).status, 404);
    for (const status of ["Confirmed", "Completed", "Reschedule Proposed", "Pending", "Rejected", "Cancelled", "Expired", "Attendance Review", "Awaiting Attendance Update"]) {
      row.status = status; const before = structuredClone(row); const result = await call(student);
      assert.equal(result.status, 200); assert.equal(result.cache, "no-store");
      assert.equal(Boolean(result.data.appointment.meetingLink), ["Confirmed", "Completed"].includes(status));
      assert.equal(result.data.appointment.supportingDocuments.length, 2);
      assert.doesNotMatch(JSON.stringify(result.data), /SECRET|reservationToken|decisionLock|studentResponse|proposedMeetingLink|cloudinaryPublicId/);
      assert.deepEqual(row, before);
    }
    row.status = "Confirmed"; row.meetingLink = "javascript:alert(1)"; assert.equal((await call(student)).data.appointment.meetingLink, undefined);
    row.meetingLink = undefined; row.availability = { meetingLink: "https://meeting.example/legacy" };
    assert.equal((await call(student)).data.appointment.meetingLink, row.availability.meetingLink);
  } finally { await new Promise(resolve => server.close(resolve)); Appointment.findOne = originals.findOne; User.findById = originals.user; SupportingDocument.find = originals.docs; }
});
