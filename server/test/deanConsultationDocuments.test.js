import assert from "node:assert/strict";
import { test } from "node:test";
import Appointment from "../src/models/Appointment.js";
import SupportingDocument from "../src/models/SupportingDocument.js";
import { authorizedDocument, canReadAppointmentDocument, documentContent, documentHeaders, providerDownloadUrl } from "../src/services/appointmentDocumentAuthorizationService.js";
import { appointmentHttp } from "./helpers/appointmentHttp.js";
import { fixture } from "./helpers/appointmentHarness.js";

const id = "1234567890abcdef12345678", docId = "abcdef123456789012345678";
const chain = value => { const q = { then: (yes, no) => Promise.resolve(value).then(yes, no) }; for (const key of ["select", "maxTimeMS"]) q[key] = () => q; return q; };
test("shared document authorization validates IDs and membership before storage access", async () => {
  const old = Appointment.findById, oldDocument = SupportingDocument.findOne;
  let reads = 0;
  const row = { student: "student", faculty: "dean", supportingDocuments: [{ _id: docId, originalName: "file.pdf", cloudinaryPublicId: "consultio/consultation-documents/file", resourceType: "image", mimeType: "application/pdf" }] };
  Appointment.findById = () => { reads++; return chain(row); };
  SupportingDocument.findOne = () => assert.fail("Embedded document must not query unrelated storage");
  try {
    for (const args of [{ id: "invalid", documentId: docId }, { id, documentId: "invalid" }]) await assert.rejects(authorizedDocument({ ...args, user: { id: "dean", role: "dean" }, management: true }), { statusCode: 400 });
    assert.equal(reads, 0);
    for (const user of [{ id: "other", role: "student" }, { id: "other", role: "faculty" }, { id: "other", role: "dean" }])
      await assert.rejects(authorizedDocument({ id, documentId: docId, user }), { statusCode: 404 });
    const document = await authorizedDocument({ id, documentId: docId, user: { id: "manager", role: "dean" }, management: true });
    assert.equal(document.name, "file.pdf");
    assert.ok(canReadAppointmentDocument(row, { id: "dean", role: "dean" }));
    assert.ok(!canReadAppointmentDocument(row, { id: "other", role: "faculty" }, true));
    await assert.rejects(authorizedDocument({ id, documentId: id, user: { id: "dean", role: "dean" }, management: true }), { statusCode: 404 });
    row.supportingDocuments = [docId];
    SupportingDocument.findOne = filter => { assert.equal(filter.appointment, id); assert.equal(filter._id, docId); return chain(null); };
    await assert.rejects(authorizedDocument({ id, documentId: docId, user: { id: "dean", role: "dean" }, management: true }), { statusCode: 404 });
  } finally { Appointment.findById = old; SupportingDocument.findOne = oldDocument; }
});

test("controlled Cloudinary delivery ignores arbitrary URLs and contains unsafe content", async () => {
  const doc = { publicId: "consultio/consultation-documents/record/file.pdf", resourceType: "raw", name: 'unsafe"\r\n.html', mimeType: "text/html", url: "https://attacker.test" };
  const signed = new URL(providerDownloadUrl(doc));
  assert.equal(signed.hostname, "api.cloudinary.com");
  assert.equal(signed.searchParams.get("type"), "upload");
  assert.equal(signed.searchParams.get("public_id"), doc.publicId);
  assert.equal(signed.searchParams.get("format"), "pdf");
  assert.equal(new URL(providerDownloadUrl({ ...doc, resourceType: "image", mimeType: "image/png" })).searchParams.get("format"), "png");
  assert.throws(() => providerDownloadUrl({ ...doc, resourceType: "image", mimeType: "unknown" }), { statusCode: 404 });
  assert.ok(+signed.searchParams.get("expires_at") <= Date.now() / 1000 + 61);
  for (const publicId of ["../x", "http://attacker.test", "file?url=bad", "folder//file"]) assert.throws(() => providerDownloadUrl({ ...doc, publicId }), { statusCode: 404 });
  const bytes = await documentContent(doc, async (url, options) => {
    assert.equal(new URL(url).hostname, "api.cloudinary.com"); assert.equal(options.redirect, "error");
    return new Response("safe", { headers: { "content-length": "4" } });
  });
  assert.equal(bytes.toString(), "safe");
  assert.equal((await documentContent({ bytes: Buffer.from("database") })).toString(), "database");
  const headers = documentHeaders(doc);
  assert.equal(headers["Content-Type"], "application/octet-stream");
  assert.match(headers["Content-Disposition"], /^attachment;/); assert.doesNotMatch(headers["Content-Disposition"], /[\r\n]/);
  assert.equal(headers["Cache-Control"], "no-store"); assert.match(headers["Content-Security-Policy"], /sandbox/);
  await assert.rejects(documentContent(doc, async () => new Response("", { status: 404 })), { statusCode: 404 });
  await assert.rejects(documentContent(doc, async () => new Response("", { headers: { "content-length": "10485761" } })), { statusCode: 404 });
});

test("Dean document endpoint serves only authorized bytes, rejects mutations and never writes", async () => {
  const h = await appointmentHttp(), old = Appointment.findById, restores = [];
  for (const model of [Appointment, SupportingDocument]) {
    for (const method of ["create", "updateOne", "updateMany", "findOneAndUpdate", "deleteOne", "deleteMany", "bulkWrite"]) {
      const original = model[method]; model[method] = () => assert.fail(`Document read invoked ${method}`); restores.push(() => model[method] = original);
    }
    const save = model.prototype.save; model.prototype.save = () => assert.fail("Document read invoked save"); restores.push(() => model.prototype.save = save);
  }
  try {
    const row = fixture({ student: h.users.student.id, faculty: h.users.dean.id, supportingDocument: { name: "file.txt", mimeType: "text/plain", data: "data:text/plain;base64,c2FmZQ==" } });
    Appointment.findById = value => chain(value === String(row._id) ? row : null);
    const base = `/dean/consultations/${row._id}/document`;
    for (const role of ["student", "faculty"]) assert.equal((await h.request(base, role)).status, 403);
    const response = await h.request(base, "dean");
    assert.equal(response.status, 200); assert.equal(await response.text(), "safe"); assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    row.supportingDocument.toObject = () => ({ name: "file.txt", mimeType: "text/plain", data: "data:text/plain;base64,c2FmZQ==" });
    assert.equal((await h.request(`/appointments/${row._id}/document`, "dean")).status, 200);
    assert.equal((await h.request(`/appointments/${row._id}/document`, "student")).status, 200);
    assert.equal((await h.request(`/appointments/${row._id}/document`, "faculty")).status, 403);
    row.faculty = h.users.otherFaculty.id;
    assert.equal((await h.request(`/appointments/${row._id}/document`, "dean")).status, 403);
    assert.equal((await h.request(base, "dean")).status, 200);
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) assert.equal((await h.request(base, "dean", method)).status, 403);
    assert.equal((await h.request(`/dean/consultations/${row._id}/documents/bad`, "dean")).status, 400);
    assert.equal((await h.request(`/dean/consultations/${id}/document`, "dean")).status, 404);
    assert.equal(h.state.audits.length, 0); assert.equal(h.state.appointments.length, 0);
  } finally { restores.reverse().forEach(restore => restore()); Appointment.findById = old; await h.close(); }
});
