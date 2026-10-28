import assert from "node:assert/strict";
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
    assert.equal((await h.request('/schedule-requests/'+third._id+'/reject', role, "PUT", { note: "Unavailable" })).status, 200);
  } finally { await h.close(); }
});
