import assert from "node:assert/strict";
import { test } from "node:test";
import jwt from "jsonwebtoken";
import app from "../src/app.js";
import { env } from "../src/config/env.js";
import Appointment from "../src/models/Appointment.js";
import User from "../src/models/User.js";
import SupportingDocument from "../src/models/SupportingDocument.js";
import Availability from "../src/models/Availability.js";
import AuditLog from "../src/models/AuditLog.js";
import Notification from "../src/models/Notification.js";
import { APPOINTMENT_STATUSES, LEGACY_APPOINTMENT_STATUSES } from "../src/config/appointmentStatus.js";
import { parseConsultationQuery } from "../src/services/deanConsultationService.js";

const id = "1234567890abcdef12345678";
test("monitoring query validation and Manila boundaries preserve unscheduled requests", () => {
  const defaults = parseConsultationQuery();
  assert.deepEqual(defaults.filter, {}); assert.equal(defaults.limit, 20); assert.equal(defaults.page, 1);
  assert.deepEqual(defaults.sort, { createdAt: -1, _id: -1 });
  const range = parseConsultationQuery({ start: "2026-10-01", end: "2026-10-16" }).filter;
  assert.equal(range.createdAt.$gte.toISOString(), "2026-09-30T16:00:00.000Z");
  assert.equal(range.createdAt.$lt.toISOString(), "2026-10-16T16:00:00.000Z");
  assert.ok(!("startAt" in range));
  for (const status of [...APPOINTMENT_STATUSES, ...LEGACY_APPOINTMENT_STATUSES]) assert.equal(parseConsultationQuery({ status }).filter.status, status);
  for (const query of [
    { start: "2026-10-01" }, { end: "2026-10-01" }, { start: "2026-02-30", end: "2026-03-01" },
    { start: "2026-10-02", end: "2026-10-01" }, { start: "2024-01-01", end: "2025-01-01" },
    { attendanceOutcome: "Present" }, { attendanceOutcome: "" }, { unknown: "x" }, { search: ["x"] },
    { facultyId: "x" }, { studentId: { $ne: null } }, { status: "Legacy" }, { status: "Unknown" },
    { mode: "Remote" }, { page: "0" }, { page: "1.5" }, { limit: "101" }, { sort: "subject" }, { search: "\u0000" },
  ]) assert.throws(() => parseConsultationQuery(query), { statusCode: 400 }, JSON.stringify(query));
  assert.equal(parseConsultationQuery({ start: "2024-01-01", end: "2024-12-31" }).filters.end, "2024-12-31");
});

test("HTTP monitoring authorization, server query contract, safe details/options and no writes", async () => {
  const restores = [], pipelines = [];
  const patch = (object, key, replacement) => { const previous = object[key]; object[key] = replacement; restores.push(() => object[key] = previous); };
  const chain = value => { const q = { then: (yes, no) => Promise.resolve(value).then(yes, no) }; for (const key of ["select", "populate", "maxTimeMS", "lean", "option"]) q[key] = () => q; return q; };
  const row = { _id: id, student: { name: "Student", email: "SECRET" }, faculty: { name: "Dean", password: "SECRET" }, subject: "Course", status: "Pending", reason: "Concern", bookingMethod: "schedule_request", createdAt: new Date(), updatedAt: new Date(), meetingLink: "SECRET", notes: "SECRET", statusMigration: { version: "SECRET" },
    supportingDocuments: [{ _id: id, originalName: "notes.pdf", cloudinaryUrl: "SECRET", cloudinaryPublicId: "SECRET" }],
    statusHistory: [
      { previousStatus: "Pending", newStatus: "Confirmed", changedAt: new Date("2026-10-02"), changedByRole: "Faculty", changedBy: "SECRET", source: "confirm", reason: "<b>safe</b> https://meeting.test token=SECRET" },
      { previousStatus: "Created", newStatus: "Pending", changedAt: new Date("2026-10-01"), changedByRole: "System", actorType: "system", source: "migration", migrationVersion: "SECRET" },
    ] };
  for (const model of [Appointment, User, SupportingDocument, Availability, AuditLog, Notification])
    for (const method of ["create", "updateOne", "updateMany", "findOneAndUpdate", "deleteOne", "deleteMany", "bulkWrite"])
      patch(model, method, () => assert.fail(`Read invoked ${model.modelName}.${method}`));
  patch(User, "findById", role => chain({ id: role, role, accountStatus: "Active", registrationStatus: "Approved" }));
  patch(Appointment, "findById", value => { assert.equal(value, id); return chain(row); });
  patch(Appointment, "aggregate", pipeline => { pipelines.push(pipeline); return chain([{ records: [row], count: [{ total: 43 }] }]); });
  patch(Appointment, "populate", async records => records);
  patch(User, "aggregate", pipeline => { pipelines.push(pipeline); return chain(Array.from({ length: 3 }, (_, index) => ({ _id: `${id.slice(0, -1)}${index}`, name: "Historical Dean", role: "dean", email: "SECRET" }))); });
  const server = await new Promise(resolve => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); });
  const request = (path = "", role = "dean", method = "GET") => fetch(`http://127.0.0.1:${server.address().port}/api/dean/consultations${path}`, { method, headers: { ...(role && { Authorization: `Bearer ${jwt.sign({ sub: role }, env.jwtSecret)}` }), Connection: "close" } });
  try {
    for (const path of ["", `/${id}`, "/filter-options?role=faculty"]) {
      assert.equal((await request(path, null)).status, 401);
      for (const role of ["student", "faculty"]) assert.equal((await request(path, role)).status, 403);
    }
    const list = await request("?page=2&limit=20&status=Pending&search=a%2B%5Bb%5D");
    assert.equal(list.status, 200); assert.equal(list.headers.get("cache-control"), "no-store");
    const body = await list.json();
    assert.deepEqual(body.pagination, { page: 2, limit: 20, total: 43, totalPages: 3 });
    assert.equal(body.consultations[0].recordId, id); assert.equal(body.consultations[0].startAt, null);
    assert.doesNotMatch(JSON.stringify(body), /SECRET|meetingLink|reason|notes|statusMigration|cloudinary/);
    const pipeline = pipelines[0], facet = pipeline.at(-1).$facet;
    assert.deepEqual(pipeline[0], { $match: { status: "Pending" } });
    assert.equal(pipeline[3].$match.$or[0].subject.$regex, "a\\+\\[b\\]");
    assert.deepEqual(facet.records.slice(0, 3), [{ $sort: { createdAt: -1, _id: -1 } }, { $skip: 20 }, { $limit: 20 }]);
    await request(`?search=${id}`);
    assert.equal(String(pipelines.at(-1)[3].$match.$or.at(-1)._id), id);
    await request("?search=12345678");
    assert.ok(pipelines.at(-1)[3].$match.$or.every(part => !part._id));
    const detail = await request(`/${id}`), detailBody = await detail.json();
    assert.equal(detail.status, 200); assert.equal(detail.headers.get("cache-control"), "no-store");
    assert.equal(detailBody.consultation.concern, "Concern"); assert.equal(detailBody.consultation.originalSchedule, null);
    assert.equal(detailBody.consultation.statusHistory[0].source, "Legacy migration");
    assert.equal(detailBody.consultation.statusHistory[1].reason, "safe [link removed] [redacted]");
    assert.doesNotMatch(JSON.stringify(detailBody), /SECRET|changedBy|migrationVersion|meetingLink|"notes":|cloudinary|attendanceOutcome/);
    row.status = "No Show";
    assert.equal((await (await request(`/${id}`)).json()).consultation.legacy, true);
    const options = await (await request("/filter-options?role=faculty&limit=2")).json();
    assert.equal(options.hasMore, true); assert.equal(options.options.length, 2);
    assert.deepEqual(Object.keys(options.options[0]), ["userId", "name", "role"]);
    assert.deepEqual(pipelines.at(-1)[0].$match.role, { $in: ["faculty", "dean"] });
    assert.equal(pipelines.at(-1)[1].$lookup.foreignField, "faculty");
    await request("/filter-options?role=student");
    assert.equal(pipelines.at(-1)[0].$match.role, "student");
    for (const path of ["?status=garbage", "?attendanceOutcome=Present", "?limit=101", "?status=Pending&status=Confirmed", "/filter-options?role=dean", "/filter-options?role=student&limit=51", "/filter-options?role=student&unknown=x", "/invalid", `/${id}?unknown=x`]) assert.equal((await request(path)).status, 400, path);
    patch(Appointment, "findById", () => chain(null));
    assert.equal((await request(`/${id}`)).status, 404);
    patch(Appointment, "aggregate", () => { throw new Error("SECRET"); });
    const failed = await request(); assert.equal(failed.status, 503); assert.doesNotMatch(await failed.text(), /SECRET/);
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) assert.equal((await request(`/${id}`, "dean", method)).status, 403);
  } finally { await new Promise(resolve => server.close(resolve)); restores.reverse().forEach(restore => restore()); }
});
