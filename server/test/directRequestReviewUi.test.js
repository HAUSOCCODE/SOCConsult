import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = path => readFile(new URL(`../../client/src/${path}`, import.meta.url), "utf8");

test("Faculty consultation details open the exact request directly without switching to Incoming Requests", async () => {
  const [consultations, requests] = await Promise.all([
    source("components/appointments/FacultyConsultationsView.jsx"),
    source("pages/Faculty/AppointmentRequests.jsx"),
  ]);
  assert.match(consultations, /openDirectReview\(a\._id\)/);
  assert.match(consultations, /initialAppointmentId=\{directReviewId\}/);
  assert.doesNotMatch(consultations, /close\(\); setSection\("Incoming Requests"\)/);
  assert.match(requests, /api\(`\/appointments\/requests\/\$\{id\}`/);
  assert.match(requests, /if \(initialAppointmentId && initialAppointmentId !== selectedId\) void open\(initialAppointmentId\)/);
  assert.match(requests, /AppointmentRequestDetailsModal/);
  assert.match(requests, /OneTimeScheduleRequests/);
});

test("Student details directly expose only the existing Faculty-request response action", async () => {
  const [view, details] = await Promise.all([
    source("components/appointments/StudentConsultationsView.jsx"),
    source("components/appointments/StudentAppointmentDetailsModal.jsx"),
  ]);
  assert.match(view, /onRespondToFacultyRequest=\{\(\) => \{ setFacultyRequestTarget\(details\)/);
  assert.match(details, /appointment\.initiatedByRole === "faculty"/);
  assert.match(details, /Respond to Faculty Request/);
  assert.doesNotMatch(details, /Approve and Schedule|Review Request Decisions/);
});

test("shared details presentation separates requested availability from confirmed scheduling", async () => {
  const [availability, facultyDetails, studentDetails, requestDetails] = await Promise.all([
    source("components/appointments/RequestedAvailability.jsx"),
    source("components/appointments/PersonalConsultationDetails.jsx"),
    source("components/appointments/StudentAppointmentDetailsModal.jsx"),
    source("components/appointments/AppointmentRequestDetailsModal.jsx"),
  ]);
  for (const details of [facultyDetails, studentDetails, requestDetails]) assert.match(details, /RequestedAvailability/);
  assert.match(availability, /Time Slot \{index \+ 1\}/);
  assert.match(availability, /Available time was not provided for this request/);
  assert.match(availability, /not a confirmed consultation schedule/);
  assert.match(availability, /Asia\/Manila/);
  assert.match(facultyDetails, /Confirmed Schedule/); assert.match(studentDetails, /Confirmed Schedule/);
});
