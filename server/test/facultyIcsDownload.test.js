import assert from "node:assert/strict";
import { test } from "node:test";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import app from "../src/app.js";
import { env } from "../src/config/env.js";
import User from "../src/models/User.js";
import Appointment from "../src/models/Appointment.js";
import { APPOINTMENT_STATUSES, LEGACY_APPOINTMENT_STATUSES } from "../src/config/appointmentStatus.js";
import { canExportCalendar, generateConsultationIcs, safeCalendarMeetingLink } from "../src/services/icsService.js";

test("calendar policy covers exact boundaries, invalid schedules and every status", () => {
  const a = { status: "Confirmed", startAt: "2035-01-01T16:00:00Z", endAt: "2035-01-01T17:00:00Z" };
  for (const time of ["2035-01-01T15:59:59Z", a.startAt, "2035-01-01T16:59:59.999Z"]) assert.equal(canExportCalendar(a, time), true);
  for (const time of [a.endAt, "2035-01-01T17:00:00.001Z"]) assert.equal(canExportCalendar(a, time), false);
  for (const status of [...APPOINTMENT_STATUSES, ...LEGACY_APPOINTMENT_STATUSES, "confirmed", "unknown"]) assert.equal(canExportCalendar({ ...a, status }, a.startAt), status === "Confirmed");
  for (const patch of [{ startAt: null }, { endAt: null }, { startAt: "invalid" }, { endAt: "invalid" }, { endAt: a.startAt }, { endAt: "2034-01-01" }]) assert.equal(canExportCalendar({ ...a, ...patch }, a.startAt), false);
});

test("ICS preserves Unicode, UTF-8 folding, stable UID and safe whitelist", () => {
  const a = { _id: "stable", subject: "課程😀é".repeat(40) + "\r\nEND:VEVENT\r\nATTENDEE:evil", faculty: { name: "教授" }, consultationMode: "Online", meetingPlatform: "Teams", meetingLink: "https://meet.example.test/join?x=1&y=2", startAt: "2035-01-01T16:00:00Z", endAt: "2035-01-01T17:00:00Z", reason: "PRIVATE", notes: "PRIVATE", email: "PRIVATE", supportingDocuments: ["PRIVATE"], proposedMeetingLink: "PRIVATE", availability: { meetingLink: "PRIVATE" } };
  const before = JSON.stringify(a), raw = generateConsultationIcs(a), text = raw.replace(/\r\n /g, "");
  assert.equal(JSON.stringify(a), before);
  for (const line of raw.split("\r\n")) assert.ok(Buffer.byteLength(line) <= 75);
  assert.equal(raw.includes("�"), false);
  assert.ok(text.includes(a.subject.replaceAll("\r\n", "\\n")));
  assert.match(text, /DTSTART:20350101T160000Z\r\nDTEND:20350101T170000Z/);
  assert.equal(text.match(/^END:VEVENT$/gm)?.length, 1);
  assert.equal(text.includes("PRIVATE"), false);
  assert.ok(text.includes("Meeting link: https://meet.example.test/join?x=1&y=2"));
  assert.equal(text.match(/UID:[^\r]+/)[0], generateConsultationIcs(a, new Date("2030-01-01")).match(/UID:[^\r]+/)[0]);
  for (const link of ["javascript:alert(1)", "https://user:secret@host.test", "https://host.test/\r\nATTENDEE:evil", "https://host.test/a b", null]) assert.equal(safeCalendarMeetingLink(link), "");
  assert.equal(generateConsultationIcs({ ...a, consultationMode: "Face-to-Face" }).includes("meet.example"), false);
});

test("shared endpoint enforces participant scope, active identity, projections, safe headers/errors and no writes", async () => {
  const ids = Array.from({ length: 6 }, () => new mongoose.Types.ObjectId().toString());
  const [student, faculty, dean, outsider, manager, id] = ids;
  let owner = faculty, status = "Confirmed", inactive = false, broken = false, endAt = new Date("2035-01-01T17:00:00Z"), writes = 0;
  const originals = { user: User.findById, find: Appointment.findOne, update: Appointment.updateOne };
  User.findById = async key => ({ id: String(key), role: key === student ? "student" : [dean, manager].includes(key) ? "dean" : "faculty", accountStatus: inactive ? "Inactive" : "Active", registrationStatus: "Approved" });
  Appointment.updateOne = () => { writes++; throw new Error("Unexpected write"); };
  Appointment.findOne = query => {
    if (broken) throw new Error("secret database details");
    assert.equal(query.status, "Confirmed");
    const row = query._id === id && status === query.status && (query.student === student || query.faculty === owner) ? { _id: id, status, faculty: { name: "Provider" }, startAt: new Date("2035-01-01T16:00:00Z"), endAt, consultationMode: "Online", meetingPlatform: "Teams", meetingLink: "https://meet.example.test/current" } : null;
    const chain = { select: projection => { assert.equal(/reason|attendance|email|documents|availability|proposed/i.test(projection), false); return chain; }, populate: (field, projection) => { assert.equal(field, "faculty"); assert.equal(projection, "name"); return chain; }, maxTimeMS: limit => { assert.equal(limit, 10000); return chain; }, lean: async () => row };
    return chain;
  };
  const server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const url = `http://127.0.0.1:${server.address().port}/api/appointments/${id}/calendar.ics`;
  const request = (user, suffix = "") => fetch(url + suffix, { headers: user ? { Authorization: `Bearer ${jwt.sign({ sub: user }, env.jwtSecret)}` } : {} });
  try {
    assert.equal((await request()).status, 401);
    inactive = true; assert.equal((await request(student)).status, 403); inactive = false;
    for (const user of [outsider, manager, dean]) assert.equal((await request(user)).status, 404);
    const bodies = [];
    for (const user of [student, faculty]) {
      const r = await request(user); assert.equal(r.status, 200); assert.equal(r.headers.get("cache-control"), "no-store");
      assert.match(r.headers.get("content-type"), /^text\/calendar; charset=utf-8/i);
      assert.equal(r.headers.get("content-disposition"), 'attachment; filename="SOCConsult-Consultation-2035-01-02.ics"');
      bodies.push(await r.text());
    }
    owner = dean; const r = await request(dean); assert.equal(r.status, 200); bodies.push(await r.text());
    assert.equal(new Set(bodies.map(b => b.match(/UID:[^\r]+/)[0])).size, 1);
    for (const value of [...APPOINTMENT_STATUSES, ...LEGACY_APPOINTMENT_STATUSES, "unsupported"]) {
      if (value === "Confirmed") continue; status = value;
      for (const user of [student, dean]) { const r = await request(user); assert.equal(r.status, 404, value); assert.equal(r.headers.get("cache-control"), "no-store"); }
    }
    status = "Confirmed"; endAt = new Date("2000-01-01"); assert.equal((await request(dean)).status, 409);
    assert.equal((await request(student, "?owner=" + manager)).status, 400);
    broken = true; const error = await request(dean); assert.equal(error.status, 503); assert.equal((await error.text()).includes("secret"), false);
    assert.equal(writes, 0);
  } finally { await new Promise(resolve => server.close(resolve)); User.findById = originals.user; Appointment.findOne = originals.find; Appointment.updateOne = originals.update; }
});
