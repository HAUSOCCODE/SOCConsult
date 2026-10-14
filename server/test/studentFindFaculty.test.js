import assert from "node:assert/strict";
import { test } from "node:test";
import Availability from "../src/models/Availability.js";
import User from "../src/models/User.js";
import { getAvailableFaculty } from "../src/controllers/availabilityController.js";

const chain = (value, calls = []) => {
  const query = {
    then: (resolve, reject) => Promise.resolve(value).then(resolve, reject),
  };
  for (const method of ["select", "sort", "limit", "lean"])
    query[method] = (...args) => {
      calls.push([method, ...args]);
      return query;
    };
  return query;
};

const provider = (id, role, extra = {}) => ({
  id,
  role,
  name: extra.name || id,
  position: extra.position,
  specialization: extra.specialization,
  office: extra.office,
  profilePicture: extra.profilePicture,
  toObject() {
    return {
      _id: id,
      role,
      name: this.name,
      position: this.position,
      specialization: this.specialization,
      office: this.office,
    };
  },
});

test("Find Faculty returns active approved Faculty plus only an available Dean with safe future-slot summaries", async () => {
  const restores = [];
  const patch = (object, key, value) => {
    const previous = object[key];
    object[key] = value;
    restores.push(() => {
      object[key] = previous;
    });
  };
  let userFilter;
  let userSelect;
  let discoveryFilter;
  const faculty = provider("faculty-zero", "faculty");
  const deanAvailable = provider("dean-available", "dean", {
    name: "Real Dean Name",
  });
  const deanUnavailable = provider("dean-unavailable", "dean");

  patch(User, "find", (filter) => {
    userFilter = filter;
    const calls = [];
    const query = chain([faculty, deanAvailable, deanUnavailable], calls);
    const originalSelect = query.select;
    query.select = (...args) => {
      userSelect = args[0];
      return originalSelect(...args);
    };
    return query;
  });
  patch(Availability, "find", (filter) => {
    if (filter.expirationNotified) return chain([]);
    discoveryFilter = filter;
    return chain([
      {
        faculty: "dean-available",
        mode: "Online",
      },
    ]);
  });

  let body;
  try {
    await getAvailableFaculty({}, { json: (value) => (body = value) });
  } finally {
    restores.reverse().forEach((restore) => restore());
  }

  assert.deepEqual(userFilter, {
    accountStatus: "Active",
    $or: [
      { role: "faculty", registrationStatus: "Approved" },
      { role: "dean" },
    ],
  });
  assert.equal(userFilter.accountStatus, "Active");
  assert.ok(
    userFilter.$or.every((condition) => condition.role !== "student"),
  );
  assert.match(userSelect, /position specialization office \+profilePicture/);
  assert.doesNotMatch(userSelect, /password|username|contactNumber/);
  assert.equal(discoveryFilter.isActive, true);
  assert.ok(discoveryFilter.startAt.$gt instanceof Date);
  assert.ok(discoveryFilter.endAt.$gt instanceof Date);
  assert.deepEqual(
    body.faculty.map((item) => item._id),
    ["faculty-zero", "dean-available"],
  );
  assert.equal(body.faculty[0].availableScheduleCount, 0);
  assert.deepEqual(body.faculty[0].consultationModes, []);
  assert.equal(body.faculty[1].availableScheduleCount, 1);
  assert.deepEqual(body.faculty[1].consultationModes, ["Online"]);
  assert.equal(body.faculty[1].name, "Real Dean Name");
});
