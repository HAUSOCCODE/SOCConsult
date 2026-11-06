import assert from "node:assert/strict";
import { test } from "node:test";
import { matchingAvailability, overlappingWindow } from "../src/services/availabilityMatchingService.js";

const at = (day, hour, minute = 0) => new Date(`2099-11-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+08:00`);
const window = (day, startHour, startMinute, endHour, endMinute) => ({ startAt: at(day, startHour, startMinute), endAt: at(day, endHour, endMinute) });

test("interval matching returns exact, partial, and contained shared windows", () => {
  assert.deepEqual(overlappingWindow(window(4, 14, 0, 15, 0), window(4, 14, 0, 15, 0)),
    { startAt: at(4, 14), endAt: at(4, 15), durationMinutes: 60 });
  assert.deepEqual(overlappingWindow(window(4, 20, 51, 21, 51), window(4, 20, 40, 21, 40)),
    { startAt: at(4, 20, 51), endAt: at(4, 21, 40), durationMinutes: 49 });
  assert.deepEqual(overlappingWindow(window(4, 14, 0, 15, 0), window(4, 14, 15, 14, 45)),
    { startAt: at(4, 14, 15), endAt: at(4, 14, 45), durationMinutes: 30 });
  assert.deepEqual(overlappingWindow(window(4, 14, 30, 15, 30), window(4, 14, 0, 16, 0)),
    { startAt: at(4, 14, 30), endAt: at(4, 15, 30), durationMinutes: 60 });
});

test("interval matching rejects no overlap, different dates, insufficient overlap, and malformed ranges", () => {
  assert.equal(overlappingWindow(window(4, 8, 0, 9, 0), window(4, 10, 0, 11, 0)), null);
  assert.equal(overlappingWindow(window(4, 14, 0, 15, 0), window(5, 14, 0, 15, 0)), null);
  assert.equal(overlappingWindow(window(4, 8, 0, 8, 20), window(4, 8, 15, 9, 0), 30), null);
  assert.equal(overlappingWindow({ startAt: at(4, 9), endAt: at(4, 8) }, window(4, 8, 0, 9, 0)), null);
  assert.equal(overlappingWindow({ startAt: "invalid", endAt: at(4, 9) }, window(4, 8, 0, 9, 0)), null);
});

test("matching options are conflict-safe and preserve distinct valid intervals", () => {
  const schedule = { _id: "faculty-window", ...window(4, 14, 0, 16, 0) };
  const matches = matchingAvailability({ schedules: [schedule], studentAvailability: [
    window(4, 14, 0, 14, 30), window(4, 15, 0, 15, 45),
  ], studentAppointments: [window(4, 14, 0, 14, 30)] });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].startAt.getTime(), at(4, 15).getTime());
  assert.equal(matches[0].endAt.getTime(), at(4, 15, 45).getTime());
});
