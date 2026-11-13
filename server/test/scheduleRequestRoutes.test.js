import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { appointmentHttp } from "./helpers/appointmentHttp.js";

for (const role of ["faculty", "dean"]) test(role+" unscheduled requests remain single records and decisions are owned and atomic", async () => {
  const h = await appointmentHttp();
  try {
    const body = { facultyId: h.users[role].id, subject: "Project", reason: "Discuss scope", yearLevel: "3rd Year", estimatedDurationMinutes: 30 };
    const response = await h.request('/schedule-requests', "student", "POST", body);
    assert.equal(response.status, 201); const created = (await response.json()).appointment;
    assert.equal(created.status, "Pending"); assert.equal(created.startAt, undefined);
    assert.equal((await h.request('/schedule-requests', "student", "POST", body)).status, 409);
    const decision = { startAt: "2099-01-01T14:00:00+08:00", durationMinutes: 30, mode: "Face-to-Face", location: "Office" };
    const path = '/schedule-requests/'+created._id+'/approve';
    assert.equal((await h.request(path, "otherFaculty", "PUT", decision)).status, 409);
    h.fail("audits"); assert.equal((await h.request(path, role, "PUT", decision)).status, 500);
    assert.equal(h.state.appointments[0].status, "Pending"); assert.equal(h.state.holds.length, 0);
    h.fail(undefined);
    assert.equal((await h.request(path, role, "PUT", decision)).status, 200);
    assert.equal(h.state.appointments.length, 1); assert.equal(h.state.appointments[0].status, "Confirmed");
    assert.equal(h.state.appointments[0].statusHistory.length, 2); assert.equal(h.state.holds.length, 30);
    assert.equal((await h.request(path, role, "PUT", decision)).status, 409);
    assert.equal(h.state.audits.length, 2); assert.equal(h.state.notifications.length, 3);
    assert.equal(h.state.notifications.filter(notification => notification.recipient === h.users.student.id).length, 2);
    assert.ok(h.state.notifications.some(notification => notification.type === "request_submitted"));
    assert.ok(h.state.notifications.some(notification => notification.type === "confirmed"));
    // A different pending request can be cancelled without inventing a schedule.
    const second = await h.request('/schedule-requests', "student", "POST", body);
    const pending = (await second.json()).appointment;
    assert.equal((await h.request('/schedule-requests/'+pending._id+'/cancel', "otherStudent", "PUT", {})).status, 404);
    assert.equal((await h.request('/schedule-requests/'+pending._id+'/cancel', "student", "PUT", {})).status, 200);
    const third = (await (await h.request('/schedule-requests', "student", "POST", body)).json()).appointment;
    assert.equal((await h.request('/schedule-requests/'+third._id+'/reject', role, "PUT", { note: "   " })).status, 400);
    assert.equal(h.state.appointments.find(item => item._id === third._id).status, "Pending");
    assert.equal((await h.request('/schedule-requests/'+third._id+'/reject', role, "PUT", { note: "Unavailable" })).status, 200);
  } finally { await h.close(); }
});

test("Student alternative schedule stays Pending and unreserved until Faculty acceptance", async () => {
  const h = await appointmentHttp();
  try {
    h.users.student.yearLevel = undefined;
    const preferred = {
      facultyId: h.users.faculty.id, subject: "Alternative project meeting",
      reason: "Published schedules do not overlap my classes",
      estimatedDurationMinutes: 30, startAt: "2099-01-02T14:00:00+08:00",
      endAt: "2099-01-02T14:30:00+08:00", mode: "Face-to-Face",
    };
    const response = await h.request("/schedule-requests", "student", "POST", preferred);
    assert.equal(response.status, 201);
    const created = (await response.json()).appointment;
    assert.equal(created.status, "Pending");
    assert.equal(created.bookingMethod, "schedule_request");
    assert.equal(created.currentScheduleSource, "participant_proposed");
    assert.equal(created.yearLevel, undefined, "optional profile fields must not block a valid request");
    assert.equal(new Date(created.startAt).getTime(), new Date(preferred.startAt).getTime());
    assert.equal(h.state.holds.length, 0);
    assert.ok(h.state.notifications.some(item => item.type === "faculty_request_submitted"));

    const missingDetails = { startAt: preferred.startAt, durationMinutes: 30, mode: preferred.mode };
    assert.equal((await h.request(`/schedule-requests/${created._id}/approve`, "faculty", "PUT", missingDetails)).status, 400);
    const decision = { ...missingDetails, location: "SOC Room 201" };
    assert.equal((await h.request(`/schedule-requests/${created._id}/approve`, "otherFaculty", "PUT", decision)).status, 409);
    assert.equal((await h.request(`/schedule-requests/${created._id}/approve`, "faculty", "PUT", decision)).status, 200);
    assert.equal(h.state.appointments[0].status, "Confirmed");
    assert.equal(h.state.holds.length, 30);
  } finally { await h.close(); }
});

test("Student can send an Online alternative without published Faculty availability", async () => {
  const h = await appointmentHttp();
  try {
    const body = { facultyId: h.users.faculty.id, subject: "Online consultation", reason: "Discuss project feedback",
      startAt: "2099-02-03T15:00:00+08:00", endAt: "2099-02-03T15:45:00+08:00",
      estimatedDurationMinutes: 45, mode: "Online" };
    const response = await h.request("/schedule-requests", "student", "POST", body);
    assert.equal(response.status, 201);
    const data = await response.json();
    assert.equal(data.message, "Your alternative consultation schedule request has been sent to the Faculty.");
    assert.equal(data.appointment.status, "Pending");
    assert.equal(data.appointment.consultationMode, "Online");
    assert.equal(data.appointment.meetingPlatform || "", "");
    assert.equal(h.state.slots.length, 0); assert.equal(h.state.holds.length, 0);
    assert.ok(h.state.notifications.some(item => item.type === "faculty_request_submitted" && item.recipient === h.users.faculty.id));
    const decision = { startAt: body.startAt, durationMinutes: 45, mode: "Online" };
    assert.equal((await h.request(`/schedule-requests/${data.appointment._id}/approve`, "faculty", "PUT", decision)).status, 400);
    const confirmedResponse = await h.request(`/schedule-requests/${data.appointment._id}/approve`, "faculty", "PUT",
      { ...decision, meetingPlatform: "Microsoft Teams", meetingLink: "https://teams.example/consultation" });
    assert.equal(confirmedResponse.status, 200);
    const confirmed = (await confirmedResponse.json()).appointment;
    assert.equal(confirmed.status, "Confirmed");
    assert.equal(confirmed.meetingPlatform, "Microsoft Teams");
  } finally { await h.close(); }
});

test("alternative request validation returns stable safe codes and preserves authorization", async () => {
  const h = await appointmentHttp();
  const valid = { facultyId: h.users.faculty.id, subject: "Subject", reason: "Reason", estimatedDurationMinutes: 60,
    startAt: "2099-03-04T15:00:00+08:00", endAt: "2099-03-04T16:00:00+08:00", mode: "Face-to-Face" };
  try {
    for (const [changes, code] of [
      [{ subject: "" }, "INVALID_SUBJECT"], [{ reason: "" }, "INVALID_REASON"],
      [{ endAt: "2099-03-04T14:00:00+08:00" }, "INVALID_SCHEDULE_ORDER"],
      [{ startAt: "2000-01-01T15:00:00+08:00", endAt: "2000-01-01T16:00:00+08:00" }, "PAST_SCHEDULE"],
      [{ mode: "Unsupported" }, "INVALID_MODE"],
      [{ facultyId: "invalid" }, "INVALID_FACULTY"],
    ]) {
      const response = await h.request("/schedule-requests", "student", "POST", { ...valid, ...changes });
      assert.equal(response.status, 400); assert.equal((await response.json()).code, code);
    }
    assert.equal((await h.request("/schedule-requests", "faculty", "POST", valid)).status, 403);
    h.users.faculty.accountStatus = "Inactive";
    const inactive = await h.request("/schedule-requests", "student", "POST", valid);
    assert.equal(inactive.status, 400); assert.equal((await inactive.json()).code, "INVALID_FACULTY");
    assert.equal(h.state.appointments.length, 0);
  } finally { await h.close(); }
});

test("alternative request form maps safe API validation codes and never renders raw server messages", async () => {
  const source = await readFile(new URL("../../client/src/components/student/AlternativeScheduleRequestForm.jsx", import.meta.url), "utf8");
  for (const code of ["INVALID_SUBJECT", "INVALID_REASON", "PAST_SCHEDULE", "INVALID_SCHEDULE_ORDER", "SCHEDULE_CONFLICT"])
    assert.match(source, new RegExp(code));
  assert.match(source, /Preferred Consultation Mode/);
  assert.doesNotMatch(source, /Meeting platform|Meeting link|>Location</);
  assert.match(source, /requestErrorMessage/);
  assert.doesNotMatch(source, /requestError\.message|response\.data/);
});
