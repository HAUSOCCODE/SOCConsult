import { appointmentHttp } from "./helpers/appointmentHttp.js";
import { fixture, addSlot, deferred } from "./helpers/appointmentHarness.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import app from "../src/app.js";
import { env } from "../src/config/env.js";
import Appointment from "../src/models/Appointment.js";
import AuditLog from "../src/models/AuditLog.js";
import Availability from "../src/models/Availability.js";
import Notification from "../src/models/Notification.js";
import User from "../src/models/User.js";
import StudentAvailability from "../src/models/StudentAvailability.js";
import express from "express";
import { supportingDocumentUpload } from "../src/middleware/supportingDocumentUpload.js";
import cloudinary from "../src/config/cloudinary.js";

const patch = (object, key, replacement, restores) => {
  restores.push(() => {
    object[key] = object[`__stu07_${key}`];
    delete object[`__stu07_${key}`];
  });
  object[`__stu07_${key}`] = object[key];
  object[key] = replacement;
};

const chain = (value) => {
  const query = {
    then: (resolve, reject) => Promise.resolve(value).then(resolve, reject),
  };
  for (const method of ["select", "lean"]) query[method] = () => query;
  return query;
};

const startServer = () =>
  new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });

test("selected-slot booking validates authoritative data, rolls back and prevents duplicate reservation", async () => {
  const h = await appointmentHttp();
  try {
    const record = fixture({ student: h.users.student.id, faculty: h.users.dean.id }); addSlot(h, { ...record, reservationToken: undefined });
    const body = { availabilityId: record.availability, subject: " Project ", reason: " Review scope ", status: "Approved", student: h.users.otherStudent.id };
    for (const invalid of [{ subject: " " }, { reason: " " }, { subject: "x".repeat(151) }, { reason: "x".repeat(1001) }])
      assert.equal((await h.request('/appointments', "student", "POST", { ...body, ...invalid })).status, 400);
    h.fail("audits");
    assert.equal((await h.request('/appointments', "student", "POST", body)).status, 500);
    assert.equal(h.state.appointments.length, 0); assert.equal(h.state.slots[0].reservationToken, undefined);
    h.fail(undefined);
    const response = await h.request('/appointments', "student", "POST", body); assert.equal(response.status, 201);
    const result = (await response.json()).appointment;
    assert.equal(result.student, h.users.student.id); assert.equal(result.faculty, h.users.dean.id);
    assert.equal(result.status, "Pending"); assert.equal(result.yearLevel, "3rd Year");
    assert.equal(result.startAt, record.startAt.toISOString()); assert.equal(result.subject, "Project");
    assert.equal(result.reservationToken, undefined); assert.equal(result.statusHistory.length, 1);
    assert.equal((await h.request('/appointments', "otherStudent", "POST", body)).status, 409);
    assert.equal(h.state.audits.length, 1); assert.equal(h.state.notifications.length, 2);
    assert.ok(h.state.notifications.some(notification => notification.recipient === h.users.student.id && notification.type === "request_submitted"));
  } finally { await h.close(); }
});

test("partial-overlap booking persists only the shared interval", async () => {
  const h = await appointmentHttp();
  try {
    const record = fixture({ student: h.users.student.id, faculty: h.users.faculty.id,
      startAt: new Date("2099-01-01T12:51:00+08:00"), endAt: new Date("2099-01-01T13:51:00+08:00") });
    addSlot(h, { ...record, reservationToken: undefined });
    const response = await h.request("/appointments", "student", "POST", {
      availabilityId: record.availability, subject: "Partial overlap", reason: "Shared schedule",
      startAt: "2099-01-01T12:51:00+08:00", endAt: "2099-01-01T13:40:00+08:00",
    });
    assert.equal(response.status, 201);
    const appointment = (await response.json()).appointment;
    assert.equal(new Date(appointment.startAt).getTime(), new Date("2099-01-01T12:51:00+08:00").getTime());
    assert.equal(new Date(appointment.endAt).getTime(), new Date("2099-01-01T13:40:00+08:00").getTime());
    assert.equal(appointment.estimatedDurationMinutes, 49);
    assert.equal(h.state.holds.length, 49);

    const outside = fixture({ student: h.users.otherStudent.id, faculty: h.users.otherFaculty.id,
      startAt: new Date("2099-01-02T12:51:00+08:00"), endAt: new Date("2099-01-02T13:51:00+08:00") });
    addSlot(h, { ...outside, reservationToken: undefined });
    assert.equal((await h.request("/appointments", "otherStudent", "POST", {
      availabilityId: outside.availability, subject: "Invalid overlap", reason: "Outside window",
      startAt: "2099-01-02T12:40:00+08:00", endAt: "2099-01-02T13:40:00+08:00",
    })).status, 409);
  } finally { await h.close(); }
});

test("booking rechecks Student availability after a concurrent preference change", async () => {
  const h = await appointmentHttp(), create = StudentAvailability.create, startSession = mongoose.startSession;
  const entered = deferred(), queued = deferred(), release = deferred();
  try {
    const record = fixture({ student: h.users.student.id, faculty: h.users.faculty.id, reservationToken: undefined });
    addSlot(h, record);
    StudentAvailability.create = async (...args) => {
      entered.resolve();
      await release.promise;
      return create(...args);
    };
    const preferring = h.request("/student-availability", "student", "POST", {
      startAt: "2099-01-02T10:00:00+08:00", endAt: "2099-01-02T11:00:00+08:00",
    });
    await entered.promise;
    mongoose.startSession = async () => {
      const session = await startSession();
      const withTransaction = session.withTransaction.bind(session);
      session.withTransaction = (...args) => { queued.resolve(); return withTransaction(...args); };
      return session;
    };
    const booking = h.request("/appointments", "student", "POST", {
      availabilityId: record.availability, subject: "Consultation", reason: "Discuss scope",
    });
    await queued.promise;
    release.resolve();
    assert.equal((await preferring).status, 201);
    const response = await booking;
    assert.equal(response.status, 409);
    assert.match((await response.json()).message, /outside your current availability/);
    assert.equal(h.state.appointments.length, 0);
    assert.equal(h.state.holds.length, 0);
    assert.equal(h.state.slots[0].reservationToken, undefined);
  } finally {
    release.resolve();
    StudentAvailability.create = create;
    mongoose.startSession = startSession;
    await h.close();
  }
});

test("supporting-document middleware enforces count, file, total, and type limits", async () => {
  const restores = [];
  const studentId = new mongoose.Types.ObjectId().toString();
  patch(User, "findById", async () => ({
    id: studentId,
    _id: studentId,
    role: "student",
    name: "Student",
    accountStatus: "Active",
  }), restores);
  const server = await startServer();
  const url = `http://127.0.0.1:${server.address().port}/api/appointments`;
  const request = async (files) => {
    const form = new FormData();
    form.append("availabilityId", new mongoose.Types.ObjectId().toString());
    form.append("subject", "Testing");
    form.append("reason", "Upload validation");
    files.forEach(({ size, name, type }) =>
      form.append("documents", new Blob([Buffer.alloc(size)], { type }), name),
    );
    return fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt.sign({ sub: studentId }, env.jwtSecret)}`,
        Connection: "close",
      },
      body: form,
    });
  };
  try {
    assert.equal((await request([{ size: 1, name: "run.exe", type: "application/octet-stream" }])).status, 400);
    assert.equal((await request(Array.from({ length: 6 }, (_, index) => ({ size: 1, name: `${index}.txt`, type: "text/plain" })))).status, 400);
    assert.equal((await request([{ size: 10 * 1024 * 1024 + 1, name: "large.pdf", type: "application/pdf" }])).status, 400);
    assert.equal((await request(Array.from({ length: 3 }, (_, index) => ({ size: 9 * 1024 * 1024, name: `${index}.pdf`, type: "application/pdf" })))).status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    restores.reverse().forEach((restore) => restore());
  }
});

test("supporting-document validation preserves the supported formats and rejects obvious mismatches", async () => {
  const app = express();
  app.post("/", supportingDocumentUpload, (req, res) => res.json({ accepted: req.files.length }));
  const server = await new Promise(resolve => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); });
  const url = "http://127.0.0.1:" + server.address().port;
  const submit = (name, type, contents) => {
    const body = new FormData();
    body.append("documents", new Blob([contents], { type }), name);
    return fetch(url, { method: "POST", body, headers: { Connection: "close" } });
  };
  try {
    const octet = "application/octet-stream";
    const formats = [
      ["jpg", "image/jpeg", Buffer.from("ffd8ff", "hex")],
      ["jpeg", "image/jpg", Buffer.from("ffd8ff", "hex")],
      ["png", "image/png", Buffer.from("89504e470d0a1a0a", "hex")],
      ["webp", "image/webp", "RIFF0000WEBP"],
      ["gif", "image/gif", "GIF89a"],
      ["pdf", "application/pdf", "%PDF-1.4\n"],
      ["pdf", octet, "%PDF-1.4\n"],
      ["doc", "application/msword"], ["docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
      ["xls", "application/vnd.ms-excel"], ["xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
      ["ppt", "application/vnd.ms-powerpoint"], ["pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
      ["txt", "text/plain"], ["csv", "text/csv"], ["csv", "text/plain"], ["csv", "application/vnd.ms-excel"],
      ["mp4", "video/mp4"], ["webm", "video/webm"],
    ];
    for (const [extension, mime, contents = "content fixture"] of formats) {
      const accepted = await submit("fixture." + extension, mime, contents);
      assert.equal(accepted.status, 200, extension + " " + mime);
      assert.deepEqual(await accepted.json(), { accepted: 1 });
    }
    for (const [name, mime, contents, message] of [
      ["bad.pdf", "image/png", "%PDF-1.4", /not supported/],
      ["bad.pdf", octet, "wrong", /does not match/],
      ["bad.png", "image/png", "%PDF-1.4", /does not match/],
      ["empty.doc", "application/msword", "", /cannot be empty/],
      ["../notes.txt", "text/plain", "data", /file names/],
    ]) {
      const rejected = await submit(name, mime, contents);
      assert.equal(rejected.status, 400);
      assert.match((await rejected.json()).message, message);
    }
    const malformed = await fetch(url, { method: "POST", headers: { "Content-Type": "multipart/form-data; boundary=invalid" }, body: "--invalid" });
    assert.equal(malformed.status, 400);
    assert.deepEqual(await malformed.json(), { message: "Invalid supporting document upload." });
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("published-slot booking still uploads supporting documents and returns the existing download JSON", async () => {
  const h = await appointmentHttp();
  const upload = cloudinary.uploader.upload_stream;
  const request = globalThis.fetch;
  const storedUrl = "https://fixture.invalid/notes.pdf";
  let uploadCalls = 0, headCalls = 0;
  cloudinary.uploader.upload_stream = (options, callback) => ({
    end(bytes) {
      uploadCalls++;
      assert.equal(options.resource_type, "raw");
      assert.equal(options.type, undefined);
      assert.equal(bytes.toString(), "%PDF-1.4\nfixture");
      callback(null, { secure_url: storedUrl, public_id: "fixture-pdf", resource_type: "raw" });
    },
  });
  globalThis.fetch = (url, options) => {
    if (url !== storedUrl) return request(url, options);
    headCalls++;
    assert.equal(options.method, "HEAD");
    return Promise.resolve(new Response(null, { status: 200 }));
  };
  try {
    const record = fixture({ student: h.users.student.id, faculty: h.users.faculty.id });
    addSlot(h, { ...record, reservationToken: undefined });
    const body = new FormData();
    body.append("availabilityId", record.availability);
    body.append("subject", "Supporting file");
    body.append("reason", "Discuss attached notes");
    body.append("documents", new Blob(["%PDF-1.4\nfixture"], { type: "application/pdf" }), "notes.pdf");
    const response = await h.request("/appointments", "student", "POST", body);
    assert.equal(response.status, 201);
    const { appointment } = await response.json();
    assert.equal(uploadCalls, 1);
    const [document] = appointment.supportingDocuments;
    assert.equal(document.originalName, "notes.pdf");
    assert.doesNotMatch(JSON.stringify(appointment), /fixture-pdf|fixture\.invalid|cloudinaryUrl|resourceType/);
    const path = "/appointments/" + appointment._id + "/documents/" + document._id;
    assert.equal((await h.request(path, "otherStudent")).status, 403);
    const download = await h.request(path, "student");
    assert.equal(download.status, 200);
    assert.equal((await download.json()).supportingDocument.data, storedUrl);
    assert.equal(headCalls, 1);
  } finally {
    cloudinary.uploader.upload_stream = upload;
    globalThis.fetch = request;
    await h.close();
  }
});
