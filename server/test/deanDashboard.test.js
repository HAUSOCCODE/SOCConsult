import assert from "node:assert/strict";
import { test } from "node:test";
import jwt from "jsonwebtoken";
import app from "../src/app.js";
import { env } from "../src/config/env.js";
import User from "../src/models/User.js";
import Appointment from "../src/models/Appointment.js";
import AccountImport from "../src/models/AccountImport.js";
import {
  parseDashboardRange,
  readDeanDashboard,
} from "../src/services/deanDashboardService.js";
import { readFile } from "node:fs/promises";

const chain = (value, log = []) => {
  const result = { then: (yes, no) => Promise.resolve(value).then(yes, no) };
  for (const method of [
    "select",
    "populate",
    "sort",
    "limit",
    "maxTimeMS",
    "lean",
    "option",
  ])
    result[method] = (...args) => {
      log.push([method, ...args]);
      return result;
    };
  return result;
};
test("Manila ranges default locally, reject invalid inputs, and cap inclusive days", () => {
  const parsed = parseDashboardRange({}, new Date("2026-09-30T16:00:00Z"));
  assert.equal(parsed.range.start, "2026-10-01");
  assert.equal(parsed.range.end, "2026-10-31");
  assert.equal(
    parsed.filter.createdAt.$gte.toISOString(),
    "2026-09-30T16:00:00.000Z",
  );
  assert.equal(
    parsed.filter.createdAt.$lt.toISOString(),
    "2026-10-31T16:00:00.000Z",
  );
  for (const query of [
    { start: "2026-02-30", end: "2026-03-01" },
    { start: "2026-01-01" },
    { start: ["2026-01-01"], end: "2026-01-01" },
    { start: "2026-1-01", end: "2026-01-01" },
    { start: "2026-01-02", end: "2026-01-01" },
    { start: "2024-01-01", end: "2025-01-01" },
  ])
    assert.equal(parseDashboardRange(query), null);
  assert.ok(parseDashboardRange({ start: "2024-01-01", end: "2024-12-31" }));
  assert.ok(parseDashboardRange({ start: "2026-01-01", end: "2026-01-01" }));
});

test("dashboard uses exact counts, bounded safe lists, role authorization and sanitized errors without writes", async () => {
  const restores = [],
    logs = { imports: [], appointments: [] };
  const patch = (object, key, value) => {
    const previous = object[key];
    object[key] = value;
    restores.push(() => {
      object[key] = previous;
    });
  };
  const users = [
    {
      role: "student",
      accountStatus: "Active",
      registrationStatus: "Approved",
    },
    { role: "student", accountStatus: "Active" },
    { role: "student", accountStatus: "Active", registrationStatus: null },
    ...["Pending", "Rejected", "Unknown", ""].map((registrationStatus) => ({
      role: "student",
      accountStatus: "Active",
      registrationStatus,
    })),
    {
      role: "student",
      accountStatus: "Inactive",
      registrationStatus: "Approved",
    },
    {
      role: "faculty",
      accountStatus: "Active",
      registrationStatus: "Approved",
    },
    { role: "faculty", accountStatus: "Active" },
    { role: "dean", accountStatus: "Active", registrationStatus: "Approved" },
    { role: "admin", accountStatus: "Active" },
  ];
  const records = [
    ...Appointment.schema
      .path("status")
      .enumValues.map((status) => ({
        status,
        createdAt: new Date("2026-10-01T00:00:00Z"),
      })),
    { status: "Pending", createdAt: new Date("2026-09-30T16:00:00Z") },
    { status: "Completed", createdAt: new Date("2026-10-31T16:00:00Z") },
    { status: "Pending", createdAt: new Date("2026-09-30T15:59:59Z") },
  ];
  patch(User, "countDocuments", (filter) => {
    assert.deepEqual(filter.registrationStatus, { $in: ["Approved", null] });
    return chain(
      users.filter(
        (user) =>
          user.role === filter.role &&
          user.accountStatus === "Active" &&
          (user.registrationStatus === "Approved" ||
            user.registrationStatus == null),
      ).length,
    );
  });
  let fail = false;
  patch(Appointment, "aggregate", (pipeline) => {
    if (fail) throw new Error("SECRET_DATABASE_ERROR");
    const range = pipeline[0].$match.createdAt;
    const selected = records.filter(
      (record) =>
        record.createdAt >= range.$gte && record.createdAt < range.$lt,
    );
    assert.deepEqual(pipeline[1].$group.pending.$sum.$cond[0], {
      $eq: ["$status", "Pending"],
    });
    assert.deepEqual(pipeline[1].$group.completed.$sum.$cond[0], {
      $eq: ["$status", "Completed"],
    });
    return chain([
      {
        total: selected.length,
        pending: selected.filter((r) => r.status === "Pending").length,
        completed: selected.filter((r) => r.status === "Completed").length,
      },
    ]);
  });
  patch(AccountImport, "find", (filter) => {
    assert.deepEqual(filter, {
      status: "completed",
      importedAt: { $type: "date" },
      successfulRows: { $gte: 0 },
      failedRows: { $gte: 0 },
    });
    return chain(
      [
        {
          previewId: "safe-batch",
          importedAt: new Date(),
          successfulRows: 3,
          failedRows: 0,
          status: "completed",
          rows: "SECRET",
          attemptToken: "SECRET",
        },
      ],
      logs.imports,
    );
  });
  patch(Appointment, "find", (filter) => {
    assert.deepEqual(
      filter,
      parseDashboardRange({ start: "2026-10-01", end: "2026-10-31" }).filter,
    );
    return chain(
      [
        {
          _id: "safe-record",
          subject: "Course",
          status: "Pending",
          student: { name: "Student", password: "SECRET" },
          faculty: { name: "Faculty" },
          updatedAt: new Date(),
          meetingLink: "SECRET",
          supportingDocuments: "SECRET",
          reason: "SECRET",
          availability: "SECRET",
        },
      ],
      logs.appointments,
    );
  });
  for (const model of [User, Appointment, AccountImport])
    for (const method of [
      "create",
      "updateOne",
      "updateMany",
      "findOneAndUpdate",
      "deleteOne",
      "deleteMany",
    ])
      patch(model, method, () => assert.fail("Dashboard must not mutate"));
  patch(User, "findById", async (id) => ({
    id,
    role: String(id),
    accountStatus: "Active",
    registrationStatus: "Approved",
  }));
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const base = `http://127.0.0.1:${server.address().port}/api/dashboard/dean`;
  const request = (role, suffix = "?start=2026-10-01&end=2026-10-31") =>
    fetch(base + suffix, {
      headers: {
        ...(role && {
          Authorization: `Bearer ${jwt.sign({ sub: role }, env.jwtSecret)}`,
        }),
        Connection: "close",
      },
    });
  try {
    assert.equal((await request()).status, 401);
    for (const role of ["student", "faculty"])
      assert.equal((await request(role)).status, 403);
    const response = await request("dean");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json();
    assert.equal(body.accounts.activeStudents, 3);
    assert.equal(body.accounts.activeFaculty, 2);
    assert.deepEqual(body.consultations, {
      total: 15, // Canonical and recognized legacy records remain counted.
      byStatus: { pending: 2, completed: 1 },
    });
    assert.doesNotMatch(
      JSON.stringify(body),
      /SECRET|pendingRegistrations|confirmed|attendanceReview|expired|meetingLink|supportingDocuments/,
    );
    assert.deepEqual(Object.keys(body.recentImports[0]), [
      "importId",
      "completedAt",
      "successfulRows",
      "failedRows",
      "status",
    ]);
    assert.deepEqual(Object.keys(body.recentConsultations[0]), [
      "reference",
      "studentName",
      "facultyName",
      "subject",
      "status",
      "scheduledAt",
      "updatedAt",
    ]);
    for (const log of Object.values(logs)) {
      assert.ok(
        log.some(([method, value]) => method === "limit" && value === 5),
      );
      assert.ok(log.some(([method]) => method === "select"));
    }
    assert.ok(
      logs.imports.some(
        ([method, value]) =>
          method === "sort" && value.importedAt === -1 && value._id === -1,
      ),
    );
    assert.ok(
      logs.appointments.some(
        ([method, value]) =>
          method === "sort" && value.updatedAt === -1 && value._id === -1,
      ),
    );
    for (const suffix of [
      "?start=bad&end=bad",
      "?start=2024-01-01&end=2025-01-01",
    ])
      assert.equal((await request("dean", suffix)).status, 400);
    fail = true;
    const failed = await request("dean");
    assert.equal(failed.status, 503);
    assert.doesNotMatch(await failed.text(), /SECRET/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    restores.reverse().forEach((restore) => restore());
  }
});

test("Dean endpoint and page do not import AI or mutate statuses", async () => {
  for (const path of [
    "services/deanDashboardService.js",
    "controllers/deanDashboardController.js",
  ]) {
    const source = await readFile(
      new URL(`../src/${path}`, import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(
      source,
      /aiReporting|aiController|groq|\.save\(|\.create\(|updateOne|findOneAndUpdate/,
    );
  }
});
