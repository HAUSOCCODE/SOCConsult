import "dotenv/config";
import mongoose from "mongoose";
import app from "../src/app.js";
import User from "../src/models/User.js";
import Appointment from "../src/models/Appointment.js";
import Availability from "../src/models/Availability.js";
import Notification from "../src/models/Notification.js";
import AuditLog from "../src/models/AuditLog.js";
import SupportingDocument from "../src/models/SupportingDocument.js";
import bcrypt from "bcryptjs";

const base = "http://127.0.0.1:5055/api";
const stamp = Date.now();
const facultyEmail = `consultio.qa.faculty.${stamp}@hau.edu.ph`;
const studentEmail = `consultio.qa.student.${stamp}@student.hau.edu.ph`;
const password = "ConsultIO-QA-2026!";
const createdUsers = [];
let server;
const check = (condition, label) => {
  if (!condition) throw new Error(`FAILED: ${label}`);
  console.log(`PASS: ${label}`);
};
async function request(path, { method = "GET", body, token } = {}) {
  const multipart = body instanceof FormData;
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(!multipart && { "Content-Type": "application/json" }),
      Connection: "close",
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    ...(body && { body: multipart ? body : JSON.stringify(body) }),
  });
  const data = await response.json();
  return { status: response.status, data };
}
const startHttp = () =>
  new Promise((resolve) => {
    server = app.listen(5055, "127.0.0.1", resolve);
  });
const stopHttp = () => new Promise((resolve) => server.close(resolve));

try {
  await mongoose.connect(process.env.MONGODB_URI);
  await User.updateMany(
    {
      role: { $in: ["student", "faculty"] },
      registrationStatus: { $exists: false },
    },
    [
      {
        $set: {
          registrationStatus: { $cond: ["$isApproved", "Approved", "Pending"] },
          accountStatus: { $cond: ["$isActive", "Active", "Inactive"] },
        },
      },
    ],
  );
  await User.updateMany(
    { role: "dean", registrationStatus: { $exists: false } },
    { $set: { registrationStatus: "Approved", accountStatus: "Active" } },
  );
  await startHttp();
  const deanDoc = await User.findOne({ role: "dean" }).select(
    "+password passwordChangedAt",
  );
  check(Boolean(deanDoc), "pre-created dean exists");
  const originalDeanHash = deanDoc.password;
  const originalChangedAt = deanDoc.passwordChangedAt;

  const invalidDeanPassword = await request("/auth/login/dean", {
    method: "POST",
    body: { identifier: process.env.DEAN_USERNAME, password: "weak pass1" },
  });
  check(
    invalidDeanPassword.status === 400 &&
      invalidDeanPassword.data.message.includes("Spaces are not allowed"),
    "dean login rejects passwords that violate complexity rules",
  );

  const previousFacultyDomain = `faculty.${facultyEmail.split("@")[1]}`;
  for (const invalidFacultyEmail of [
    `consultio.qa.invalid.${stamp}@${previousFacultyDomain}`,
    `consultio.qa.invalid.${stamp}@student.hau.edu.ph`,
    `consultio.qa.invalid.${stamp}@gmail.com`,
  ]) {
    const invalidFacultyDomain = await request("/auth/register/faculty", {
      method: "POST",
      body: {
        name: "ConsultIO Invalid Faculty",
        email: invalidFacultyEmail,
        employeeId: `QA-INVALID-${stamp}`,
        position: "Professor",
        password,
      },
    });
    check(
      invalidFacultyDomain.status === 400 &&
        invalidFacultyDomain.data.message.includes("@hau.edu.ph"),
      `faculty registration rejects non-official domain: ${invalidFacultyEmail.split("@")[1]}`,
    );
  }

  for (const test of [
    {
      role: "faculty",
      email: facultyEmail,
      name: "ConsultIO QA Faculty",
      employeeId: `QA-F-${stamp}`,
      position: "Professor",
    },
    {
      role: "student",
      email: studentEmail,
      name: "ConsultIO QA Student",
      studentId: `QA-S-${stamp}`,
      program: "Bachelor of Science in Information Technology",
    },
  ]) {
    if (test.role === "faculty") {
      const invalidFacultyPassword = await request("/auth/register/faculty", {
        method: "POST",
        body: { ...test, password: "weak pass1" },
      });
      check(
        invalidFacultyPassword.status === 400 &&
          invalidFacultyPassword.data.message.includes(
            "Spaces are not allowed",
          ),
        "faculty registration rejects passwords that violate complexity rules",
      );
    }
    if (test.role === "student") {
      const invalidPassword = await request("/auth/register/student", {
        method: "POST",
        body: { ...test, password: "weak pass1" },
      });
      check(
        invalidPassword.status === 400 &&
          invalidPassword.data.message.includes("Spaces are not allowed"),
        "student registration rejects passwords that violate complexity rules",
      );
      const invalidProgram = await request("/auth/register/student", {
        method: "POST",
        body: { ...test, program: "Unlisted program", password },
      });
      check(
        invalidProgram.status === 400 &&
          invalidProgram.data.message === "Please select your program.",
        "student registration rejects an unsupported program",
      );
    }
    const registered = await request(`/auth/register/${test.role}`, {
      method: "POST",
      body: { ...test, password },
    });
    check(registered.status === 201, `${test.role} registration succeeds`);
    createdUsers.push(registered.data.user.id);
    const stored = await User.findById(registered.data.user.id);
    check(
      stored.registrationStatus === "Pending" &&
        stored.accountStatus === "Inactive",
      `${test.role} saved Pending/Inactive`,
    );
    const pendingLogin = await request(`/auth/login/${test.role}`, {
      method: "POST",
      body: { identifier: test.email, password },
    });
    check(
      pendingLogin.status === 403 &&
        pendingLogin.data.message ===
          "Your account has already been created. Please wait for a Dean to approve your registration before you can access SOCConsult. You do not need to register again.",
      `${test.role} pending login is denied with exact message`,
    );
    const duplicate = await request(`/auth/register/${test.role}`, {
      method: "POST",
      body: { ...test, password },
    });
    check(
      duplicate.status === 409 &&
        duplicate.data.message ===
          "An account with this email has already been created and is awaiting dean approval. You do not need to register again.",
      `${test.role} duplicate pending registration is rejected`,
    );
  }

  const deanLogin = await request("/auth/login/dean", {
    method: "POST",
    body: {
      identifier: process.env.DEAN_USERNAME,
      password: (process.env.DEAN_PASSWORD || process.env.ADMIN_PASSWORD),
    },
  });
  check(deanLogin.status === 200, "dean login succeeds");
  const deanToken = deanLogin.data.token;
  const pending = await request("/dean/registrations?status=Pending", {
    token: deanToken,
  });
  check(
    [facultyEmail, studentEmail].every((email) =>
      pending.data.registrations.some((x) => x.email === email),
    ),
    "both QA registrations appear in dean requests",
  );
  for (const id of createdUsers) {
    const approval = await request(`/dean/registrations/${id}/approve`, {
      method: "PUT",
      token: deanToken,
      body: {},
    });
    check(approval.status === 200, "dean approval succeeds");
  }
  const approved = await User.find({ _id: { $in: createdUsers } });
  check(
    approved.every(
      (x) =>
        x.registrationStatus === "Approved" &&
        x.accountStatus === "Active" &&
        String(x.approvedBy) === String(deanDoc.id),
    ),
    "approval is permanently stored with approver",
  );
  for (const [index, role] of ["faculty", "student"].entries()) {
    const details = await request(`/dean/users/${createdUsers[index]}`, {
      token: deanToken,
    });
    check(
      details.status === 200 &&
        details.data.user.role === role &&
        !("password" in details.data.user),
      `dean views complete ${role} details without password data`,
    );
  }

  const approvedDuplicate = await request("/auth/register/student", {
    method: "POST",
    body: {
      role: "student",
      email: studentEmail,
      name: "ConsultIO QA Student",
      studentId: `QA-S-${stamp}`,
      program: "Bachelor of Science in Information Technology",
      password,
    },
  });
  check(
    approvedDuplicate.status === 409 &&
      approvedDuplicate.data.message ===
        "An account with this email already exists. Please log in.",
    "approved student duplicate registration is rejected",
  );

  await User.updateOne(
    { _id: createdUsers[1] },
    { registrationStatus: "Rejected", accountStatus: "Inactive" },
  );
  const rejectedLogin = await request("/auth/login/student", {
    method: "POST",
    body: { identifier: studentEmail, password },
  });
  check(
    rejectedLogin.status === 403 &&
      rejectedLogin.data.message ===
        "Your registration was not approved. Please contact the Dean if you believe this requires review.",
    "rejected student receives the rejected-account message",
  );
  await User.updateOne(
    { _id: createdUsers[1] },
    { registrationStatus: "Approved", accountStatus: "Inactive" },
  );
  const inactiveLogin = await request("/auth/login/student", {
    method: "POST",
    body: { identifier: studentEmail, password },
  });
  check(
    inactiveLogin.status === 403 &&
      inactiveLogin.data.message ===
        "Your account is currently inactive. Please contact the Dean for assistance.",
    "inactive student receives the inactive-account message",
  );
  await User.updateOne(
    { _id: createdUsers[1] },
    { registrationStatus: "Approved", accountStatus: "Active" },
  );

  const facultyLogin = await request("/auth/login/faculty", {
    method: "POST",
    body: { identifier: facultyEmail, password },
  });
  const studentLogin = await request("/auth/login/student", {
    method: "POST",
    body: { identifier: studentEmail, password },
  });
  check(
    facultyLogin.status === 200 && studentLogin.status === 200,
    "approved faculty and student can log in",
  );
  const wrongRole = await request("/dashboard/dean", {
    token: studentLogin.data.token,
  });
  check(
    wrongRole.status === 403,
    "backend rejects student access to dean API",
  );

  const startAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  while (startAt.getDay() !== 1) startAt.setDate(startAt.getDate() + 1);
  startAt.setHours(9, 0, 0, 0);
  const endAt = new Date(startAt.getTime() + 60 * 60 * 1000);
  const schedule = await request("/availability", {
    method: "POST",
    token: facultyLogin.data.token,
    body: {
      startAt,
      endAt,
      location: "CT-204",
      mode: "Face-to-Face",
    },
  });
  check(schedule.status === 201, "faculty creates one availability window");
  const directory = await request("/availability/faculty", {
    token: studentLogin.data.token,
  });
  check(
    directory.data.faculty.some(
      (item) => item._id === facultyLogin.data.user.id,
    ),
    "approved faculty appears in the student directory",
  );
  const availableSchedules = await request(
    `/availability/faculty/${facultyLogin.data.user.id}`,
    { token: studentLogin.data.token },
  );
  check(
    availableSchedules.data.schedules.length === 1 &&
      new Date(availableSchedules.data.schedules[0].startAt).getTime() ===
        startAt.getTime() &&
      new Date(availableSchedules.data.schedules[0].endAt).getTime() ===
        endAt.getTime(),
    "availability remains one complete 60-minute window",
  );
  const bookingForm = new FormData();
  bookingForm.append("availabilityId", schedule.data.availability._id);
  bookingForm.append("estimatedDurationMinutes", "10");
  bookingForm.append("subject", "QA Consultation");
  bookingForm.append("yearLevel", "4th Year");
  bookingForm.append("reason", "End-to-end workflow verification");
  bookingForm.append(
    "documents",
    new Blob(
      [
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
          "base64",
        ),
      ],
      { type: "image/png" },
    ),
    "qa-image.png",
  );
  bookingForm.append(
    "documents",
    new Blob(["pdf-content"], { type: "application/pdf" }),
    "qa-research.pdf",
  );
  bookingForm.append(
    "documents",
    new Blob(["document-content"], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }),
    "qa-assignment.docx",
  );
  const booking = await request("/appointments", {
    method: "POST",
    token: studentLogin.data.token,
    body: bookingForm,
  });
  check(
    booking.status === 201 && booking.data.appointment.status === "Pending",
    "student creates Pending appointment",
  );
  const availabilityAfterBooking = await request(
    `/availability/faculty/${facultyLogin.data.user.id}`,
    { token: studentLogin.data.token },
  );
  check(
    availabilityAfterBooking.data.schedules[0].hasActiveRequest === true &&
      availabilityAfterBooking.data.schedules[0].requestStatus === "Pending" &&
      availabilityAfterBooking.data.schedules[0].appointmentId ===
        booking.data.appointment._id,
    "student availability response identifies the existing Pending request",
  );
  const blockedDuplicate = await request("/appointments", {
    method: "POST",
    token: studentLogin.data.token,
    body: {
      availabilityId: schedule.data.availability._id,
      estimatedDurationMinutes: 10,
      yearLevel: "4th Year",
      subject: "Blocked Duplicate",
      reason: "Duplicate-rule verification",
    },
  });
  check(
    blockedDuplicate.status === 409 &&
      blockedDuplicate.data.message ===
        "You already have an active consultation request for this faculty schedule.",
    "backend blocks the same Student from duplicating an active request",
  );
  const facultyNotifications = await request("/notifications", {
    token: facultyLogin.data.token,
  });
  const submittedNotifications = await request("/notifications", {
    token: studentLogin.data.token,
  });
  check(
    facultyNotifications.data.notifications.some(
      (item) => item.title === "New Consultation Request",
    ) &&
      submittedNotifications.data.notifications.some(
        (item) => item.title === "Consultation Request Submitted",
      ),
    "booking creates recipient-scoped Student and Faculty notifications",
  );
  const extraStudentTokens = [];
  const passwordHash = await bcrypt.hash(password, 12);
  for (let index = 2; index <= 7; index += 1) {
    const extraStudent = await User.create({
      name: `ConsultIO QA Student ${index}`,
      email: `consultio.qa.student.${stamp}.${index}@student.hau.edu.ph`,
      studentId: `QA-S-${stamp}-${index}`,
      program: "Bachelor of Science in Information Technology",
      password: passwordHash,
      role: "student",
      registrationStatus: "Approved",
      accountStatus: "Active",
      approvedBy: deanDoc.id,
      approvedAt: new Date(),
    });
    createdUsers.push(extraStudent.id);
    const login = await request("/auth/login/student", {
      method: "POST",
      body: { identifier: extraStudent.email, password },
    });
    check(login.status === 200, `additional student ${index} can log in`);
    extraStudentTokens.push(login.data.token);
  }
  for (const [index, token] of extraStudentTokens.entries()) {
    const additionalBooking = await request("/appointments", {
      method: "POST",
      token,
      body: {
        availabilityId: schedule.data.availability._id,
        estimatedDurationMinutes: 10,
        yearLevel: "4th Year",
        subject: `Shared Window Request ${index + 2}`,
        reason: "Capacity workflow verification",
      },
    });
    check(
      additionalBooking.status === 201,
      `student ${index + 2} can request the same availability window`,
    );
  }
  const deanAppointments = await request("/dean/appointments", {
    token: deanToken,
  });
  const pendingDeanDashboard = await request("/dashboard/dean", {
    token: deanToken,
  });
  check(
    deanAppointments.data.appointments.some(
      (item) => item._id === booking.data.appointment._id,
    ) && pendingDeanDashboard.data.stats.pendingAppointments >= 1,
    "dean monitors the same Pending appointment and dashboard count",
  );
  const facultyRequests = await request("/appointments/mine", {
    token: facultyLogin.data.token,
  });
  check(
    facultyRequests.data.appointments.some(
      (x) =>
        x._id === booking.data.appointment._id &&
        x.supportingDocuments.length === 3,
    ),
    "faculty sees one student request with three supporting documents",
  );
  const capacity = facultyRequests.data.availabilityCapacity.find(
    (item) => item.availabilityId === schedule.data.availability._id,
  );
  check(
    capacity?.pendingCount === 7 &&
      capacity.pendingEstimatedMinutes === 70 &&
      capacity.capacityMinutes === 60,
    "faculty sees seven requests totaling 70 minutes for a 60-minute window",
  );
  const savedDocuments = await SupportingDocument.find({
    appointment: booking.data.appointment._id,
  });
  check(
    savedDocuments.length === 3,
    "three supporting documents are stored for one appointment",
  );
  const rejectedOriginal = await request(
    `/appointments/${booking.data.appointment._id}/status`,
    {
      method: "PUT",
      token: facultyLogin.data.token,
      body: { status: "Rejected", note: "QA retry verification" },
    },
  );
  check(
    rejectedOriginal.status === 200,
    "faculty can reject the original request",
  );
  const availabilityAfterRejection = await request(
    `/availability/faculty/${facultyLogin.data.user.id}`,
    { token: studentLogin.data.token },
  );
  check(
    availabilityAfterRejection.data.schedules[0].hasActiveRequest === false,
    "Rejected request releases the schedule for the same Student",
  );
  const replacementBooking = await request("/appointments", {
    method: "POST",
    token: studentLogin.data.token,
    body: {
      availabilityId: schedule.data.availability._id,
      estimatedDurationMinutes: 10,
      yearLevel: "4th Year",
      subject: "Replacement QA Consultation",
      reason: "Retry after Faculty rejection",
    },
  });
  check(
    replacementBooking.status === 201 &&
      (await Appointment.findById(booking.data.appointment._id)).status ===
        "Rejected",
    "same Student can create a new request while the Rejected record remains",
  );
  const cancelledReplacement = await request(
    `/appointments/${replacementBooking.data.appointment._id}/cancel`,
    { method: "PUT", token: studentLogin.data.token },
  );
  check(
    cancelledReplacement.status === 200,
    "student can cancel the replacement request",
  );
  const finalBooking = await request("/appointments", {
    method: "POST",
    token: studentLogin.data.token,
    body: {
      availabilityId: schedule.data.availability._id,
      estimatedDurationMinutes: 10,
      yearLevel: "4th Year",
      subject: "Final QA Consultation",
      reason: "Retry after Student cancellation",
    },
  });
  check(
    finalBooking.status === 201 &&
      (await Appointment.findById(replacementBooking.data.appointment._id))
        .status === "Cancelled",
    "same Student can retry while the Cancelled record remains",
  );
  const appointmentApproval = await request(
    `/appointments/${finalBooking.data.appointment._id}/status`,
    {
      method: "PUT",
      token: facultyLogin.data.token,
      body: { status: "Approved" },
    },
  );
  check(
    appointmentApproval.status === 200 &&
      appointmentApproval.data.appointment.status === "Approved",
    "faculty approves appointment",
  );
  const blockedAfterApproval = await request("/appointments", {
    method: "POST",
    token: studentLogin.data.token,
    body: {
      availabilityId: schedule.data.availability._id,
      estimatedDurationMinutes: 10,
      yearLevel: "4th Year",
      subject: "Blocked Approved Duplicate",
      reason: "Approved duplicate verification",
    },
  });
  check(
    blockedAfterApproval.status === 409,
    "Approved request continues to block same-Student duplicates",
  );
  const studentNotifications = await request("/notifications", {
    token: studentLogin.data.token,
  });
  const approvalNotification = studentNotifications.data.notifications.find(
    (item) => item.title === "Consultation Approved",
  );
  check(
    Boolean(approvalNotification) && studentNotifications.data.unreadCount >= 1,
    "Student receives an unread Consultation Approved notification",
  );
  const markedRead = await request(
    `/notifications/${approvalNotification._id}/read`,
    { method: "PUT", token: studentLogin.data.token },
  );
  const refreshedNotifications = await request("/notifications", {
    token: studentLogin.data.token,
  });
  check(
    markedRead.data.notification.isRead === true &&
      Boolean(markedRead.data.notification.readAt) &&
      refreshedNotifications.data.notifications.find(
        (item) => item._id === approvalNotification._id,
      )?.isRead === true &&
      refreshedNotifications.data.unreadCount ===
        studentNotifications.data.unreadCount - 1,
    "Mark as Read persists in MongoDB and decreases unread count",
  );
  const studentAppointments = await request("/appointments/mine", {
    token: studentLogin.data.token,
  });
  check(
    studentAppointments.data.appointments.some(
      (x) =>
        x._id === finalBooking.data.appointment._id && x.status === "Approved",
    ),
    "student immediately sees Approved appointment",
  );
  const deanDashboard = await request("/dashboard/dean", {
    token: deanToken,
  });
  check(
    deanDashboard.status === 200 &&
      deanDashboard.data.stats.totalAppointments >= 1 &&
      deanDashboard.data.stats.approvedAppointments >= 1,
    "dean dashboard uses live Approved appointment totals",
  );
  check(
    Boolean(await AuditLog.exists({ action: "registration_approved" })),
    "audit log contains approval action",
  );

  const scheduleDetails = await request(
    `/availability/${schedule.data.availability._id}/details`,
    { token: facultyLogin.data.token },
  );
  check(
    scheduleDetails.status === 200 &&
      scheduleDetails.data.approvedStudents.length === 1 &&
      scheduleDetails.data.approvedStudents[0]._id ===
        finalBooking.data.appointment._id,
    "schedule details include only the exact schedule's approved student",
  );
  const approvedCancellation = await request(
    `/appointments/${finalBooking.data.appointment._id}/cancel`,
    { method: "PUT", token: studentLogin.data.token },
  );
  check(
    approvedCancellation.status === 409 &&
      (await Appointment.findById(finalBooking.data.appointment._id)).status ===
        "Approved",
    "Student cannot cancel an Approved appointment",
  );
  const studentCannotReadFacultySchedule = await request(
    `/availability/${schedule.data.availability._id}/details`,
    { token: studentLogin.data.token },
  );
  check(
    studentCannotReadFacultySchedule.status === 403,
    "student cannot access Faculty schedule management details",
  );
  const outsiderPassword = await bcrypt.hash(password, 12);
  const outsiderFaculty = await User.create({
    name: "ConsultIO QA Outside Faculty",
    email: `consultio.qa.outside.${stamp}@hau.edu.ph`,
    employeeId: `QA-OUT-${stamp}`,
    password: outsiderPassword,
    role: "faculty",
    registrationStatus: "Approved",
    accountStatus: "Active",
    approvedBy: deanDoc.id,
    approvedAt: new Date(),
  });
  createdUsers.push(outsiderFaculty.id);
  const outsiderLogin = await request("/auth/login/faculty", {
    method: "POST",
    body: { identifier: outsiderFaculty.email, password },
  });
  const emptyRescheduleReason = await request(
    `/appointments/${finalBooking.data.appointment._id}/request-reschedule`,
    { method: "PUT", token: studentLogin.data.token, body: { reason: "   " } },
  );
  check(
    emptyRescheduleReason.status === 400,
    "Student reschedule request requires a meaningful reason",
  );
  const foreignStudentRequest = await request(
    `/appointments/${finalBooking.data.appointment._id}/request-reschedule`,
    {
      method: "PUT",
      token: extraStudentTokens[0],
      body: { reason: "Trying another Student's appointment" },
    },
  );
  check(
    foreignStudentRequest.status === 404,
    "Student cannot request rescheduling for another Student's appointment",
  );
  const preservedBeforeReview = await Appointment.findById(
    finalBooking.data.appointment._id,
  ).lean();
  const studentRequest = await request(
    `/appointments/${finalBooking.data.appointment._id}/request-reschedule`,
    {
      method: "PUT",
      token: studentLogin.data.token,
      body: { reason: "Faculty consultation conflicts with an exam." },
    },
  );
  const pendingReview = await Appointment.findById(
    finalBooking.data.appointment._id,
  ).lean();
  check(
    studentRequest.status === 200 &&
      pendingReview.status === "Approved" &&
      pendingReview.rescheduleRequestStatus === "Pending" &&
      pendingReview.rescheduleRequestNote ===
        "Faculty consultation conflicts with an exam." &&
      String(pendingReview.availability) === schedule.data.availability._id,
    "Student request remains assigned and Pending Faculty review",
  );
  const duplicateRequest = await request(
    `/appointments/${finalBooking.data.appointment._id}/request-reschedule`,
    {
      method: "PUT",
      token: studentLogin.data.token,
      body: { reason: "A duplicate reschedule request." },
    },
  );
  check(
    duplicateRequest.status === 409,
    "Student cannot submit a duplicate pending reschedule request",
  );
  const facultyPendingRequests = await request("/appointments/mine", {
    token: facultyLogin.data.token,
  });
  check(
    facultyPendingRequests.data.appointments.some(
      (item) =>
        item._id === finalBooking.data.appointment._id &&
        item.rescheduleRequestStatus === "Pending" &&
        item.rescheduleRequestNote ===
          "Faculty consultation conflicts with an exam.",
    ),
    "Faculty sees the pending request and Student reason",
  );
  const outsiderAttempt = await request(
    `/appointments/${finalBooking.data.appointment._id}/reschedule-request`,
    {
      method: "PUT",
      token: outsiderLogin.data.token,
      body: { decision: "Approved" },
    },
  );
  check(
    outsiderAttempt.status === 404 &&
      (await Appointment.findById(finalBooking.data.appointment._id))
        .rescheduleRequestStatus === "Pending",
    "Faculty cannot review another Faculty member's reschedule request",
  );
  const facultyRejects = await request(
    `/appointments/${finalBooking.data.appointment._id}/reschedule-request`,
    {
      method: "PUT",
      token: facultyLogin.data.token,
      body: {
        decision: "Rejected",
        note: "The original schedule is required.",
      },
    },
  );
  const rejectedReschedule = await Appointment.findById(
    finalBooking.data.appointment._id,
  );
  check(
    facultyRejects.status === 200 &&
      rejectedReschedule.status === "Approved" &&
      rejectedReschedule.rescheduleRequestStatus === "Rejected" &&
      String(rejectedReschedule.availability) ===
        schedule.data.availability._id,
    "Faculty rejection keeps the approved appointment on its current schedule",
  );
  check(
    Boolean(
      await Notification.exists({
        recipient: studentLogin.data.user.id,
        relatedEntityId: finalBooking.data.appointment._id,
        title: "Reschedule Request Rejected",
      }),
    ),
    "Faculty rejection notifies the Student",
  );
  const secondStudentRequest = await request(
    `/appointments/${finalBooking.data.appointment._id}/request-reschedule`,
    {
      method: "PUT",
      token: studentLogin.data.token,
      body: { reason: "A new exam schedule still conflicts." },
    },
  );
  check(
    secondStudentRequest.status === 200,
    "Student may submit a new request after rejection",
  );
  const facultyApproves = await request(
    `/appointments/${finalBooking.data.appointment._id}/reschedule-request`,
    {
      method: "PUT",
      token: facultyLogin.data.token,
      body: { decision: "Approved" },
    },
  );
  const releasedAppointment = await Appointment.findById(
    finalBooking.data.appointment._id,
  ).lean();
  check(
    facultyApproves.status === 200 &&
      releasedAppointment.status === "Needs Reschedule" &&
      releasedAppointment.rescheduleRequestStatus === "Approved" &&
      String(releasedAppointment.availability) ===
        schedule.data.availability._id &&
      releasedAppointment.subject === preservedBeforeReview.subject &&
      releasedAppointment.reason === preservedBeforeReview.reason &&
      releasedAppointment.createdAt.getTime() ===
        preservedBeforeReview.createdAt.getTime(),
    "Faculty approval preserves the appointment and releases its schedule assignment",
  );
  const releasedDetails = await request(
    `/availability/${schedule.data.availability._id}/details`,
    { token: facultyLogin.data.token },
  );
  check(
    releasedDetails.data.approvedStudents.length === 0,
    "approved reschedule no longer occupies the old schedule",
  );
  check(
    Boolean(
      await Notification.exists({
        recipient: studentLogin.data.user.id,
        relatedEntityId: finalBooking.data.appointment._id,
        title: "Reschedule Request Approved",
      }),
    ),
    "Faculty approval notifies the Student to choose a new schedule",
  );
  const replacementStartAt = new Date(endAt.getTime() + 24 * 60 * 60 * 1000);
  const replacementEndAt = new Date(
    replacementStartAt.getTime() + 60 * 60 * 1000,
  );
  const replacementSchedule = await request("/availability", {
    method: "POST",
    token: facultyLogin.data.token,
    body: {
      startAt: replacementStartAt,
      endAt: replacementEndAt,
      location: "CT-205",
      mode: "Face-to-Face",
    },
  });
  check(
    replacementSchedule.status === 201,
    "Faculty publishes a valid replacement schedule",
  );
  const studentReschedule = await request(
    `/appointments/${finalBooking.data.appointment._id}/reschedule`,
    {
      method: "PUT",
      token: studentLogin.data.token,
      body: { availabilityId: replacementSchedule.data.availability._id },
    },
  );
  const reassignedAppointment = await Appointment.findById(
    finalBooking.data.appointment._id,
  );
  check(
    studentReschedule.status === 200 &&
      reassignedAppointment.status === "Rescheduled" &&
      String(reassignedAppointment.availability) ===
        replacementSchedule.data.availability._id,
    "Student reuses the preserved appointment on a new valid schedule",
  );
  const replacementDetails = await request(
    `/availability/${replacementSchedule.data.availability._id}/details`,
    { token: facultyLogin.data.token },
  );
  check(
    replacementDetails.data.approvedStudents.some(
      (item) => item._id === finalBooking.data.appointment._id,
    ),
    "rescheduled student appears only on the newly selected schedule",
  );
  const pastEndAt = new Date(Date.now() - 60 * 60 * 1000);
  const pastStartAt = new Date(pastEndAt.getTime() - 60 * 60 * 1000);
  const unresolvedPastAppointment = await Appointment.create({
    student: createdUsers[3],
    faculty: facultyLogin.data.user.id,
    availability: schedule.data.availability._id,
    startAt: pastStartAt,
    endAt: pastEndAt,
    estimatedDurationMinutes: 10,
    subject: "Past Consultation Outcome Check",
    yearLevel: "4th Year",
    reason: "Verify Faculty can record a missed past consultation.",
    consultationMode: "Face-to-Face",
    location: "CT-204",
    status: "Approved",
  });
  const markNoShow = await request(
    `/appointments/${unresolvedPastAppointment.id}/status`,
    {
      method: "PUT",
      token: facultyLogin.data.token,
      body: { status: "No Show" },
    },
  );
  check(
    markNoShow.status === 200 &&
      (await Appointment.findById(unresolvedPastAppointment.id)).status ===
        "No Show",
    "Faculty can resolve a past Approved consultation as No Show",
  );

  const expiredEndAt = new Date(Date.now() - 60 * 1000);
  const expiredStartAt = new Date(expiredEndAt.getTime() - 60 * 60 * 1000);
  const expiredSchedule = await Availability.create({
    faculty: facultyLogin.data.user.id,
    startAt: expiredStartAt,
    endAt: expiredEndAt,
    mode: "Online",
    meetingPlatform: "Google Meet",
    isActive: true,
  });
  const [expiredPending, expiredApproved] = await Appointment.create([
    {
      student: studentLogin.data.user.id,
      faculty: facultyLogin.data.user.id,
      availability: expiredSchedule.id,
      startAt: expiredStartAt,
      endAt: expiredEndAt,
      estimatedDurationMinutes: 10,
      subject: "Expired Pending Consultation",
      reason: "Verify expired pending request handling.",
      status: "Pending",
    },
    {
      student: studentLogin.data.user.id,
      faculty: facultyLogin.data.user.id,
      availability: expiredSchedule.id,
      startAt: expiredStartAt,
      endAt: expiredEndAt,
      estimatedDurationMinutes: 10,
      subject: "Expired Approved Consultation",
      reason: "Verify approved outcome remains Faculty-controlled.",
      status: "Approved",
    },
  ]);
  const expiredMine = await request("/availability/mine", {
    token: facultyLogin.data.token,
  });
  check(
    expiredMine.status === 200 &&
      expiredMine.data.availability.find(
        (item) => item._id === expiredSchedule.id,
      )?.status === "expired",
    "expired availability remains visible with derived expired status",
  );
  const expiredRequestSchedules = await request(
    "/availability/request-schedules",
    { token: facultyLogin.data.token },
  );
  check(
    !expiredRequestSchedules.data.schedules.some(
      (item) => item._id === expiredSchedule.id,
    ),
    "expired availability is excluded from Faculty request schedules",
  );
  const expiredStudentSchedules = await request(
    `/availability/faculty/${facultyLogin.data.user.id}`,
    { token: studentLogin.data.token },
  );
  check(
    !expiredStudentSchedules.data.schedules.some(
      (item) => item._id === expiredSchedule.id,
    ),
    "expired availability is excluded from Student booking schedules",
  );
  check(
    (await Appointment.findById(expiredPending.id)).status ===
      "Needs Reschedule" &&
      (await Appointment.findById(expiredApproved.id)).status === "Approved",
    "expiration reschedules Pending requests without completing Approved appointments",
  );
  await request("/availability/mine", { token: facultyLogin.data.token });
  check(
    (await Notification.countDocuments({
      recipient: facultyLogin.data.user.id,
      type: "schedule",
      title: "Consultation Schedule Expired",
      relatedEntityId: expiredSchedule.id,
    })) === 1,
    "expiration notification is created once per Faculty schedule",
  );

  const changed = await request("/dean/settings/password", {
    method: "PUT",
    token: deanToken,
    body: {
      currentPassword: (process.env.DEAN_PASSWORD || process.env.ADMIN_PASSWORD),
      newPassword: "Temporary-QA-Password-2026!",
    },
  });
  check(changed.status === 200, "dean password change validates and saves");
  await User.updateOne(
    { _id: deanDoc.id },
    {
      $set: { password: originalDeanHash },
      ...(originalChangedAt
        ? {
            $set: {
              password: originalDeanHash,
              passwordChangedAt: originalChangedAt,
            },
          }
        : { $unset: { passwordChangedAt: 1 } }),
    },
  );

  await stopHttp();
  await new Promise((resolve) => setTimeout(resolve, 250));
  await startHttp();
  for (const test of [
    { role: "faculty", email: facultyEmail },
    { role: "student", email: studentEmail },
  ]) {
    const repeat = await request(`/auth/login/${test.role}`, {
      method: "POST",
      body: { identifier: test.email, password },
    });
    check(
      repeat.status === 200,
      `${test.role} remains Approved after server restart`,
    );
  }
  const forbiddenReset = await request(
    `/dean/users/${createdUsers[0]}/reset-password`,
    {
      method: "PUT",
      token: studentLogin.data.token,
      body: {
        newPassword: "Reset-QA-Password-2026!",
        confirmPassword: "Reset-QA-Password-2026!",
      },
    },
  );
  check(
    forbiddenReset.status === 403,
    "student cannot access the dean password reset endpoint",
  );
  const resetPassword = "Reset-QA-Password-2026!";
  for (const [index, test] of [
    { role: "faculty", email: facultyEmail },
    { role: "student", email: studentEmail },
  ].entries()) {
    const reset = await request(
      `/dean/users/${createdUsers[index]}/reset-password`,
      {
        method: "PUT",
        token: deanToken,
        body: {
          newPassword: resetPassword,
          confirmPassword: resetPassword,
        },
      },
    );
    check(reset.status === 200, `dean resets ${test.role} password`);
    const oldLogin = await request(`/auth/login/${test.role}`, {
      method: "POST",
      body: { identifier: test.email, password },
    });
    const newLogin = await request(`/auth/login/${test.role}`, {
      method: "POST",
      body: { identifier: test.email, password: resetPassword },
    });
    const storedUser = await User.findById(createdUsers[index]);
    check(
      oldLogin.status === 401 &&
        newLogin.status === 200 &&
        storedUser.registrationStatus === "Approved" &&
        storedUser.accountStatus === "Active" &&
        Boolean(storedUser.passwordChangedAt),
      `${test.role} uses the new password and remains Approved/Active`,
    );
  }
  check(
    (await AuditLog.countDocuments({
      action: "dean_password_reset",
      targetId: { $in: createdUsers },
    })) === 2,
    "dean password resets are recorded in audit logs",
  );
  console.log("E2E_RESULT=PASS");
} finally {
  if (server?.listening) await stopHttp();
  if (createdUsers.length) {
    const appointments = await Appointment.find({
      $or: [
        { student: { $in: createdUsers } },
        { faculty: { $in: createdUsers } },
      ],
    }).select("_id");
    const appointmentIds = appointments.map((x) => x.id);
    await Promise.all([
      SupportingDocument.deleteMany({ appointment: { $in: appointmentIds } }),
      Appointment.deleteMany({ _id: { $in: appointmentIds } }),
      Availability.deleteMany({ faculty: { $in: createdUsers } }),
      Notification.deleteMany({
        $or: [
          { recipient: { $in: createdUsers } },
          { relatedEntityId: { $in: [...createdUsers, ...appointmentIds] } },
        ],
      }),
      AuditLog.deleteMany({
        $or: [
          { actor: { $in: createdUsers } },
          { targetId: { $in: [...createdUsers, ...appointmentIds] } },
        ],
      }),
      User.deleteMany({ _id: { $in: createdUsers } }),
    ]);
  }
  await mongoose.disconnect();
}
