import assert from "node:assert/strict";
import { test } from "node:test";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import app from "../src/app.js";
import { env } from "../src/config/env.js";
import Appointment from "../src/models/Appointment.js";
import Availability from "../src/models/Availability.js";
import Notification from "../src/models/Notification.js";
import AuditLog from "../src/models/AuditLog.js";
import User from "../src/models/User.js";
import OneTimeScheduleHold from "../src/models/OneTimeScheduleHold.js";

const patch = (target, key, replacement, restores) => {
  const original = target[key];
  target[key] = replacement;
  restores.push(() => { target[key] = original; });
};
const chain = (value) => {
  const query = { then: (resolve, reject) => Promise.resolve(value).then(resolve, reject) };
  for (const method of ["select", "populate", "lean"]) query[method] = () => query;
  return query;
};
const startServer = () => new Promise((resolve) => {
  const server = app.listen(0, "127.0.0.1", () => resolve(server));
});

test("Student proposal responses are exact, owner-only, atomic, conflict-safe, and private", async () => {
  const restores = [];
  const ids = Object.fromEntries(["student", "other", "faculty", "appointment", "originalSlot", "proposalSlot"].map((key) => [key, new mongoose.Types.ObjectId()]));
  const users = new Map([
    [String(ids.student), { _id: ids.student, id: String(ids.student), role: "student", name: "Student", accountStatus: "Active" }],
    [String(ids.other), { _id: ids.other, id: String(ids.other), role: "student", name: "Other", accountStatus: "Active" }],
  ]);
  const futureStart = new Date(Date.now() + 7_200_000);
  const futureEnd = new Date(Date.now() + 10_800_000);
  const originalStart = new Date(Date.now() + 3_600_000);
  const originalEnd = new Date(Date.now() + 5_400_000);
  const originalToken = "original-owned-token";
  let proposalToken;
  let failUpdate = false;
  let status = "Reschedule Proposed";
  let current = {
    _id: ids.appointment,
    id: String(ids.appointment),
    student: ids.student,
    faculty: ids.faculty,
    availability: ids.originalSlot,
    reservationToken: originalToken,
    status,
    startAt: originalStart,
    endAt: originalEnd,
    consultationMode: "Face-to-Face",
    location: "Room 201",
    meetingPlatform: "",
    proposedAvailability: ids.proposalSlot,
    proposedStartAt: futureStart,
    proposedEndAt: futureEnd,
    proposedConsultationMode: "Online",
    proposedLocation: "",
    proposedMeetingPlatform: "Microsoft Teams",
    proposedMeetingLink: "https://example.invalid/private-proposal",
    proposalNote: "Faculty conflict with the original schedule.",
    proposedAt: new Date(),
    proposedBy: ids.faculty,
    updatedAt: new Date(),
  };
  const updates = [];
  const released = [];
  const notifications = [];
  patch(User, "findById", async (id) => users.get(String(id)) || null, restores);
  patch(Appointment, "findOne", (query) => chain(
    String(query._id) === String(ids.appointment) && String(query.student) === String(ids.student)
      ? { ...current }
      : null,
  ), restores);
  patch(Appointment, "exists", async () => null, restores);
  patch(OneTimeScheduleHold, "exists", async () => null, restores);
  patch(Availability, "findOneAndUpdate", (query, update) => {
    if (String(query._id) !== String(ids.proposalSlot) || proposalToken) return chain(null);
    proposalToken = update.$set.reservationToken;
    return chain({ _id: ids.proposalSlot, id: String(ids.proposalSlot), faculty: ids.faculty, startAt: futureStart, endAt: futureEnd, isActive: true, mode: "Online", meetingPlatform: "Microsoft Teams", meetingLink: "https://example.invalid/private-proposal" });
  }, restores);
  patch(Availability, "updateOne", async (query) => {
    released.push(query);
    if (query.reservationToken === proposalToken) proposalToken = undefined;
    return { modifiedCount: 1 };
  }, restores);
  patch(Appointment, "findOneAndUpdate", async (query, update) => {
    if (failUpdate) throw new Error("simulated response persistence failure");
    if (status !== "Reschedule Proposed" || String(query.student) !== String(ids.student)) return null;
    status = update.$set.status;
    updates.push(update);
    current = { ...current, ...update.$set, status, scheduleHistory: [update.$push.scheduleHistory] };
    return { ...current, toObject: () => ({ ...current }) };
  }, restores);
  patch(Notification, "create", async (record) => { notifications.push(record); return record; }, restores);
  patch(AuditLog, "create", async (record) => record, restores);

  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}/api/appointments/${ids.appointment}`;
  const token = (id) => jwt.sign({ sub: String(id) }, env.jwtSecret);
  const respond = (student, decision, extra = {}) => fetch(`${base}/reschedule-response`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token(student)}`, "Content-Type": "application/json", Connection: "close" },
    body: JSON.stringify({ decision, startAt: new Date(0), endAt: new Date(1), availabilityId: ids.originalSlot, mode: "Face-to-Face", location: "Spoofed", ...extra }),
  });
  try {
    assert.equal((await respond(ids.other, "accept")).status, 404);
    failUpdate = true;
    assert.equal((await respond(ids.student, "accept")).status, 500);
    assert.equal(proposalToken, undefined, "a failed Appointment update releases only its proposal claim");
    assert.equal(status, "Reschedule Proposed");
    failUpdate = false;
    const [first, second] = await Promise.all([respond(ids.student, "accept"), respond(ids.student, "accept")]);
    assert.deepEqual([first.status, second.status].sort(), [200, 409]);
    const success = first.status === 200 ? await first.json() : await second.json();
    assert.equal(status, "Confirmed");
    assert.equal(updates.length, 1);
    assert.equal(updates[0].$set.startAt.getTime(), futureStart.getTime());
    assert.equal(updates[0].$set.endAt.getTime(), futureEnd.getTime());
    assert.equal(updates[0].$set.consultationMode, "Online");
    assert.equal(updates[0].$set.location, "Microsoft Teams");
    assert.equal(updates[0].$push.scheduleHistory.previous.startAt.getTime(), originalStart.getTime());
    assert.equal(updates[0].$push.scheduleHistory.next.startAt.getTime(), futureStart.getTime());
    assert.equal(updates[0].$push.scheduleHistory.response, "Accepted");
    assert.equal(notifications.length, 1);
    assert.equal("reservationToken" in success.appointment, false);
    assert.equal("proposedMeetingLink" in success.appointment, false);
    assert.equal(released.some((query) => query.reservationToken === originalToken), true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    restores.reverse().forEach((restore) => restore());
  }
});

test("accept and reject preserve proposal history while cancellation uses the canonical endpoint", async () => {
  const source = await import("node:fs").then(({ readFileSync }) => readFileSync(new URL("../src/routes/appointmentRoutes.js", import.meta.url), "utf8"));
  assert.match(source, /"\/:id\/reschedule-response"/);
  assert.doesNotMatch(source, /"\/:id\/request-reschedule"/);
  assert.doesNotMatch(source, /router\.put\("\/:id\/reschedule"/);
  const handler = source.slice(source.indexOf('router.put("/:id/reschedule-response"'));
  assert.match(handler, /decision === "accept" \? "Confirmed" : "Pending"/);
  assert.match(handler, /response: decision === "accept" \? "Accepted" : "Rejected"/);
  assert.doesNotMatch(handler, /decision === "cancel"/);
  assert.match(handler, /student: req\.user\.id/);
  assert.match(handler, /status: "Reschedule Proposed"/);
  assert.doesNotMatch(handler, /req\.body\.(startAt|endAt|availabilityId|mode|location|meetingPlatform)/);
  assert.match(source, /router\.put\("\/:id\/cancel"/);
});

test("reject returns to Pending with one history entry and notification", async () => {
  const restores = [];
  const student = new mongoose.Types.ObjectId();
  const faculty = new mongoose.Types.ObjectId();
  const records = new Map();
  const releases = [];
  for (const decision of ["reject"]) {
    const id = new mongoose.Types.ObjectId();
    records.set(String(id), {
      _id: id,
      id: String(id),
      student,
      faculty,
      status: "Reschedule Proposed",
      startAt: new Date(Date.now() + 3_600_000),
      endAt: new Date(Date.now() + 5_400_000),
      consultationMode: "Online",
      meetingPlatform: "Zoom",
      proposedStartAt: new Date(Date.now() + 7_200_000),
      proposedEndAt: new Date(Date.now() + 9_000_000),
      proposedConsultationMode: "Face-to-Face",
      proposedLocation: "Room 301",
      proposalNote: "Faculty schedule adjustment.",
      proposedAt: new Date(),
      proposedBy: faculty,
      decision,
    });
  }
  const notifications = [];
  patch(User, "findById", async () => ({ _id: student, id: String(student), role: "student", name: "Student", accountStatus: "Active" }), restores);
  patch(Appointment, "findOne", (query) => chain(
    String(query.student) === String(student) ? records.get(String(query._id)) || null : null,
  ), restores);
  patch(Appointment, "findOneAndUpdate", async (query, update) => {
    const record = records.get(String(query._id));
    if (!record || record.status !== "Reschedule Proposed") return null;
    record.status = update.$set.status;
    record.history = update.$push.scheduleHistory;
    return { ...record, toObject: () => ({ ...record }) };
  }, restores);
  patch(Availability, "updateOne", async (query) => {
    releases.push(query);
    return { modifiedCount: 1 };
  }, restores);
  patch(Notification, "create", async (record) => { notifications.push(record); return record; }, restores);
  patch(AuditLog, "create", async (record) => record, restores);
  const server = await startServer();
  const token = jwt.sign({ sub: String(student) }, env.jwtSecret);
  try {
    for (const record of records.values()) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/appointments/${record.id}/reschedule-response`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Connection: "close" },
        body: JSON.stringify({ decision: record.decision, startAt: new Date(0), availabilityId: new mongoose.Types.ObjectId() }),
      });
      assert.equal(response.status, 200);
      assert.equal(record.status, "Pending");
      assert.equal(record.history.response, "Rejected");
      assert.equal(record.history.previous.startAt instanceof Date, true);
      assert.equal(record.history.next.startAt instanceof Date, true);
    }
    assert.equal(notifications.length, 1);
    assert.equal(releases.length, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    restores.reverse().forEach((restore) => restore());
  }
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
