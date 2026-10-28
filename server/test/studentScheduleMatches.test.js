import assert from "node:assert/strict";
import { test } from "node:test";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import app from "../src/app.js";
import { env } from "../src/config/env.js";
import User from "../src/models/User.js";
import Availability from "../src/models/Availability.js";
import StudentAvailability from "../src/models/StudentAvailability.js";
import Appointment from "../src/models/Appointment.js";

const chain = (value) => {
  const query = {
    then: (resolve, reject) => Promise.resolve(value).then(resolve, reject),
  };
  for (const method of ["select", "sort", "limit", "lean"])
    query[method] = () => query;
  return query;
};

test("Student schedule matching is backend-owned, private, conflict-safe, and optional", async () => {
  const ids = Object.fromEntries(
    ["student", "otherStudent", "faculty", "otherFaculty", "dean", "inactiveFaculty"].map(
      (key) => [key, new mongoose.Types.ObjectId().toString()],
    ),
  );
  const users = new Map([
    [ids.student, { role: "student" }],
    [ids.otherStudent, { role: "student" }],
    [ids.faculty, { role: "faculty", registrationStatus: "Approved" }],
    [ids.otherFaculty, { role: "faculty", registrationStatus: "Approved" }],
    [ids.dean, { role: "dean" }],
    [ids.inactiveFaculty, { role: "faculty", registrationStatus: "Approved", accountStatus: "Inactive" }],
  ].map(([id, user]) => [id, { id, _id: id, accountStatus: "Active", ...user }]));
  const now = Date.now();
  const date = (hours) => new Date(now + hours * 3600000);
  const slot = (id, faculty, start, end, extra = {}) => ({
    id,
    _id: id,
    faculty,
    startAt: date(start),
    endAt: date(end),
    isActive: true,
    mode: "Online",
    meetingPlatform: "Google Meet",
    meetingLink: "https://meet.example/private-token",
    ...extra,
  });
  const slots = [
    slot("matched", ids.faculty, 2, 3),
    slot("back-to-back", ids.faculty, 3, 4, { mode: "Face-to-Face", location: "Room 201" }),
    slot("outside", ids.faculty, 5, 6),
    slot("inactive", ids.faculty, 7, 8, { isActive: false }),
    slot("past", ids.faculty, -2, -1),
    slot("other-provider", ids.otherFaculty, 2, 3),
    slot("dean-slot", ids.dean, 2, 3),
  ];
  let studentPeriods = [];
  let appointments = [];
  let availabilityFilter;
  let studentAvailabilityFilter;
  let providerFilter;
  const originals = [];
  const patch = (object, key, replacement) => {
    originals.push([object, key, object[key]]);
    object[key] = replacement;
  };
  const same = (left, right) => String(left) === String(right);
  const matches = (record, query) =>
    Object.entries(query).every(([key, expected]) => {
      const actual = record[key];
      if (key === "$or") return expected.some((part) => matches(record, part));
      if (expected && typeof expected === "object" && !(expected instanceof Date)) {
        if ("$in" in expected && !expected.$in.some((item) => same(actual, item))) return false;
        if ("$gt" in expected && !(actual > expected.$gt)) return false;
        if ("$lt" in expected && !(actual < expected.$lt)) return false;
        if ("$exists" in expected && expected.$exists !== (actual != null)) return false;
        return true;
      }
      return same(actual, expected);
    });

  patch(User, "findById", async (id) => users.get(String(id)) || null);
  patch(User, "exists", async (query) => {
    providerFilter = query;
    const user = users.get(String(query._id));
    return user && matches(user, query) ? { _id: user.id } : null;
  });
  patch(Availability, "find", (query) => {
    if (query.expirationNotified) return chain([]);
    availabilityFilter = query;
    return chain(slots.filter((item) => matches(item, query)));
  });
  patch(StudentAvailability, "find", (query) => {
    studentAvailabilityFilter = query;
    return chain(studentPeriods.filter((item) => matches(item, query)));
  });
  patch(Appointment, "find", (query) =>
    chain(appointments.filter((item) => matches(item, query))),
  );

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const base = `http://127.0.0.1:${server.address().port}/api/availability/faculty`;
  const token = (id) => jwt.sign({ sub: id }, env.jwtSecret);
  const call = async (providerId, callerId = ids.student) => {
    const response = await fetch(`${base}/${providerId}`, {
      headers: callerId ? { Authorization: `Bearer ${token(callerId)}` } : {},
    });
    return { status: response.status, data: await response.json() };
  };

  try {
    assert.equal((await call(ids.faculty, null)).status, 401);
    assert.equal((await call("invalid-id")).status, 404);
    assert.equal((await call(ids.inactiveFaculty)).status, 404);

    const fallback = await call(ids.faculty);
    assert.equal(fallback.status, 200);
    assert.equal(fallback.data.hasActiveStudentAvailability, false);
    assert.deepEqual(
      fallback.data.schedules.map((item) => item._id),
      ["matched", "back-to-back", "outside"],
    );
    assert.ok(
      fallback.data.schedules.every(
        (item) =>
          item.bookable === true &&
          item.matchingType === "Based on Faculty availability only",
      ),
    );
    assert.equal(JSON.stringify(fallback.data).includes("meetingLink"), false);
    assert.equal(JSON.stringify(fallback.data).includes("studentAvailability"), false);
    assert.equal(fallback.data.schedules[0].meetingPlatform, "Google Meet");
    assert.equal(fallback.data.schedules[1].location, "Room 201");
    assert.equal(availabilityFilter.faculty, ids.faculty);
    assert.equal(availabilityFilter.isActive, true);
    assert.ok(availabilityFilter.startAt.$gt instanceof Date);
    assert.ok(availabilityFilter.endAt.$gt instanceof Date);
    assert.deepEqual(studentAvailabilityFilter, {
      student: ids.student,
      isActive: true,
      endAt: { $gt: studentAvailabilityFilter.endAt.$gt },
    });

    studentPeriods = [
      { student: ids.student, isActive: true, startAt: date(1), endAt: date(4) },
      { student: ids.student, isActive: false, startAt: date(4), endAt: date(7) },
      { student: ids.otherStudent, isActive: true, startAt: date(1), endAt: date(9), privateNote: "never expose" },
    ];
    appointments = [
      { student: ids.student, faculty: ids.otherFaculty, status: "Confirmed", startAt: date(1), endAt: date(2) },
    ];
    const matched = await call(ids.faculty);
    assert.equal(matched.data.hasActiveStudentAvailability, true);
    assert.deepEqual(matched.data.schedules.map((item) => item._id), ["matched", "back-to-back"]);
    assert.ok(matched.data.schedules.every((item) => item.matchingType === "Matched with your availability"));

    appointments.push({
      student: ids.student,
      faculty: ids.otherFaculty,
      status: "Pending",
      startAt: date(2.25),
      endAt: date(2.75),
    });
    assert.deepEqual((await call(ids.faculty)).data.schedules.map((item) => item._id), ["back-to-back"]);
    appointments = [
      { student: ids.otherStudent, faculty: ids.faculty, status: "Confirmed", startAt: date(3), endAt: date(4) },
    ];
    assert.deepEqual((await call(ids.faculty)).data.schedules.map((item) => item._id), ["matched"]);

    const deanResult = await call(ids.dean);
    assert.equal(deanResult.status, 200);
    assert.equal(deanResult.data.schedules[0]._id, "dean-slot");
    assert.deepEqual(providerFilter.$or, [
      { role: "faculty", registrationStatus: "Approved" },
      { role: "dean" },
    ]);

    const facultyOwn = await call(ids.otherFaculty, ids.faculty);
    assert.equal(facultyOwn.status, 200);
    assert.equal("hasActiveStudentAvailability" in facultyOwn.data, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    originals.reverse().forEach(([object, key, value]) => {
      object[key] = value;
    });
  }
});
