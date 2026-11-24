import assert from "node:assert/strict";
import { test } from "node:test";
import Appointment from "../src/models/Appointment.js";
import AttendanceResponse from "../src/models/AttendanceResponse.js";
import { attendanceEnrollment } from "../src/config/attendance.js";
import { countRequiredAttendance } from "../src/services/attendanceRequiredService.js";

const now = new Date("2026-11-01T00:00:00Z");
const ids = { student: "507f1f77bcf86cd799439013", faculty: "507f1f77bcf86cd799439014" };
const endAt = new Date(+now - 3600000);
const appointment = (initiatedByRole, extra = {}) => ({
  _id: "507f1f77bcf86cd799439015", ...ids, initiatedByRole, status: "Confirmed",
  startAt: new Date(+endAt - 3600000), endAt,
  attendance: attendanceEnrollment(endAt, { initiatedByRole }), ...extra,
});
const field = (row, path) => path.split(".").reduce((value, key) => value?.[key], row);
const same = (a, b) => a instanceof Date && b instanceof Date ? +a === +b : String(a) === String(b);
function expression(input, row, variables) {
  if (typeof input === "string" && input.startsWith("$$")) return variables[input.slice(2)];
  if (typeof input === "string" && input.startsWith("$")) return field(row, input.slice(1));
  if (input?.$and) return input.$and.every(value => expression(value, row, variables));
  if (input?.$eq) return same(...input.$eq.map(value => expression(value, row, variables)));
  if (input?.$gt) { const [a, b] = input.$gt.map(value => expression(value, row, variables)); return a > b; }
  if (input?.$add) { const [a, b] = input.$add.map(value => expression(value, row, variables)); return new Date(+a + b); }
  return input;
}
function matches(row, filter, variables) {
  return Object.entries(filter).every(([key, expected]) => {
    if (key === "$expr") return expression(expected, row, variables);
    const actual = field(row, key);
    if (expected && typeof expected === "object" && !(expected instanceof Date) && !expected._bsontype)
      return Object.entries(expected).every(([op, value]) => {
        if (op === "$in") return value.some(item => same(actual, item));
        if (op === "$exists") return (actual !== undefined) === value;
        if (op === "$type") return actual instanceof Date;
        if (op === "$gt") return actual > value;
        if (op === "$lte") return actual <= value;
        assert.fail(`Unsupported match operator ${op}`);
      });
    return same(actual, expected);
  });
}
// Execute the query against fixtures, including its lookup and projections, so
// regressions in the database filters are exercised alongside workflow selection.
function aggregate(rows, pipeline, responses, variables = {}) {
  for (const stage of pipeline) {
    if (stage.$match) rows = rows.filter(row => matches(row, stage.$match, variables));
    else if (stage.$project) rows = rows.map(row => Object.fromEntries(Object.entries(stage.$project)
      .filter(([, include]) => include).map(([key]) => [key, row[key]])));
    else if (stage.$limit) rows = rows.slice(0, stage.$limit);
    else if (stage.$count) rows = rows.length ? [{ [stage.$count]: rows.length }] : [];
    else if (stage.$lookup) {
      const lookup = stage.$lookup;
      assert.equal(lookup.from, AttendanceResponse.collection.name);
      rows = rows.map(row => ({ ...row, [lookup.as]: aggregate(responses, lookup.pipeline, [],
        Object.fromEntries(Object.entries(lookup.let).map(([key, value]) => [key, expression(value, row, variables)]))) }));
    } else assert.fail("Unsupported aggregation stage");
  }
  return rows;
}
async function check(t, row, responses, expected) {
  const before = JSON.stringify({ row, responses });
  let queries = 0;
  t.mock.method(Appointment, "aggregate", pipeline => ({ option: async options => {
    queries++;
    assert.equal(options.maxTimeMS, 10000);
    return aggregate([row], pipeline, responses);
  } }));
  for (const model of [Appointment, AttendanceResponse])
    for (const method of ["create", "updateOne", "updateMany", "findOneAndUpdate", "deleteMany"])
      t.mock.method(model, method, () => assert.fail("Count attempted a write"));
  assert.equal(await countRequiredAttendance(ids.student, "student", now), expected[0], "Student count");
  assert.equal(await countRequiredAttendance(ids.faculty, "faculty", now), expected[1], "Faculty count");
  assert.equal(queries, 2, "one query per count");
  assert.equal(JSON.stringify({ row, responses }), before);
}

for (const initiator of ["student", "faculty"]) {
  const expected = initiator === "student" ? [1, 0] : [0, 1];
  test(`${initiator}-initiated current consultation only requires its original initiator`, async t => {
    // The stored initiator remains authoritative if another field differs.
    const row = appointment(initiator, { initiatedByRole: initiator === "student" ? "faculty" : "student" });
    await check(t, row, [], expected);
  });
  test(`${initiator}-initiated untouched legacy consultation uses the initiator workflow`, async t => {
    await check(t, appointment(initiator, { attendance: attendanceEnrollment(endAt) }), [], expected);
  });
  for (const outcome of ["Completed", "Student No-show", "Faculty No-show"]) {
    test(`${initiator} report with outcome ${outcome} is not counted before status catches up`, async t => {
      const row = appointment(initiator);
      await check(t, row, [{ appointment: row._id, participant: ids[initiator], participantRole: initiator, outcome }], [0, 0]);
    });
  }
  test(`current ${initiator} workflow excludes any existing response, including a counterpart response`, async t => {
    const row = appointment(initiator), other = initiator === "student" ? "faculty" : "student";
    await check(t, row, [{ appointment: row._id, participant: ids[other], participantRole: other }], [0, 0]);
  });
}

test("legacy enrollment without an initiator retains two-party reporting", async t => {
  await check(t, appointment(), [], [1, 1]);
});
for (const reportedRole of ["student", "faculty"]) {
  test(`legacy ${reportedRole} response retains the other participant's obligation despite stale flags`, async t => {
    const row = appointment("student", { attendance: attendanceEnrollment(endAt) });
    await check(t, row, [{ appointment: row._id, participant: ids[reportedRole], participantRole: reportedRole }],
      reportedRole === "student" ? [0, 1] : [1, 0]);
  });
}
for (const changes of [
  { studentResponded: true }, { facultyResponded: true }, { finalOutcome: "Completed" },
  { finalizationSource: "participant_agreement" }, { reviewReason: "responses_conflict" }, { reviewStartedAt: now },
]) test(`touched legacy metadata retains two-party behavior: ${Object.keys(changes)[0]}`, async t => {
  await check(t, appointment("faculty", { attendance: { ...attendanceEnrollment(endAt), ...changes } }), [], [1, 1]);
});

for (const status of ["Confirmed", "Awaiting Attendance Update"]) test(`${status} opens inclusively at endAt`, async t => {
  await check(t, appointment("student", { status, endAt: now,
    attendance: attendanceEnrollment(now, { initiatedByRole: "student" }) }), [], [1, 0]);
});
for (const status of ["Pending", "Reschedule Proposed", "Completed", "Cancelled", "Rejected", "Expired", "Attendance Review", "invalid"])
  test(`${status} appointments do not require attendance`, async t => {
    await check(t, appointment("student", { status }), [], [0, 0]);
  });
for (const offset of [0, -1]) test(`reporting deadline ${offset === 0 ? "at" : "before"} now is excluded`, async t => {
  const end = new Date(+now - 48 * 3600000 + offset);
  await check(t, appointment("faculty", { startAt: new Date(+end - 1000), endAt: end,
    attendance: attendanceEnrollment(end, { initiatedByRole: "faculty" }) }), [], [0, 0]);
});
const base = appointment("student");
for (const [name, changes] of [
  ["unenrolled", { attendance: undefined }],
  ["unknown policy", { attendance: { ...base.attendance, policyVersion: "unknown" } }],
  ["future end", { endAt: new Date(+now + 1), attendance: attendanceEnrollment(new Date(+now + 1)) }],
  ["missing start", { startAt: null }], ["missing end", { endAt: null }],
  ["zero duration", { startAt: endAt }], ["negative duration", { startAt: now }],
  ["incorrect opening", { attendance: { ...base.attendance, attendanceOpensAt: now } }],
  ["incorrect deadline", { attendance: { ...base.attendance, responseDeadlineAt: new Date(+now + 1000) } }],
  ["other owners", { student: "507f1f77bcf86cd799439018", faculty: "507f1f77bcf86cd799439019" }],
]) test(`${name} is excluded`, async t => {
  await check(t, appointment("student", changes), [], [0, 0]);
});

test("responses on a different appointment do not suppress the count", async t => {
  await check(t, appointment("faculty"), [{ appointment: "507f1f77bcf86cd799439099", participantRole: "faculty" }], [0, 1]);
});
