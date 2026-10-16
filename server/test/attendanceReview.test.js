import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import Appointment from "../src/models/Appointment.js";
import AttendanceReview from "../src/models/AttendanceReview.js";
import { REVIEW_ACTIONS } from "../src/config/attendanceReview.js";
import { attendanceEnrollment } from "../src/config/attendance.js";
import { submitReview, reviewDetails, listReviews, parseReviewQuery } from "../src/services/attendanceReviewService.js";
import { attendanceClassification, verifiedCompletedFilter } from "../src/services/attendanceReportingService.js";
import { participantAttendance } from "../src/services/attendancePrivacyService.js";
import { appointmentHarness, fixture, newId } from "./helpers/appointmentHarness.js";
import { appointmentHttp } from "./helpers/appointmentHttp.js";

function seed(h, users) {
  const dean = users?.dean || { id: newId(), role: "dean", accountStatus: "Active" };
  if (!users) h.state.users.push({ ...dean, _id: dean.id });
  const row = fixture({ status: "Attendance Review", ...(users && { student: users.student.id, faculty: users.dean.id }) });
  row.attendance = { ...attendanceEnrollment(row.endAt), reviewReason: "both_responses_missing", missingRoles: ["student", "faculty"], reviewStartedAt: row.endAt };
  h.state.appointments.push(row);
  return { row, actor: { ...dean, management: true }, input: { action: "confirm_completed", reason: "  <b>Reviewed evidence</b> https://private.test token=secret  ", expectedVersion: 0 } };
}
for (const [action, outcome] of Object.entries(REVIEW_ACTIONS)) test(`review action ${action}: atomic summary, history, audit and notifications`, async () => {
  const h = appointmentHarness(), { row, actor, input } = seed(h);
  try {
    const result = await submitReview({ id: row._id, actor, input: { ...input, action } });
    const stored = h.state.appointments[0], review = h.state.reviews[0];
    assert.equal(result.finalOutcome, outcome); assert.equal(result.version, 1);
    assert.equal(stored.status, outcome ? "Completed" : "Attendance Review");
    assert.equal(stored.attendance.finalOutcome, outcome);
    assert.equal(stored.statusHistory.length, outcome ? 1 : 0);
    assert.equal(h.state.audits.length, 1); assert.equal(h.state.notifications.length, outcome ? 2 : 0);
    assert.equal(review.studentResponse, null); assert.equal(review.facultyResponse, null);
    assert.equal(review.reason, "Reviewed evidence [link removed] [redacted]");
    assert.doesNotMatch(JSON.stringify([h.state.audits, h.state.notifications, stored.statusHistory]), /Reviewed evidence|private.test|token=secret/);
    assert.equal(stored.attendance.reviewReason, row.attendance.reviewReason);
    if (outcome) {
      assert.equal(stored.attendance.finalizationSource, "dean_review");
      assert.match(h.state.notifications[0].message, /attendance record was reviewed/);
      await assert.rejects(submitReview({ id: row._id, actor, input: { ...input, expectedVersion: 1 } }), { statusCode: 409 });
    } else {
      await submitReview({ id: row._id, actor, input: { ...input, action, expectedVersion: 1 } });
      assert.equal(h.state.reviews.length, 2); assert.equal(h.state.notifications.length, 0);
    }
  } finally { h.restore(); }
});
test("original responses stay unchanged and are referenced, including either missing role", async () => {
  for (const roles of [["student"], ["faculty"], ["student", "faculty"]]) {
    const h = appointmentHarness(), { row, actor, input } = seed(h);
    try {
      for (const role of roles) h.state.responses.push({ _id: newId(), appointment: row._id, participant: row[role], participantRole: role,
        outcome: role === "student" ? "Completed" : "Student No-show", reason: `${role} PRIVATE`, submittedAt: row.endAt, policyVersion: row.attendance.policyVersion });
      const original = JSON.stringify(h.state.responses);
      await submitReview({ id: row._id, actor, input });
      assert.equal(JSON.stringify(h.state.responses), original);
      for (const role of ["student", "faculty"]) assert.equal(h.state.reviews[0][`${role}Response`], h.state.responses.find(r => r.participantRole === role)?._id || null);
      assert.doesNotMatch(JSON.stringify([h.state.audits, h.state.notifications, h.state.appointments]), /PRIVATE/);
    } finally { h.restore(); }
  }
});
test("input validation, authorization, stale versions and index gate fail without changes", async () => {
  const h = appointmentHarness(), { row, actor, input } = seed(h);
  try {
    const before = JSON.stringify(h.state);
    for (const invalid of [null, [], {}, { ...input, action: "__proto__" }, { ...input, action: ["confirm_completed"] }, { ...input, reason: "  " }, { ...input, reason: "<b></b>" }, { ...input, reason: 4 },
      { ...input, reason: "x".repeat(501) }, { ...input, expectedVersion: undefined }, { ...input, expectedVersion: "0" }, { ...input, dean: actor.id }])
      await assert.rejects(submitReview({ id: row._id, actor, input: invalid }), { statusCode: 400 });
    for (const unauthorized of [{ ...actor, role: "faculty" }, { ...actor, role: "student" }, { ...actor, management: false }, { ...actor, accountStatus: "Inactive" }])
      await assert.rejects(submitReview({ id: row._id, actor: unauthorized, input }), { statusCode: 403 });
    await assert.rejects(submitReview({ id: row._id, actor, input: { ...input, expectedVersion: 5 } }), { statusCode: 409 });
    const indexes = AttendanceReview.collection.indexes;
    AttendanceReview.collection.indexes = async () => [];
    try { await assert.rejects(submitReview({ id: row._id, actor, input }), { statusCode: 503 }); } finally { AttendanceReview.collection.indexes = indexes; }
    assert.equal(JSON.stringify(h.state), before);
  } finally { h.restore(); }
});
test("concurrent actions and transaction retries commit one decision; failures roll everything back", async () => {
  for (const failure of ["reviews", "appointments", "audits", "notifications", null]) {
    const h = appointmentHarness(), { row, actor, input } = seed(h);
    try {
      if (failure) {
        const original = JSON.stringify(h.state); h.fail(failure);
        await assert.rejects(submitReview({ id: row._id, actor, input })); assert.equal(JSON.stringify(h.state), original);
      } else {
        h.retry();
        const results = await Promise.allSettled([input, { ...input, action: "confirm_faculty_no_show" }].map(input => submitReview({ id: row._id, actor, input })));
        assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
        assert.equal(h.state.reviews.length, 1); assert.equal(h.state.audits.length, 1); assert.equal(h.state.notifications.length, 2);
      }
    } finally { h.restore(); }
  }
});
test("immutable review schema and unique final index", async () => {
  assert.ok(AttendanceReview.schema.indexes().some(([key, opts]) => key.appointment === 1 && opts.unique && opts.partialFilterExpression.isFinal === true));
  for (const op of [() => AttendanceReview.updateOne({}, {}), () => AttendanceReview.deleteMany({}), () => AttendanceReview.replaceOne({}, {}),
    () => AttendanceReview.bulkWrite([{ deleteMany: { filter: {} } }]), () => AttendanceReview.hydrate({ _id: newId() }).deleteOne()]) await assert.rejects(op(), /immutable/);
  const record = new AttendanceReview({ appointment: newId(), dean: newId(), action: "leave_under_review", reason: "Review", reviewedAt: new Date(), previousStatus: "Attendance Review", resultingStatus: "Completed", finalOutcome: null, isFinal: false, appointmentVersion: 0 });
  await assert.rejects(record.validate(), /Inconsistent/);
});
test("competing retained notes use version guards and remain append-only before final resolution", async () => {
  const h = appointmentHarness(), { row, actor, input } = seed(h);
  try {
    const note = { ...input, action: "leave_under_review" };
    const results = await Promise.allSettled([note, note].map(input => submitReview({ id: row._id, actor, input })));
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(h.state.reviews.length, 1); assert.equal(h.state.notifications.length, 0);
    const original = JSON.stringify(h.state.reviews[0]);
    await submitReview({ id: row._id, actor, input: { ...input, expectedVersion: 1 } });
    assert.equal(JSON.stringify(h.state.reviews[0]), original); assert.equal(h.state.reviews.length, 2);
  } finally { h.restore(); }
});
test("detail loading detects concurrent changes and hides unrelated historical appointments", async () => {
  const h = appointmentHarness(), { row, actor } = seed(h), find = Appointment.findById;
  try {
    let calls = 0;
    Appointment.findById = id => { calls++; if (calls === 3) h.state.appointments[0].__v++; return find(id); };
    await assert.rejects(reviewDetails(row._id, actor), { statusCode: 409 });
    Appointment.findById = find;
    h.state.appointments[0].status = "Completed"; h.state.appointments[0].attendance.finalizationSource = "participant_agreement";
    await assert.rejects(reviewDetails(row._id, actor), { statusCode: 404 });
  } finally { Appointment.findById = find; h.restore(); }
});
test("review queue uses bounded server filtering and safe projections", async () => {
  const actor = { role: "dean", accountStatus: "Active", management: true };
  const parsed = parseReviewQuery({ start: "2026-10-01", end: "2026-10-16", reviewReason: "responses_conflict", page: "2", limit: "10" });
  assert.equal(parsed.filter.status, "Attendance Review"); assert.equal(parsed.filter["attendance.reviewReason"], "responses_conflict");
  assert.equal(parsed.filter["attendance.reviewStartedAt"].$gte.toISOString(), "2026-09-30T16:00:00.000Z");
  for (const query of [{ status: "Completed" }, { reviewReason: ["responses_conflict"] }, { limit: "101" }, { start: "2026-02-30", end: "2026-03-01" }, { studentId: "bad" }, { start: "2026-10-01" }]) assert.throws(() => parseReviewQuery(query), { statusCode: 400 });
  const old = Appointment.aggregate, populate = Appointment.populate;
  Appointment.aggregate = pipeline => {
    assert.equal(pipeline[0].$match.status, "Attendance Review");
    assert.deepEqual(pipeline[1].$facet.records.slice(1, 3), [{ $skip: 10 }, { $limit: 10 }]);
    const projection = pipeline[1].$facet.records.at(-1).$project;
    assert.equal(projection.reason, undefined); assert.equal(projection.attendance, undefined);
    return { option: async () => [{ count: [{ total: 21 }], records: [{ _id: newId(), student: { name: "Student" }, faculty: { name: "Faculty" }, subject: "Course", notes: "PRIVATE", reason: "PRIVATE", attendance: { reviewReason: "responses_conflict", reviewStartedAt: new Date(), private: "PRIVATE" } }] }] };
  };
  Appointment.populate = async rows => rows;
  try {
    const result = await listReviews({ page: "2", limit: "10" }, actor);
    assert.equal(result.pagination.totalPages, 3); assert.doesNotMatch(JSON.stringify(result), /PRIVATE|notes|concern/);
  } finally { Appointment.aggregate = old; Appointment.populate = populate; }
});
test("review details retain authorized originals and safe documents, including resolved cases", async () => {
  const h = appointmentHarness(), { row, actor, input } = seed(h);
  try {
    row.reason = "Concern"; row.notes = "UNAUTHORIZED"; row.meetingLink = "SECRET_URL";
    row.supportingDocuments = [{ _id: newId(), originalName: "evidence.pdf", cloudinaryUrl: "SECRET_URL", cloudinaryPublicId: "SECRET_URL" }];
    h.state.responses.push({ _id: newId(), appointment: row._id, participant: row.student, participantRole: "student", outcome: "Completed", reason: "STUDENT_PRIVATE", policyVersion: row.attendance.policyVersion, submittedAt: row.endAt });
    const before = JSON.stringify(h.state);
    const details = await reviewDetails(row._id, actor);
    assert.equal(details.review.responses.student.reason, "STUDENT_PRIVATE"); assert.equal(details.review.responses.faculty, null);
    assert.equal(details.review.concern, "Concern"); assert.doesNotMatch(JSON.stringify(details), /UNAUTHORIZED|SECRET_URL|cloudinary/);
    assert.equal(JSON.stringify(h.state), before);
    await submitReview({ id: row._id, actor, input });
    const resolved = await reviewDetails(row._id, actor);
    assert.equal(resolved.review.state, "Resolved"); assert.equal(resolved.review.actions.length, 1);
    for (const role of ["student", "faculty"]) await assert.rejects(reviewDetails(row._id, { ...actor, role }), { statusCode: 403 });
  } finally { h.restore(); }
});
test("HTTP active Dean authorization and personal Faculty separation", async () => {
  const h = await appointmentHttp(), { row, input } = seed(h, h.users);
  try {
    for (const [path, method] of [["/dean/attendance-review", "GET"], [`/dean/attendance-review/${row._id}`, "GET"], ["/dean/attendance-review/filter-options?role=student", "GET"], [`/dean/attendance-review/${row._id}/actions`, "POST"]]) {
      for (const role of [null, "student", "faculty", "otherStudent", "otherFaculty"]) {
        const result = await h.request(path, role, method, method === "POST" ? input : undefined);
        assert.equal(result.status, role ? 403 : 401); assert.equal(result.headers.get("cache-control"), "no-store");
      }
    }
    const dean = h.state.users.find(user => user.role === "dean"); dean.accountStatus = "Inactive";
    assert.equal((await h.request(`/dean/attendance-review/${row._id}`, "dean")).status, 403); dean.accountStatus = "Active";
    assert.equal((await h.request(`/dean/faculty/attendance-review/${row._id}/actions`, "dean", "POST", input)).status, 404);
    assert.equal((await h.request(`/dean/attendance-review/${row._id}`, "dean")).status, 200);
    const result = await h.request(`/dean/attendance-review/${row._id}/actions`, "dean", "POST", input); assert.equal(result.status, 201);
    assert.equal((await h.request(`/dean/attendance-review/${row._id}/actions`, "dean", "POST", input)).status, 409);
    assert.ok(h.state.notifications.some(item => item.actionUrl === "/dean/faculty/consultations"));
    assert.equal((await h.request(`/dean/consultations/${row._id}`, "dean", "POST", input)).status, 403);
  } finally { await h.close(); }
});
test("Dean outcomes classify correctly and final missing-response cases do not wait", () => {
  for (const [outcome, category] of [["Completed", "verifiedCompleted"], ["Student No-show", "studentNoShow"], ["Faculty No-show", "facultyNoShow"]])
    assert.equal(attendanceClassification({ status: "Completed", attendance: { finalOutcome: outcome, finalizationSource: "dean_review" } }), category);
  assert.ok(verifiedCompletedFilter["attendance.finalizationSource"].$in.includes("dean_review"));
  assert.equal(participantAttendance({ status: "Completed", attendance: { finalOutcome: "Completed" } }, [{ participantRole: "student" }], "student").waiting, false);
});
test("review workflow imports and calls no AI service", async () => {
  for (const path of ["services/attendanceReviewService.js", "controllers/attendanceReviewController.js", "models/AttendanceReview.js"])
    assert.doesNotMatch(await readFile(new URL(`../src/${path}`, import.meta.url), "utf8"), /groq|openai|aiService|chatWithAi/i);
});
