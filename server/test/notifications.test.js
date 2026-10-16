import assert from "node:assert/strict";
import { test } from "node:test";
import jwt from "jsonwebtoken";
import app from "../src/app.js";
import { env } from "../src/config/env.js";
import Notification from "../src/models/Notification.js";
import User from "../src/models/User.js";
import { createEventNotification, bestEffortNotification, publicNotification, safeActionUrl, CATEGORIES } from "../src/services/notificationService.js";
import { appointmentHarness, fixture, newId } from "./helpers/appointmentHarness.js";
import { processAttendance } from "../src/services/attendanceService.js";
import { attendanceEnrollment } from "../src/config/attendance.js";
import { readFile } from "node:fs/promises";

test("event templates, safe destinations, source keys and observable delivery failures", async () => {
  const oldCreate = Notification.create, oldUpdate = Notification.updateOne, oldWarn = console.warn;
  const records = [], warnings = [], session = {};
  Notification.create = async (rows, options) => { assert.equal(options.session, session); records.push(...rows); return rows; };
  Notification.updateOne = async (filter, update, options) => {
    assert.equal(options.upsert, true);
    if (!records.some(n => n.recipient === filter.recipient && n.deduplicationKey === filter.deduplicationKey)) records.push(update.$setOnInsert);
  };
  console.warn = value => warnings.push(value);
  const id = newId(), recipient = newId(), preview = "00000000-0000-4000-8000-000000000001";
  try {
    for (const [event, category, actionUrl] of [
      ["import_completed", "Management", `/dean/import?preview=${preview}`],
      ["import_failed", "Management", `/dean/import?preview=${preview}`],
      ["account_created", "Management", `/dean/users?userId=${id}`],
      ["account_deactivated", "Management", `/dean/users?userId=${id}`],
      ["account_reactivated", "Management", `/dean/users?userId=${id}`],
      ["attendance_review_created", "Attendance", `/dean/attendance-review/${id}`],
      ["report_generated", "Report", "/dean/reports"],
      ["ai_summary_failed", "Report", "/dean/reports"],
    ]) {
      await createEventNotification({ recipient, event, actionUrl, session, key: id, password: "SECRET", reason: "SECRET", error: "SECRET" });
      assert.equal(records.at(-1).category, category);
      assert.equal(records.at(-1).actionUrl, actionUrl);
    }
    assert.doesNotMatch(JSON.stringify(records), /SECRET|password|prompt|hash|reason|token/i);
    const input = { recipient, event: "import_failed", actionUrl: "/dean/import", key: "repeat" };
    await createEventNotification(input); await createEventNotification(input);
    assert.equal(records.filter(n => n.deduplicationKey === "import_failed:repeat").length, 1);
    await createEventNotification({ ...input, key: "separate" });
    assert.equal(records.filter(n => n.title === "CSV import failed").length, 3);
    Notification.create = async () => { throw new Error("SECRET raw provider error"); };
    await assert.rejects(createEventNotification({ ...input, session }), /SECRET/);
    assert.equal(await bestEffortNotification({ ...input, key: undefined }), false);
    assert.deepEqual(warnings, ["[Notification] Delivery failed."]);
    for (const value of ["https://evil.test", "//evil.test", "/dean/../users", "/dean/reports?token=SECRET", "/dean/users#SECRET", "/student/consultations", "/dean/%75sers"]) {
      assert.equal(safeActionUrl(value, { role: "dean" }, "Management"), undefined);
    }
    const safe = publicNotification({ _id: id, type: "appointment", title: "Consultation Confirmed", message: "Updated.", actionUrl: "/faculty/appointments", recipient, deduplicationKey: "SECRET", __v: 1 }, { role: "dean" });
    assert.equal(safe.actionUrl, "/dean/faculty/consultations");
    assert.equal(safe.category, "Consultation"); assert.equal(safe.recipient, undefined); assert.equal(safe.deduplicationKey, undefined);
    assert.deepEqual(CATEGORIES, ["Management", "Consultation", "Attendance", "Report"]);
    assert.ok(Notification.schema.indexes().some(([key, options]) => key.recipient === 1 && key.deduplicationKey === 1 && options.unique && options.partialFilterExpression.deduplicationKey.$type === "string"));
  } finally { Notification.create = oldCreate; Notification.updateOne = oldUpdate; console.warn = oldWarn; }
});

test("authenticated API isolates owners, paginates, filters, projects, and mutates only owned rows", async () => {
  const restores = [], ids = { dean: newId(), faculty: newId(), student: newId() }, calls = [];
  const patch = (o, k, v) => { const old = o[k]; o[k] = v; restores.push(() => o[k] = old); };
  const rows = [
    ...Array.from({ length: 8 }, (_, i) => ({ _id: newId(), recipient: ids.dean, type: "account_created", category: "Management", title: "Account created", message: "Updated.", actionUrl: "/dean/users", isRead: i < 2, createdAt: new Date(1000) })),
    { _id: newId(), recipient: ids.dean, type: "appointment", title: "Consultation Confirmed", message: "Updated.", actionUrl: "/faculty/appointments", isRead: false, createdAt: new Date(2000) },
    ...["faculty", "student"].map(role => ({ _id: newId(), recipient: ids[role], type: "appointment", title: "Consultation Confirmed", isRead: false, createdAt: new Date(1000) })),
  ];
  const matches = (row, filter) => {
    assert.ok(filter.recipient); calls.push(filter);
    return row.recipient === filter.recipient && (!filter._id || row._id === filter._id) &&
      (filter.isRead === undefined || row.isRead === filter.isRead) && (!filter.$expr || (row.category || "Consultation") === filter.$expr.$eq[1]);
  };
  patch(User, "findById", async id => ({ id, _id: id, role: Object.keys(ids).find(role => ids[role] === id), accountStatus: "Active", registrationStatus: "Approved" }));
  patch(Notification, "find", filter => {
    let skip = 0, limit = 20;
    const q = { select(value) { assert.doesNotMatch(value, /recipient|deduplicationKey/); return q; },
      sort(value) { assert.deepEqual(value, { createdAt: -1, _id: -1 }); return q; }, skip(value) { skip = value; return q; }, limit(value) { limit = value; return q; },
      async lean() { return rows.filter(row => matches(row, filter)).sort((a, b) => b.createdAt - a.createdAt || b._id.localeCompare(a._id)).slice(skip, skip + limit); } };
    return q;
  });
  patch(Notification, "countDocuments", async filter => rows.filter(row => matches(row, filter)).length);
  patch(Notification, "findOneAndUpdate", async (filter, update, options) => {
    assert.ok(options.projection); const row = rows.find(row => matches(row, filter)); if (row) Object.assign(row, update); return row;
  });
  patch(Notification, "updateMany", async (filter, update) => { rows.filter(row => matches(row, filter)).forEach(row => Object.assign(row, update)); });
  const server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const request = (path = "", role = "dean", method = "GET") => fetch(`http://127.0.0.1:${server.address().port}/api/notifications${path}`, { method, headers: { Connection: "close", ...(role && { Authorization: `Bearer ${jwt.sign({ sub: ids[role] }, env.jwtSecret)}` }) } });
  try {
    assert.equal((await request("", null)).status, 401);
    for (const role of Object.keys(ids)) {
      const res = await request("?limit=2", role); assert.equal(res.headers.get("cache-control"), "no-store");
      const data = await res.json(); assert.equal(data.pagination.total, role === "dean" ? 9 : 1);
      assert.equal(data.notifications.length, role === "dean" ? 2 : 1);
      if (role === "dean") assert.equal(data.notifications[0].actionUrl, "/dean/faculty/consultations");
      assert.ok(data.notifications.every(row => row.recipient === undefined));
    }
    const first = await (await request("?category=Management&readState=unread&limit=2")).json();
    const next = await (await request("?category=Management&readState=unread&limit=2&page=2")).json();
    assert.equal(first.pagination.total, 6); assert.equal(first.unreadCount, 7);
    assert.ok(next.notifications.every(row => !first.notifications.some(previous => previous._id === row._id)));
    for (const query of ["owner=" + ids.dean, "recipient=" + ids.dean, "page=0", "limit=101", "category=Other", "readState=bad", "category=Management&category=Report", "page[$gt]=1"]) assert.equal((await request(`?${query}`)).status, 400);
    assert.equal((await request(`/${rows[0]._id}/read`, "student", "PUT")).status, 404);
    assert.equal((await request("/bad/read", "dean", "PUT")).status, 400);
    assert.equal((await request(`/${rows[0]._id}/read`, "dean", "PUT")).status, 200);
    assert.equal((await request("/read-all", "dean", "GET")).status, 404);
    assert.equal((await request("/read-all", "dean", "PUT")).status, 200);
    assert.ok(rows.filter(row => row.recipient === ids.dean).every(row => row.isRead));
    assert.ok(rows.filter(row => row.recipient !== ids.dean).every(row => !row.isRead));
    assert.ok(calls.every(filter => Object.values(ids).includes(filter.recipient)));
  } finally { restores.reverse().forEach(fn => fn()); await new Promise(resolve => server.close(resolve)); }
});

test("Attendance Review creation notifies active Deans atomically, once across retries and repeated processing", async () => {
  for (const failure of [null, "notifications", "appointments"]) {
    const h = appointmentHarness(), row = fixture({ status: "Confirmed" }), dean = newId(), inactive = newId();
    row.faculty = dean; row.attendance = attendanceEnrollment(row.endAt);
    h.state.appointments.push(row);
    h.state.users.push({ _id: dean, role: "dean", accountStatus: "Active" }, { _id: inactive, role: "dean", accountStatus: "Inactive" });
    const input = { id: row._id, now: new Date(row.attendance.responseDeadlineAt) };
    try {
      if (failure) {
        h.fail(failure); await assert.rejects(processAttendance(input));
        assert.equal(h.state.appointments[0].status, "Confirmed");
        assert.equal(h.state.notifications.length, 0);
      } else {
        h.retry(); await processAttendance(input); await processAttendance(input);
        const management = h.state.notifications.filter(n => n.type === "attendance_review_created");
        assert.equal(management.length, 1); assert.equal(management[0].recipient, dean);
        assert.equal(management[0].actionUrl, `/dean/attendance-review/${row._id}`);
        assert.equal(management[0].category, "Attendance");
        assert.ok(h.state.notifications.some(n => n.recipient === dean && n.actionUrl === "/dean/faculty/consultations"));
        assert.ok(h.state.notifications.every(n => n.recipient !== inactive));
        assert.doesNotMatch(JSON.stringify(management), /responses_conflict|missingRoles|reason|password|token/i);
      }
    } finally { h.restore(); }
  }
});

test("notification UI uses server totals and filters, retains refresh cadence, and keeps one Dean center", async () => {
  const source = await readFile(new URL("../../client/src/components/notifications/NotificationsView.jsx", import.meta.url), "utf8");
  assert.match(source, /readState: filter.toLowerCase\(\)/);
  assert.match(source, /aria-label="Notification category"/);
  assert.match(source, /\["Management", "Consultation", "Attendance", "Report"\]/);
  assert.match(source, /totalItems=\{pagination.total\}/);
  assert.doesNotMatch(source, /shown.slice\(/);
  assert.match(source, /setInterval\(refresh, 15000\)/);
  assert.match(source, /addEventListener\("focus", refresh\)/);
  assert.match(source, /View details/);
  const layout = await readFile(new URL("../../client/src/layouts/DeanLayout.jsx", import.meta.url), "utf8");
  assert.match(layout, /path: "\/dean\/notifications" \+ suffix/);
  const users = await readFile(new URL("../../client/src/pages/Dean/UserManagement.jsx", import.meta.url), "utf8");
  assert.match(users, /params.getAll\("userId"\).length === 1/);
  assert.match(users, /if \(linkedUserId\) void view/);
});
