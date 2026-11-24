import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const client = path => readFile(new URL(`../../client/src/${path}`, import.meta.url), "utf8");

test("Student and Faculty request forms reuse the same responsive available-time input", async () => {
  const [component, student, faculty] = await Promise.all([
    client("components/appointments/AvailableTimeSlots.jsx"),
    client("components/student/AlternativeScheduleRequestForm.jsx"),
    client("components/appointments/FacultyConsultationRequestModal.jsx"),
  ]);
  assert.match(student, /import AvailableTimeSlots/); assert.match(faculty, /import AvailableTimeSlots/);
  assert.match(component, /Available Time \(Asia\/Manila\)/);
  assert.match(component, /Enter the time range\(s\) when you are available/);
  assert.match(component, /\+ Add Time Slot/); assert.match(component, />Remove</);
  assert.match(component, /type="time"/); assert.match(component, /sm:grid-cols-2/);
  assert.match(component, /slots\.length > 1/); assert.match(component, /aria-invalid/);
  assert.doesNotMatch(component, /Continuous Time|Separate Time Slots/);
});
