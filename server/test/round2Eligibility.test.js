import assert from "node:assert/strict";
import { test } from "node:test";
import User from "../src/models/User.js";
import Availability from "../src/models/Availability.js";
import Appointment from "../src/models/Appointment.js";
import StudentAvailability from "../src/models/StudentAvailability.js";
import { eligibleAccount, eligibleAccountFilter, eligibleProviderFilter } from "../src/services/accountEligibility.js";
import { getAvailableFaculty, getFacultyAvailability } from "../src/controllers/availabilityController.js";
import { getPublicStats } from "../src/controllers/publicController.js";
import { searchEligibleStudents } from "../src/services/facultyInitiatedConsultationService.js";
import { appointmentHttp } from "./helpers/appointmentHttp.js";
import { newId, fixture } from "./helpers/appointmentHarness.js";

const cases = [
  ["approved", { registrationStatus: "Approved" }, true],
  ["null", { registrationStatus: null }, true],
  ["missing", {}, true],
  ["pending", { registrationStatus: "Pending" }, false],
  ["rejected", { registrationStatus: "Rejected" }, false],
  ["unknown registration", { registrationStatus: "Unknown" }, false],
  ["inactive approved", { accountStatus: "Inactive", registrationStatus: "Approved" }, false],
  ["inactive null", { accountStatus: "Inactive", registrationStatus: null }, false],
  ["invalid account", { accountStatus: "Unknown" }, false],
  ["missing account", { accountStatus: undefined }, false],
  ["wrong role", { role: "other" }, false],
];
// Isolated query model explicitly implements MongoDB's null/missing semantics.
const matches = (row, filter) => Object.entries(filter).every(([key, value]) => {
  if (key === "$or") return value.some(part => matches(row, part));
  if (value?.$in) return value.$in.some(item => item === null ? row[key] == null : row[key] === item);
  return row[key] === value;
});
const chain = value => {
  const q = { then: (resolve, reject) => Promise.resolve(value).then(resolve, reject) };
  for (const method of ["select", "sort", "skip", "limit", "lean", "maxTimeMS"]) q[method] = () => q;
  return q;
};
const response = () => ({ statusCode: 200, status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; } });

test("Mongoose hydration cannot turn missing legacy registration into an explicit Pending decision", () => {
  for (const role of ["student", "faculty"]) for (const [label, fields, expected] of cases) {
    const stored = { _id: newId(), role, accountStatus: "Active", ...fields };
    if (stored.accountStatus === undefined) delete stored.accountStatus;
    const doc = User.hydrate(stored);
    assert.equal(eligibleAccount(doc, role), expected, `${role}: ${label}`);
    if (label === "missing") {
      assert.equal(doc.registrationStatus, "Pending", "the schema materializes its default on read");
      assert.equal(doc.isModified("registrationStatus"), false);
    }
    assert.equal(eligibleAccount(new User({ role, accountStatus: "Active" }), role), false, "new accounts retain their Pending default");
  }
});

test("account policy and real discovery queries agree for every legacy and restricted state without writes", async () => {
  const originals = [], filters = [];
  const patch = (obj, key, fn) => { originals.push([obj, key, obj[key]]); obj[key] = fn; };
  let rows;
  patch(User, "find", filter => { filters.push(filter); return chain(rows.filter(row => matches(row, filter))); });
  patch(User, "exists", filter => { filters.push(filter); return chain(rows.find(row => matches(row, filter))); });
  patch(User, "countDocuments", filter => { filters.push(filter); return chain(rows.filter(row => matches(row, filter)).length); });
  patch(Availability, "find", () => chain([])); patch(Availability, "findOne", () => chain(null));
  patch(Appointment, "find", () => chain([])); patch(Appointment, "countDocuments", () => chain(0));
  patch(StudentAvailability, "find", () => chain([]));
  for (const method of ["updateOne", "findOneAndUpdate", "save"]) patch(User, method, () => assert.fail("Discovery must never write accounts"));
  try {
    for (const role of ["faculty", "student"]) for (const [label, fields, expected] of cases) {
      const id = newId();
      rows = [{ _id: id, id, name: "Test participant", accountStatus: "Active", role, ...fields,
        toObject() { return { _id: id, role: this.role, name: this.name }; } }];
      const before = JSON.stringify(rows);
      assert.equal(eligibleAccount(rows[0], role), expected, `${role}: ${label}`);
      assert.equal(matches(rows[0], eligibleAccountFilter(role)), expected);
      if (role === "faculty") {
        const res = response(); await getAvailableFaculty({ user: { id: newId() } }, res);
        assert.equal(res.body.faculty.length, expected ? 1 : 0, label);
        const detail = response(); await getFacultyAvailability({ user: { role: "student", id: newId() }, params: { facultyId: id } }, detail);
        assert.equal(detail.statusCode, expected ? 200 : 404, label);
        const stats = response(); await getPublicStats({}, stats);
        assert.equal(stats.body.facultyCount, expected ? 1 : 0, label);
        assert.deepEqual(Object.keys(stats.body).sort(), ["activeRequests", "completedConsultations", "facultyCount", "nextAvailableSlot"]);
      } else {
        const result = await searchEligibleStudents({ faculty: newId() });
        assert.equal(result.students.length, expected ? 1 : 0, label);
        assert.equal(result.pagination.total, expected ? 1 : 0);
      }
      assert.equal(JSON.stringify(rows), before, "eligibility state is unchanged");
    }
    assert.ok(filters.length > 50, "exercise query consumers, not just helper output");
    assert.equal(matches({ role: "dean", accountStatus: "Active" }, eligibleProviderFilter()), true);
    assert.equal(matches({ role: "student", accountStatus: "Active" }, eligibleProviderFilter()), false);
  } finally { for (const [obj, key, old] of originals.reverse()) obj[key] = old; }
});

test("HTTP published booking, schedule requests and Faculty assignment enforce the full eligibility matrix", async () => {
  for (const [label, fields, eligible] of cases) {
    const h = await appointmentHttp();
    try {
      const faculty = h.users.faculty;
      delete faculty.registrationStatus;
      Object.assign(faculty, fields);
      const before = { ...faculty };
      const slotId = newId();
      h.state.slots.push({ id: slotId, _id: slotId, faculty: faculty.id, isActive: true,
        startAt: new Date("2099-05-10T02:00:00Z"), endAt: new Date("2099-05-10T02:30:00Z"), mode: "Online", meetingPlatform: "Teams" });
      const booked = await h.request("/appointments", "student", "POST", { availabilityId: slotId, subject: "Review", reason: "Discuss progress" });
      assert.equal(booked.status, eligible ? 201 : 400, `booking ${label}: ${await booked.text()}`);
      const requested = await h.request("/schedule-requests", "student", "POST", { facultyId: faculty.id,
        subject: "Review", reason: "Discuss progress", requestedConsultationDate: "2099-05-12", requestedConsultationTime: "10:00",
        estimatedDurationMinutes: 30, mode: "Online", meetingPlatform: "Teams" });
      assert.equal(requested.status, eligible ? 201 : 400, `schedule request ${label}: ${await requested.text()}`);
      assert.equal(faculty.registrationStatus, before.registrationStatus);
      assert.equal(faculty.accountStatus, before.accountStatus);
      assert.equal(Object.hasOwn(faculty, "registrationStatus"), Object.hasOwn(before, "registrationStatus"));
      // Restore the authenticated Faculty and apply the same matrix to the target Student.
      Object.assign(faculty, { role: "faculty", accountStatus: "Active", registrationStatus: "Approved" });
      const student = h.users.otherStudent;
      delete student.registrationStatus; Object.assign(student, fields);
      const assigned = await h.request("/appointments/faculty-request", "faculty", "POST", { studentId: student.id,
        subject: "Review", reason: "Discuss progress", startAt: "2099-06-10T02:00:00Z", endAt: "2099-06-10T02:30:00Z", mode: "Online", meetingPlatform: "Teams" });
      assert.equal(assigned.status, eligible ? 201 : 404, `assignment ${label}: ${await assigned.text()}`);
      const pending = fixture({ student: student.id, faculty: faculty.id, bookingMethod: "schedule_request",
        availability: undefined, reservationToken: undefined, startAt: undefined, endAt: undefined });
      h.state.appointments.push(pending);
      const confirmed = await h.request(`/schedule-requests/${pending._id}/approve`, "faculty", "PUT", {
        startAt: "2099-07-10T02:00:00Z", durationMinutes: 30, mode: "Online", meetingPlatform: "Teams", expectedVersion: 0,
      });
      assert.equal(confirmed.status, eligible ? 200 : 409, `confirmation ${label}: ${await confirmed.text()}`);
      assert.equal((await h.request("/appointments/faculty-request", "student", "POST", {})).status, 403);
    } finally { await h.close(); }
  }
});
