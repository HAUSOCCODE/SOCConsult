import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { appointmentHttp } from "./helpers/appointmentHttp.js";
import { addSlot, fixture } from "./helpers/appointmentHarness.js";

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

test("Student date-only request preserves the Manila date without inventing or reserving a time", async () => {
  const h = await appointmentHttp();
  try {
    const body = { facultyId: h.users.faculty.id, subject: "Date preference", reason: "Faculty will select the time",
      requestedConsultationDate: "2099-01-15", requestedConsultationTime: "14:00", mode: "Face-to-Face" };
    const response = await h.request("/schedule-requests", "student", "POST", body);
    assert.equal(response.status, 201);
    const created = (await response.json()).appointment;
    assert.equal(created.status, "Pending");
    assert.equal(created.requestedConsultationDate, body.requestedConsultationDate);
    assert.equal(created.requestedConsultationTime, body.requestedConsultationTime);
    assert.equal(created.consultationMode, body.mode);
    assert.equal(created.startAt, undefined);
    assert.equal(created.endAt, undefined);
    assert.equal(created.estimatedDurationMinutes, undefined);
    assert.equal(h.state.holds.length, 0);
    const wrongDate = await h.request(`/schedule-requests/${created._id}/approve`, "faculty", "PUT", {
      startAt: "2099-01-16T14:00:00+08:00", durationMinutes: 30,
      mode: "Face-to-Face", location: "SOC Room 201", expectedVersion: created.__v,
    });
    assert.equal(wrongDate.status, 400); assert.equal((await wrongDate.json()).code, "REQUESTED_DATE_MISMATCH");
    const wrongTime = await h.request(`/schedule-requests/${created._id}/approve`, "faculty", "PUT", {
      startAt: "2099-01-15T15:00:00+08:00", durationMinutes: 30,
      mode: "Face-to-Face", location: "SOC Room 201", expectedVersion: created.__v,
    });
    assert.equal(wrongTime.status, 400); assert.equal((await wrongTime.json()).code, "REQUESTED_TIME_MISMATCH");
    const approval = { startAt: "2099-01-15T14:00:00+08:00", durationMinutes: 30,
      mode: "Face-to-Face", location: "SOC Room 201", expectedVersion: created.__v };
    const approved = await h.request(`/schedule-requests/${created._id}/approve`, "faculty", "PUT", approval);
    assert.equal(approved.status, 200);
    const persisted = h.state.appointments[0];
    assert.equal(persisted.status, "Confirmed");
    assert.equal(persisted.requestedConsultationDate, body.requestedConsultationDate);
    assert.equal(persisted.requestedConsultationTime, body.requestedConsultationTime);
    assert.equal(persisted.availability, undefined);
    assert.equal(persisted.currentScheduleSource, "faculty_assigned");
    assert.equal(new Date(persisted.startAt).getTime(), new Date(approval.startAt).getTime());
    assert.equal(new Date(persisted.endAt).getTime(), new Date(approval.startAt).getTime() + 30 * 60000);
    assert.equal(persisted.estimatedDurationMinutes, 30);
    assert.equal(persisted.consultationMode, "Face-to-Face");
    assert.equal(persisted.location, "SOC Room 201");
    assert.equal(h.state.holds.length, 30);
    assert.ok(h.state.notifications.some(item => item.type === "confirmed" && item.recipient === h.users.student.id));
    assert.equal((await h.request(`/schedule-requests/${created._id}/approve`, "faculty", "PUT", approval)).status, 409);
  } finally { await h.close(); }
});

test("Student availability ranges remain Pending and Faculty approval must fit one range", async () => {
  const h = await appointmentHttp();
  try {
    const body = { facultyId: h.users.faculty.id, subject: "Availability preferences", reason: "Two class-free periods",
      requestedConsultationDate: "2099-11-25", availableTimeSlots: [
        { startTime: "08:00", endTime: "10:00" }, { startTime: "13:00", endTime: "15:00" },
      ], mode: "Online" };
    const response = await h.request("/schedule-requests", "student", "POST", body);
    assert.equal(response.status, 201);
    const created = (await response.json()).appointment;
    assert.equal(created.status, "Pending"); assert.equal(created.startAt, undefined); assert.equal(h.state.holds.length, 0);
    assert.deepEqual(created.availableTimeSlots, body.availableTimeSlots);
    const outside = await h.request(`/schedule-requests/${created._id}/approve`, "faculty", "PUT", {
      startAt: "2099-11-25T10:00:00+08:00", durationMinutes: 30, mode: "Online", meetingPlatform: "Teams", expectedVersion: created.__v,
    });
    assert.equal(outside.status, 400); assert.equal((await outside.json()).code, "SCHEDULE_OUTSIDE_AVAILABLE_TIME");
    const approved = await h.request(`/schedule-requests/${created._id}/approve`, "faculty", "PUT", {
      startAt: "2099-11-25T13:30:00+08:00", durationMinutes: 30, mode: "Online", meetingPlatform: "Teams", expectedVersion: created.__v,
    });
    assert.equal(approved.status, 200); assert.equal(h.state.appointments[0].status, "Confirmed"); assert.equal(h.state.holds.length, 30);
    assert.deepEqual(h.state.appointments[0].availableTimeSlots, body.availableTimeSlots);
  } finally { await h.close(); }
});

test("preferred schedule request rejects missing, malformed, and past Manila times", async () => {
  const h = await appointmentHttp();
  const base = { facultyId: h.users.faculty.id, subject: "Date preference", reason: "Faculty selects time", mode: "Online", requestedConsultationTime: "14:00" };
  try {
    for (const [changes, code] of [
      [{ requestedConsultationDate: "2099-02-30" }, "INVALID_REQUESTED_DATE"],
      [{ requestedConsultationDate: "2099-01-15", requestedConsultationTime: "" }, "INVALID_REQUESTED_TIME"],
      [{ requestedConsultationDate: "2099-01-15", requestedConsultationTime: "25:00" }, "INVALID_REQUESTED_TIME"],
      [{ requestedConsultationDate: "2000-01-01", requestedConsultationTime: "14:00" }, "PAST_REQUESTED_SCHEDULE"],
    ]) {
      const response = await h.request("/schedule-requests", "student", "POST", { ...base, ...changes });
      assert.equal(response.status, 400); assert.equal((await response.json()).code, code);
    }
    assert.equal(h.state.appointments.length, 0);
  } finally { await h.close(); }
});

test("Faculty can counter a date-only request and Student acceptance confirms the proposed schedule once", async () => {
  const h = await appointmentHttp();
  try {
    const createdResponse = await h.request("/schedule-requests", "student", "POST", {
      facultyId: h.users.faculty.id, subject: "Date preference", reason: "Please choose another time",
      requestedConsultationDate: "2099-01-15", requestedConsultationTime: "14:00", mode: "Online",
    });
    const created = (await createdResponse.json()).appointment;
    const proposalResponse = await h.request(`/faculty/appointments/${created._id}/reschedule`, "faculty", "PATCH", {
      consultationDate: "2099-01-16", startTime: "10:00", duration: 30, mode: "Online",
      meetingPlatform: "Google Meet", meetingLink: "https://meet.example/consultation",
      reason: "Unavailable on the requested date", expectedVersion: created.__v,
    });
    assert.equal(proposalResponse.status, 200);
    const proposed = (await proposalResponse.json()).appointment;
    assert.equal(proposed.status, "Reschedule Proposed");
    assert.equal(proposed.requestedConsultationDate, "2099-01-15");
    assert.equal(h.state.holds.length, 0, "a proposal must not reserve before acceptance");
    const accepted = await h.request(`/appointments/${created._id}/reschedule-response`, "student", "PUT", {
      decision: "accept", proposedAt: proposed.proposedAt, expectedVersion: proposed.__v,
    });
    assert.equal(accepted.status, 200);
    assert.equal(h.state.appointments[0].status, "Confirmed");
    assert.equal(h.state.appointments[0].requestedConsultationDate, "2099-01-15");
    assert.equal(h.state.holds.length, 30);
    assert.equal((await h.request(`/appointments/${created._id}/reschedule-response`, "student", "PUT", {
      decision: "accept", proposedAt: proposed.proposedAt, expectedVersion: proposed.__v,
    })).status, 409);
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
  for (const code of ["INVALID_SUBJECT", "INVALID_REASON", "INVALID_REQUESTED_DATE", "INVALID_REQUESTED_TIME", "PAST_REQUESTED_SCHEDULE"])
    assert.match(source, new RegExp(code));
  assert.match(source, /Preferred Consultation Mode/);
  assert.match(source, /Preferred consultation date/);
  assert.match(source, /AvailableTimeSlots/);
  assert.match(source, /available times will be reviewed by the Faculty/);
  assert.doesNotMatch(source, /datetime-local|estimatedDurationMinutes|startAt|endAt/);
  assert.doesNotMatch(source, /Meeting platform|Meeting link|>Location</);
  assert.match(source, /requestErrorMessage/);
  assert.doesNotMatch(source, /requestError\.message|response\.data/);
});

test("malformed ranges cannot fall back to a legacy time or be silently discarded", async () => {
  const h = await appointmentHttp();
  const body = { facultyId: h.users.faculty.id, subject: "Project", reason: "Review",
    requestedConsultationDate: "2099-06-01", requestedConsultationTime: "10:00", mode: "Face-to-Face" };
  try {
    for (const availableTimeSlots of ["[invalid", "null", null, {}, []]) {
      const response = await h.request("/schedule-requests", "student", "POST", { ...body, availableTimeSlots });
      assert.equal(response.status, 400);
      assert.equal((await response.json()).code, "INVALID_AVAILABLE_TIME_SLOTS");
    }
    const availableTimeSlots = [{ startTime: "10:00", endTime: "11:00" }];
    const mixed = await h.request("/schedule-requests", "student", "POST", { ...body, availableTimeSlots,
      startAt: "2099-06-01T10:00:00+08:00", endAt: "2099-06-01T10:30:00+08:00", estimatedDurationMinutes: 30 });
    assert.equal(mixed.status, 400);
    assert.equal(h.state.appointments.length, 0);
    const accepted = await h.request("/schedule-requests", "student", "POST", {
      ...body, availableTimeSlots: JSON.stringify(availableTimeSlots),
    });
    assert.equal(accepted.status, 201);
    assert.deepEqual((await accepted.json()).appointment.availableTimeSlots, availableTimeSlots);
  } finally { await h.close(); }
});

test("generic confirmation enforces ranges and a date-only proposal stays cancellable", async () => {
  const h = await appointmentHttp();
  try {
    const body = { facultyId: h.users.faculty.id, subject: "Project", reason: "Review",
      requestedConsultationDate: "2099-06-01", mode: "Face-to-Face",
      availableTimeSlots: [{ startTime: "10:00", endTime: "11:00" }, { startTime: "13:00", endTime: "14:00" }] };
    const response = await h.request("/schedule-requests", "student", "POST", body);
    assert.equal(response.status, 201);
    const { appointment } = await response.json();
    const gap = fixture({ faculty: h.users.faculty.id, consultationMode: "Face-to-Face", location: "Room",
      startAt: new Date("2099-06-01T10:45:00+08:00"), endAt: new Date("2099-06-01T13:15:00+08:00"),
      reservationToken: undefined });
    addSlot(h, gap);
    const statusUrl = `/appointments/${appointment._id}/status`;
    const malformed = await h.request(statusUrl, "faculty", "PUT", { status: "Confirmed", availabilityId: "invalid", expectedVersion: 0 });
    assert.equal(malformed.status, 400);
    const outside = await h.request(statusUrl, "faculty", "PUT", { status: "Confirmed", availabilityId: gap.availability, expectedVersion: 0 });
    assert.equal(outside.status, 400);
    assert.match((await outside.json()).message, /fits within one/);
    assert.equal(h.state.holds.length, 0);
    const proposed = await h.request(statusUrl, "faculty", "PUT", {
      status: "Reschedule Proposed", note: "Alternate consultation time", availabilityId: gap.availability, expectedVersion: 0,
    });
    assert.equal(proposed.status, 200);
    const duplicate = await h.request("/schedule-requests", "student", "POST", body);
    assert.equal(duplicate.status, 409);
    assert.equal((await duplicate.json()).code, "DUPLICATE_SCHEDULE_REQUEST");
    const pending = await h.request(`/appointments/${appointment._id}/reschedule-response`, "student", "PUT", {
      decision: "reject", proposedAt: (await proposed.json()).appointment.proposedAt, expectedVersion: 1,
    });
    assert.equal(pending.status, 200);
    assert.equal((await pending.json()).appointment.status, "Pending");
    assert.equal((await h.request(statusUrl, "faculty", "PUT", {
      status: "Reschedule Proposed", note: "Another proposal", availabilityId: gap.availability, expectedVersion: 2,
    })).status, 200);
    const cancel = await h.request(`/appointments/${appointment._id}/cancel`, "student", "PUT", { expectedVersion: 3 });
    assert.equal(cancel.status, 200);
    const cancelled = (await cancel.json()).appointment;
    assert.equal(cancelled.startAt, undefined);
    assert.equal(cancelled.proposedAt, undefined);
    assert.deepEqual(cancelled.scheduleHistory.map(entry => entry.response), ["Rejected", "Cancelled"]);
    assert.deepEqual(cancelled.availableTimeSlots, body.availableTimeSlots);
    assert.equal(h.state.holds.length, 0);
  } finally { await h.close(); }
});
