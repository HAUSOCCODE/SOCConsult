import assert from "node:assert/strict";
import { test } from "node:test";
import { scheduleFitsAvailableTimeSlot, validateAvailableTimeSlots } from "../src/services/availableTimeSlotService.js";

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
});
