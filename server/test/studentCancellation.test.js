import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("Student cancellation is owner-only, status/time bounded, atomic, history-preserving, and private", async () => {
  const restores = [];
  const student = new mongoose.Types.ObjectId();
  const otherStudent = new mongoose.Types.ObjectId();
  const faculty = new mongoose.Types.ObjectId();
  const future = () => new Date(Date.now() + 7_200_000);
  const later = () => new Date(Date.now() + 10_800_000);
  const records = new Map();
  const make = (status, overrides = {}) => {
    const _id = new mongoose.Types.ObjectId();
    const availability = new mongoose.Types.ObjectId();
    const record = {
      _id, id: String(_id), student, faculty, availability,
      reservationToken: `owned-${_id}`,
      status, startAt: future(), endAt: later(),
      consultationMode: "Online", meetingPlatform: "Microsoft Teams",
      meetingLink: "https://example.invalid/private",
      statusHistory: [], scheduleHistory: [], updatedAt: new Date(),
      ...overrides,
    };
    records.set(String(_id), record);
    return record;
  };
  const pending = make("Pending");
  const confirmed = make("Confirmed");
  const proposal = make("Reschedule Proposed", {
    proposedAvailability: new mongoose.Types.ObjectId(),
    proposedStartAt: future(), proposedEndAt: later(),
    proposedConsultationMode: "Face-to-Face", proposedLocation: "Room 201",
    proposedMeetingPlatform: "", proposedMeetingLink: "https://example.invalid/proposal",
    proposalNote: "Faculty schedule conflict.", proposedAt: new Date(), proposedBy: faculty,
    scheduleHistory: [{ response: "Accepted", reason: "Earlier history" }],
  });
  const ineligible = ["Rejected", "Cancelled", "Expired", "Awaiting Attendance Update", "Attendance Review", "Completed"].map((status) => make(status));
  const pastPending = make("Pending", { startAt: new Date(Date.now() - 60_000) });
  const pastConfirmed = make("Confirmed", { startAt: new Date(Date.now() - 60_000) });
  const staleProposal = make("Reschedule Proposed", { proposedStartAt: new Date(Date.now() - 60_000), proposedEndAt: future() });
  const tokenless = make("Pending", { reservationToken: undefined });
  const releaseFailure = make("Confirmed");
  const concurrent = make("Pending");
  const releases = [];
  const notifications = [];
  let failReleaseFor = "";

  patch(User, "findById", async (id) => ({ _id: id, id: String(id), role: "student", name: "Student", accountStatus: "Active" }), restores);
  patch(Appointment, "findOne", (query) => chain(
    String(query.student) === String(student) && records.get(String(query._id))
      ? { ...records.get(String(query._id)) }
      : null,
  ), restores);
  patch(Appointment, "findOneAndUpdate", async (query, update) => {
    const record = records.get(String(query._id));
    if (!record || String(record.student) !== String(query.student) || record.status !== query.status) return null;
    if (record.startAt <= query.startAt.$gt || record.updatedAt?.getTime() !== new Date(query.updatedAt).getTime()) return null;
    if (query.proposedAt && record.proposedAt?.getTime() !== new Date(query.proposedAt).getTime()) return null;
    record.status = update.$set.status;
    Object.assign(record, update.$set);
    record.statusHistory.push(update.$push.statusHistory);
    if (update.$push.scheduleHistory) record.scheduleHistory.push(update.$push.scheduleHistory);
    for (const key of Object.keys(update.$unset || {})) delete record[key];
    return { ...record, toObject: () => ({ ...record }) };
  }, restores);
  patch(Appointment, "updateOne", async (query, update) => {
    const record = records.get(String(query._id));
    if (!record || record.status !== query.status || record.cancelledAt?.getTime() !== new Date(query.cancelledAt).getTime()) return { modifiedCount: 0 };
    Object.assign(record, update.$set);
    for (const key of Object.keys(update.$unset || {})) delete record[key];
    record.statusHistory = record.statusHistory.filter((entry) => String(entry._id) !== String(update.$pull.statusHistory._id));
    if (update.$pull.scheduleHistory)
      record.scheduleHistory = record.scheduleHistory.filter((entry) => String(entry._id) !== String(update.$pull.scheduleHistory._id));
    return { modifiedCount: 1 };
  }, restores);
  patch(Availability, "updateOne", async (query) => {
    releases.push(query);
    if (String(query._id) === failReleaseFor) throw new Error("simulated reservation release failure");
    return { modifiedCount: 1 };
  }, restores);
  patch(Notification, "create", async (record) => { notifications.push(record); return record; }, restores);
  patch(AuditLog, "create", async (record) => record, restores);

  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}/api/appointments`;
  const token = (id) => jwt.sign({ sub: String(id) }, env.jwtSecret);
  const cancel = (record, owner = student, body = {}) => fetch(`${base}/${record.id}/cancel`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token(owner)}`, "Content-Type": "application/json", Connection: "close" },
    body: JSON.stringify(body),
  });
  try {
    assert.equal((await cancel(pending, otherStudent)).status, 404);
    assert.equal((await cancel(confirmed, student, { reason: "x".repeat(501) })).status, 400);
    for (const record of [...ineligible, pastPending, pastConfirmed, staleProposal])
      assert.equal((await cancel(record)).status, 409);

    const pendingResponse = await cancel(pending, student, { reason: "  Schedule conflict  " });
    assert.equal(pendingResponse.status, 200);
    const pendingBody = await pendingResponse.json();
    assert.equal(pending.status, "Cancelled");
    assert.equal(pending.cancellationReason, "Schedule conflict");
    assert.equal(pending.statusHistory[0].previousStatus, "Pending");
    assert.equal(pending.statusHistory[0].newStatus, "Cancelled");
    assert.equal(pending.statusHistory[0].changedByRole, "Student");
    assert.equal("reservationToken" in pendingBody.appointment, false);
    assert.equal("meetingLink" in pendingBody.appointment, false);

    assert.equal((await cancel(confirmed)).status, 200);
    assert.equal(confirmed.status, "Cancelled");
    assert.equal(confirmed.cancellationReason, "");

    const priorScheduleHistory = proposal.scheduleHistory.length;
    assert.equal((await cancel(proposal, student, { reason: "Cannot attend" })).status, 200);
    assert.equal(proposal.status, "Cancelled");
    assert.equal(proposal.scheduleHistory.length, priorScheduleHistory + 1);
    assert.equal(proposal.scheduleHistory.at(-1).response, "Cancelled");
    assert.equal(proposal.proposedStartAt, undefined);

    const releaseCount = releases.length;
    assert.equal((await cancel(tokenless)).status, 200);
    assert.equal(releases.length, releaseCount, "tokenless legacy records cannot release a slot");

    const [first, second] = await Promise.all([cancel(concurrent), cancel(concurrent)]);
    assert.deepEqual([first.status, second.status].sort(), [200, 409]);
    assert.equal(concurrent.statusHistory.length, 1);

    failReleaseFor = String(releaseFailure.availability);
    assert.equal((await cancel(releaseFailure)).status, 500);
    assert.equal(releaseFailure.status, "Confirmed");
    assert.equal(releaseFailure.statusHistory.length, 0);
    assert.equal(releaseFailure.cancelledAt, undefined);

    assert.equal(records.has(pending.id), true, "cancellation preserves the Appointment");
    assert.equal(notifications.length, 5, "only successful cancellations notify Faculty once");
    assert.equal(releases.every((entry) => entry.reservationToken?.startsWith("owned-")), true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    restores.reverse().forEach((restore) => restore());
  }
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
  assert.match(routes, /STUDENT_CANCELLABLE_STATUSES/);
  assert.doesNotMatch(routes.slice(routes.indexOf('router.put("/:id/reschedule-response"')), /decision === "cancel"/);
  assert.match(view, /Cancellation Reason \(Optional\)/);
  assert.match(view, /canStudentCancelAppointment/);
  assert.match(proposal, /onCancelConsultation/);
  assert.match(status, /"Pending",[\s\S]*"Reschedule Proposed",[\s\S]*"Confirmed"/);
  assert.doesNotMatch(routes.slice(routes.indexOf('router.put("/:id/cancel"'), routes.indexOf('router.put("/:id/reschedule-response"')), /deleteOne|findByIdAndDelete|findOneAndDelete|deleteMany/);
});
