import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { availabilityStatus, availabilityWithStatus } from "../src/services/availabilityExpirationService.js";
import { matchingAvailability } from "../src/services/availabilityMatchingService.js";

const now = new Date("2026-11-03T13:51:00.000Z"); // 9:51 PM in Asia/Manila

test("effective availability status expires at endAt and preserves future active/inactive state", () => {
  assert.equal(availabilityStatus({ endAt: now, isActive: true }, now), "expired");
  assert.equal(availabilityStatus({ endAt: new Date(now - 1), isActive: false }, now), "expired");
  assert.equal(availabilityStatus({ startAt: new Date(now - 60_000), endAt: new Date(+now + 60_000), isActive: true }, now), "active");
  assert.equal(availabilityStatus({ endAt: new Date(+now + 60_000), isActive: false }, now), "inactive");
  assert.equal(availabilityWithStatus({ _id: "period", endAt: now, isActive: true }, now).status, "expired");
});

test("matching excludes expired participant periods but keeps an ongoing interval until its end", () => {
  const schedule = { _id: "faculty", startAt: new Date(+now - 10 * 60_000), endAt: new Date(+now + 20 * 60_000) };
  const expiredStudent = { startAt: new Date(+now - 30 * 60_000), endAt: now };
  const withoutCurrentPreference = matchingAvailability({ schedules: [schedule], studentAvailability: [expiredStudent], now });
  assert.equal(withoutCurrentPreference.length, 1, "expired Student periods are ignored like absent optional availability");
  assert.equal(withoutCurrentPreference[0].startAt.getTime(), schedule.startAt.getTime());
  const ongoingStudent = { startAt: new Date(+now - 20 * 60_000), endAt: new Date(+now + 10 * 60_000) };
  const matches = matchingAvailability({ schedules: [schedule], studentAvailability: [ongoingStudent], now });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].startAt.getTime(), schedule.startAt.getTime());
  assert.equal(matches[0].endAt.getTime(), ongoingStudent.endAt.getTime());
  assert.equal(matchingAvailability({ schedules: [{ ...schedule, endAt: now }], studentAvailability: [], now }).length, 0);
});

test("Student and Faculty availability UIs use end-time expiration and expose an Expired state", async () => {
  const [studentList, facultyPage, studentController, facultyController] = await Promise.all([
    readFile(new URL("../../client/src/components/student/StudentAvailabilityList.jsx", import.meta.url), "utf8"),
    readFile(new URL("../../client/src/pages/Faculty/ManageAvailability.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/controllers/studentAvailabilityController.js", import.meta.url), "utf8"),
    readFile(new URL("../src/controllers/availabilityController.js", import.meta.url), "utf8"),
  ]);
  assert.match(studentList, /"expired"/);
  assert.match(studentList, /item\.endAt/);
  assert.match(studentList, /\["all", "active", "inactive", "expired"\]/);
  assert.match(studentList, /!expired/);
  assert.match(facultyPage, /new Date\(item\.endAt\) <= new Date\(\)/);
  assert.doesNotMatch(facultyPage, /new Date\(item\.startAt\) <= new Date\(\)/);
  assert.match(studentController, /availabilityWithStatus/);
  assert.match(facultyController, /availabilityStatus\(schedule, now\)/);
});
