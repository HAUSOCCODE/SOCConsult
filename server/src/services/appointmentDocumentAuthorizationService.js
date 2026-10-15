import Appointment from "../models/Appointment.js";
import SupportingDocument from "../models/SupportingDocument.js";
import cloudinary from "../config/cloudinary.js";

const validId = value => typeof value === "string" && /^[a-f\d]{24}$/i.test(value);
const fail = (statusCode, message) => { throw Object.assign(new Error(message), { statusCode }); };
export function canReadAppointmentDocument(appointment, user, management = false) {
  return (management === true && user?.role === "dean") ||
    String(appointment.student) === String(user?.id) || String(appointment.faculty) === String(user?.id);
}
export async function authorizedDocument({ id, documentId, user, management = false }) {
  if (!validId(id) || (documentId !== undefined && !validId(documentId))) fail(400, "Invalid document reference.");
  const appointment = await Appointment.findById(id).select("student faculty supportingDocuments supportingDocument.name supportingDocument.mimeType supportingDocument.size +supportingDocument.data").maxTimeMS(10000);
  if (!appointment || !canReadAppointmentDocument(appointment, user, management)) fail(404, "Document not found.");
  if (documentId === undefined) {
    if (!appointment.supportingDocument?.data) fail(404, "Document not found.");
    const doc = appointment.supportingDocument;
    const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(doc.data);
    if (!match) fail(404, "Document is unavailable.");
    return { name: doc.name, mimeType: doc.mimeType, bytes: Buffer.from(match[2], "base64") };
  }
  const entry = (appointment.supportingDocuments || []).find(item => String(item?._id || item) === documentId);
  if (!entry) fail(404, "Document not found.");
  const doc = entry.originalName ? entry : await SupportingDocument.findOne({ _id: documentId, appointment: id }).select("+data +publicId +resourceType").maxTimeMS(10000);
  if (!doc) fail(404, "Document not found.");
  return { name: doc.originalName, mimeType: doc.mimeType, bytes: doc.data ? Buffer.from(doc.data) : undefined,
    publicId: doc.cloudinaryPublicId || doc.publicId, resourceType: doc.resourceType };
}
export function providerDownloadUrl(document) {
  const { publicId, resourceType } = document;
  if (typeof publicId !== "string" || publicId.length > 500 || !/^[A-Za-z0-9_\-/\.]+$/.test(publicId) || publicId.split("/").some(part => !part || part === "." || part === "..") || !["image", "video", "raw"].includes(resourceType))
    fail(404, "Document is unavailable.");
  const formats = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "application/pdf": "pdf", "video/mp4": "mp4", "video/webm": "webm" };
  const format = resourceType === "raw" ? publicId.split("/").at(-1).split(".").slice(1).at(-1) : formats[document.mimeType];
  if (!format || !/^[a-z0-9]{1,10}$/i.test(format)) fail(404, "Document is unavailable.");
  // SDK-generated signed API endpoint; never fetch a stored or request-supplied URL.
  return cloudinary.utils.private_download_url(publicId, format, {
    resource_type: resourceType, type: "upload", expires_at: Math.floor(Date.now() / 1000) + 60, attachment: true,
  });
}
export async function documentContent(document, fetchProvider = fetch) {
  const maxBytes = 10 * 1024 * 1024;
  if (document.bytes) {
    if (document.bytes.length > maxBytes) fail(404, "Document is unavailable.");
    return document.bytes;
  }
  const response = await fetchProvider(providerDownloadUrl(document), { redirect: "error", signal: AbortSignal.timeout(15000) });
  if (!response.ok || Number(response.headers.get("content-length")) > maxBytes) fail(404, "Document is unavailable.");
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) fail(404, "Document is unavailable.");
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks);
}
export function documentHeaders(document) {
  const allowed = ["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp", "text/plain", "video/mp4", "video/webm"];
  const mime = allowed.includes(document.mimeType) ? document.mimeType : "application/octet-stream";
  const filename = String(document.name || "document").replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 150) || "document";
  return { "Content-Type": mime, "Content-Disposition": `attachment; filename="${filename}"`, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'", "Cache-Control": "no-store" };
}
