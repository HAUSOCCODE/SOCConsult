import assert from "node:assert/strict";
import { test } from "node:test";
import Appointment from "../src/models/Appointment.js";
import Notification from "../src/models/Notification.js";
import { getStudentDashboard } from "../src/routes/dashboardRoutes.js";

const chain = (value, calls) => {
  const query = {
    then: (resolve, reject) => Promise.resolve(value).then(resolve, reject),
  };
  for (const method of ["select", "populate", "sort", "limit", "lean"])
    query[method] = (...args) => {
      calls.push([method, ...args]);
      return query;
    };
  return query;
};

test("Student dashboard uses authenticated ownership, approved statuses, and bounded safe lists", async () => {
  const restores = [];
  const patch = (object, key, value) => {
    const previous = object[key];
    object[key] = value;
    restores.push(() => {
      object[key] = previous;
    });
  };
  const appointmentFilters = [];
  const notificationFilters = [];
  const nextCalls = [];
  const recentCalls = [];
  const notificationCalls = [];
  let appointmentCount = 0;

  patch(Appointment, "aggregate", async () => []);
  patch(Appointment, "countDocuments", async (filter) => {
    appointmentFilters.push(filter);
    appointmentCount += 1;
    return appointmentCount;
  });
  patch(Notification, "countDocuments", async (filter) => {
    notificationFilters.push(filter);
    return 4;
  });
  patch(Appointment, "findOne", (filter) => {
    appointmentFilters.push(filter);
    return chain({ _id: "next", status: "Confirmed" }, nextCalls);
  });
  patch(Appointment, "find", (filter) => {
    appointmentFilters.push(filter);
    return chain([{ _id: "recent", status: "Pending" }], recentCalls);
  });
  patch(Notification, "find", (filter) => {
    notificationFilters.push(filter);
    return chain([{ _id: "notification", isRead: false }], notificationCalls);
  });

  let body;
  try {
    await getStudentDashboard(
      { user: { id: "student-a" }, query: { studentId: "student-b" } },
      { json: (value) => (body = value) },
    );
  } finally {
    restores.reverse().forEach((restore) => restore());
  }

  assert.deepEqual(Object.keys(body), [
    "upcomingCount",
    "pendingCount",
    "attendanceRequiredCount",
    "unreadNotificationCount",
    "nextConsultation",
    "recentConsultations",
    "recentNotifications",
    "attendanceSummary",
  ]);
  assert.equal(body.upcomingCount, 1);
  assert.equal(body.pendingCount, 2);
  assert.equal(body.attendanceRequiredCount, 3);
  assert.equal(body.unreadNotificationCount, 4);
  assert.ok(appointmentFilters.every((filter) => filter.student === "student-a"));
  assert.ok(notificationFilters.every((filter) => filter.recipient === "student-a"));
  assert.equal(appointmentFilters[0].status, "Confirmed");
  assert.equal(appointmentFilters[1].status, "Pending");
  assert.equal(appointmentFilters[2].status, "Awaiting Attendance Update");
  assert.equal(appointmentFilters[3].status, "Confirmed");
  assert.deepEqual(appointmentFilters[4].status.$in, [
    "Pending",
    "Reschedule Proposed",
    "Confirmed",
    "Rejected",
    "Cancelled",
    "Expired",
    "Awaiting Attendance Update",
    "Completed",
    "Attendance Review",
  ]);
  assert.ok(nextCalls.some(([method, value]) => method === "sort" && value.startAt === 1));
  assert.ok(recentCalls.some(([method, value]) => method === "sort" && value.createdAt === -1));
  assert.ok(recentCalls.some(([method, value]) => method === "limit" && value === 5));
  assert.ok(notificationCalls.some(([method, value]) => method === "limit" && value === 5));
});
