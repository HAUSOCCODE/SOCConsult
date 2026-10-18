import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { formatManilaDateTime } from "../../client/src/utils/formatDateTime.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Student attendance UI uses the privacy-scoped attendance API", async () => {
  const [form, summary, details] = await Promise.all([
    read("../../client/src/components/attendance/StudentAttendanceResponseForm.jsx"),
    read("../../client/src/components/attendance/AttendanceResponseSummary.jsx"),
    read("../../client/src/components/appointments/StudentAppointmentDetailsModal.jsx"),
  ]);
  for (const outcome of ["Completed", "Student No-show", "Faculty No-show"])
    assert.match(form, new RegExp(outcome));
  assert.match(form, /Your attendance response will be stored separately from the Faculty member’s response\. The final consultation outcome will be determined by the system based on both submissions\./);
  assert.match(form, /maxLength=\{ATTENDANCE_REASON_LIMIT\}/);
  assert.match(form, /ConfirmDialog/);
  assert.match(details, /\/appointments\/\$\{appointmentId\}\/attendance/);
  assert.match(details, /\/appointments\/\$\{appointmentId\}\/attendance-responses/);
  assert.match(details, /appointment\.status === "Awaiting Attendance Update"/);
  assert.match(details, /attendance\.eligible/);
  assert.match(details, /attendance\?\.ownResponse/);
  assert.match(summary, /import \{ formatManilaDateTime \} from "\.\.\/\.\.\/utils\/formatDateTime"/);
  assert.match(summary, /formatManilaDateTime\(value, "Not available"\)/);
  assert.match(formatManilaDateTime("2026-10-18T16:05:00Z"), /19 Oct 2026|Oct 19, 2026/);
});

test("Student attendance UI cannot finalize Appointment status or mutate Faculty response", async () => {
  const sources = (await Promise.all([
    read("../../client/src/components/attendance/StudentAttendanceResponseForm.jsx"),
    read("../../client/src/components/attendance/AttendanceResponseSummary.jsx"),
    read("../../client/src/components/appointments/StudentAppointmentDetailsModal.jsx"),
  ])).join("\n");
  assert.doesNotMatch(sources, /status\s*:\s*["'](?:Completed|Attendance Review|Expired)["']/);
  assert.doesNotMatch(sources, /facultyResponse\s*[:=]/);
  assert.doesNotMatch(sources, /participantRole|studentId|facultyId/);
  assert.doesNotMatch(sources, /PUT[\s\S]{0,120}attendance/);
});
