import assert from "node:assert/strict";
import { test } from "node:test";
import { scheduleFitsAvailableTimeSlot, validateAvailableTimeSlots } from "../src/services/availableTimeSlotService.js";
import { validateAvailableTimeSlots as validateClient } from "../../client/src/utils/availableTimeSlots.js";

const future = "2099-11-25";
test("available time validation accepts separated ranges and rejects malformed, duplicate, overlapping, and past ranges", () => {
  assert.equal(validateAvailableTimeSlots({ date: future, slots: [
    { startTime: "08:00", endTime: "10:00" }, { startTime: "13:00", endTime: "15:00" },
  ] }), null);
  for (const [slots, code] of [
    [[{ startTime: "", endTime: "10:00" }], "INVALID_AVAILABLE_TIME_SLOT"],
    [[{ startTime: "10:00", endTime: "08:00" }], "INVALID_AVAILABLE_TIME_SLOT_ORDER"],
    [[{ startTime: "08:00", endTime: "10:00" }, { startTime: "08:00", endTime: "10:00" }], "DUPLICATE_AVAILABLE_TIME_SLOT"],
    [[{ startTime: "08:00", endTime: "11:00" }, { startTime: "10:00", endTime: "13:00" }], "OVERLAPPING_AVAILABLE_TIME_SLOTS"],
  ]) assert.equal(validateAvailableTimeSlots({ date: future, slots })?.code, code);
  assert.equal(validateAvailableTimeSlots({ date: "2000-01-01", slots: [{ startTime: "08:00", endTime: "10:00" }] })?.code, "PAST_AVAILABLE_TIME_SLOT");
});

test("a definite appointment must fit wholly inside one submitted range", () => {
  const slots = [{ startTime: "08:00", endTime: "10:00" }, { startTime: "13:00", endTime: "15:00" }];
  assert.equal(scheduleFitsAvailableTimeSlot({ date: future, slots, startAt: `${future}T13:30:00+08:00`, endAt: `${future}T14:00:00+08:00` }), true);
  assert.equal(scheduleFitsAvailableTimeSlot({ date: future, slots, startAt: `${future}T09:30:00+08:00`, endAt: `${future}T10:30:00+08:00` }), false);
  assert.equal(scheduleFitsAvailableTimeSlot({ date: future, slots, startAt: `${future}T09:30:00+08:00`, endAt: `${future}T13:30:00+08:00` }), false);
  assert.equal(scheduleFitsAvailableTimeSlot({ date: future, slots, startAt: `${future}T11:00:00+08:00`, endAt: `${future}T12:00:00+08:00` }), false);
});

test("client and server agree on Manila dates, range boundaries, count, and field types", () => {
  const now = new Date(`${future}T07:30:00+08:00`);
  const slots = Array.from({ length: 9 }, (_, index) => ({
    startTime: `${10 + index}:00`, endTime: `${11 + index}:00`,
  }));
  for (const [date, ranges, valid] of [
    [future, slots.slice(0, 1), true],
    [future, slots.slice(0, 2), true],
    [future, slots.slice(0, 8), true],
    [future, slots, false],
    [future, [], false],
    [future, [slots[0], slots[0]], false],
    [future, [slots[0], { startTime: "10:30", endTime: "12:00" }], false],
    ["2100-02-29", slots.slice(0, 1), false],
    [future, [{ startTime: "07:00", endTime: "08:00" }], false],
    [future, [{ startTime: "07:30", endTime: "08:00" }], false],
    [future, [{ startTime: "10:00" }], false],
    [future, [{ startTime: ["10:00"], endTime: "11:00" }], false],
    [future, [{ ...slots[0], extra: true }], false],
  ]) {
    assert.equal(!validateAvailableTimeSlots({ date, slots: ranges, now }), valid);
    assert.equal(validateClient(ranges, { date, now }).valid, valid);
  }
});
