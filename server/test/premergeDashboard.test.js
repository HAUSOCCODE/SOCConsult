import assert from "node:assert/strict";
import { test } from "node:test";
import Appointment from "../src/models/Appointment.js";
import Notification from "../src/models/Notification.js";
import { getStudentDashboard } from "../src/routes/dashboardRoutes.js";
import { getNotifications } from "../src/controllers/notificationController.js";
import { attendanceEnrollment } from "../src/config/attendance.js";

const student = "507f1f77bcf86cd799439013", other = "507f1f77bcf86cd799439014";
const now = new Date("2026-11-01T00:00:00Z");
const field = (row, path) => path.split(".").reduce((value, key) => value?.[key], row);
function expr(input, row) {
  if (typeof input === "string" && input.startsWith("$")) return field(row, input.slice(1));
  if (input?.$and) return input.$and.every(value => expr(value, row));
  if (input?.$eq) { const [a, b] = input.$eq.map(value => expr(value, row)); return String(a) === String(b); }
  if (input?.$gt) { const [a, b] = input.$gt.map(value => expr(value, row)); return a > b; }
  if (input?.$add) { const [a, b] = input.$add.map(value => expr(value, row)); return new Date(+a + b); }
  return input;
}
function matches(row, filter) {
  return Object.entries(filter).every(([key, expected]) => {
    if (key === "$expr") return expr(expected, row);
    const actual = field(row, key);
    if (expected && typeof expected === "object" && !(expected instanceof Date) && !expected._bsontype)
      return Object.entries(expected).every(([op, value]) => {
        if (op === "$in") return value.includes(actual);
        if (op === "$ne") return actual !== value;
        if (op === "$exists") return (actual !== undefined) === value;
        if (op === "$type") return actual instanceof Date;
        if (op === "$gt") return actual > value;
        if (op === "$gte") return actual >= value;
        if (op === "$lte") return actual <= value;
        throw Error(`Unsupported test operator ${op}`);
      });
    return String(actual) === String(expected);
  });
}
function query(items) {
  let limit = Infinity, skip = 0, sort = {};
  const q = { select() { return q; }, populate() { return q; }, lean() { return q; },
    sort(value) { sort = value; return q; }, limit(value) { limit = value; return q; }, skip(value) { skip = value; return q; },
    then(resolve, reject) { return Promise.resolve([...items].sort((a, b) => {
      for (const [key, order] of Object.entries(sort)) {
        if (a[key] < b[key]) return -order;
        if (a[key] > b[key]) return order;
      }
      return 0;
    }).slice(skip, skip + limit)).then(resolve, reject); } };
  return q;
}

test("Student dashboard evaluates CORE-03 boundaries and authoritative responses without GET writes; notification policy matches center", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: +now });
  const rows = [], responses = [];
  const add = (extra = {}) => {
    const endAt = new Date(+now - 3600000);
    const row = { _id: String(rows.length + 1).padStart(24, "0"), student, status: "Confirmed",
      startAt: new Date(+endAt - 3600000), endAt, attendance: attendanceEnrollment(endAt), ...extra };
    rows.push(row); return row;
  };
  add(); // ended Confirmed before processor runs
  add({ status: "Awaiting Attendance Update" });
  add({ endAt: now, attendance: { ...attendanceEnrollment(now), studentResponded: true } }); // cached true is ignored
  const responded = add();
  responses.push({ appointment: responded._id, participant: student, participantRole: "student", reason: "PRIVATE" });
  const counterpart = add(); // a Faculty response does not satisfy Student obligation
  responses.push({ appointment: counterpart._id, participant: other, participantRole: "faculty" });
  add({ student: other });
  add({ status: "Attendance Review" });
  add({ status: "Completed" });
  add({ attendance: undefined });
  add({ attendance: { ...attendanceEnrollment(new Date(+now - 3600000)), policyVersion: "legacy" } });
  const deadlineEnd = new Date(+now - 48 * 3600000);
  add({ endAt: deadlineEnd, startAt: new Date(+deadlineEnd - 3600000), attendance: attendanceEnrollment(deadlineEnd) });
  add({ endAt: new Date(+now + 1), attendance: attendanceEnrollment(new Date(+now + 1)) });
  add({ attendance: { ...attendanceEnrollment(new Date(+now - 3600000)), attendanceOpensAt: now } });
  add({ startAt: null });
  const notices = [
    { _id: "1", recipient: student, type: "task", isRead: false, createdAt: now },
    { _id: "2", recipient: student, type: "upcoming_reminder", isRead: false, createdAt: now },
    { _id: "3", recipient: student, isRead: false, createdAt: now }, // visible legacy type
    { _id: "4", recipient: student, type: "finalized", isRead: true, createdAt: now },
    { _id: "5", recipient: other, type: "finalized", isRead: false, createdAt: now },
  ];
  const before = JSON.stringify(rows);
  const patch = (object, key, fn) => t.mock.method(object, key, fn);
  patch(Appointment, "aggregate", pipeline => {
    if (!pipeline[0].$match.status) return Promise.resolve([]); // reporting summary
    return { async option() {
      assert.equal(String(pipeline[0].$match.student), student);
      assert.equal(+pipeline[0].$match.endAt.$lte, +now);
      const lookup = pipeline[1].$lookup;
      assert.deepEqual(lookup.pipeline[1], { $project: { _id: 1 } });
      assert.equal(String(lookup.pipeline[0].$match.participant), student);
      let result = rows.filter(row => matches(row, pipeline[0].$match)).map(row => ({ ...row,
        [lookup.as]: responses.filter(response => response.appointment === row._id &&
          matches(response, { participant: lookup.pipeline[0].$match.participant, participantRole: lookup.pipeline[0].$match.participantRole })),
      }));
      for (const stage of pipeline.slice(2)) {
        if (stage.$match) result = result.filter(row => matches(row, stage.$match));
        else if (stage.$count) result = [{ [stage.$count]: result.length }];
        else assert.fail("Unsupported dashboard aggregation stage");
      }
      return result;
    } };
  });
  patch(Appointment, "countDocuments", async filter => rows.filter(row => matches(row, filter)).length);
  patch(Appointment, "findOne", () => ({ select() { return this; }, populate() { return this; }, sort() { return this; }, lean: async () => null }));
  patch(Appointment, "find", filter => query(rows.filter(row => matches(row, filter))));
  patch(Notification, "find", filter => query(notices.filter(row => matches(row, filter))));
  patch(Notification, "countDocuments", async filter => notices.filter(row => matches(row, filter)).length);
  for (const model of [Appointment, Notification]) for (const method of ["create", "updateOne", "updateMany", "findOneAndUpdate", "deleteMany"])
    patch(model, method, () => assert.fail("GET attempted a mutation"));
  let dashboard, center;
  await getStudentDashboard({ user: { id: student, role: "student" }, query: { studentId: other } }, { json: value => dashboard = value });
  await getNotifications({ user: { id: student, role: "student" }, query: {} }, { json: value => center = value });
  assert.equal(dashboard.attendanceRequiredCount, 4);
  assert.equal(dashboard.unreadNotificationCount, 2);
  assert.equal(dashboard.unreadNotificationCount, center.unreadCount);
  assert.deepEqual(dashboard.recentNotifications.map(row => row._id), center.notifications.map(row => row._id));
  assert.deepEqual(dashboard.recentNotifications.map(row => row._id), ["4", "3", "2"]);
  assert.equal(JSON.stringify(rows), before);
  assert.doesNotMatch(JSON.stringify(dashboard), /PRIVATE/);
});
