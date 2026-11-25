import mongoose from "mongoose";
import crypto from "node:crypto";
import path from "node:path";
import { uploadBuffer, destroyAsset } from "./cloudinaryStorage.js";

const publicFileFields = document => ({
  mimeType: typeof document.mimeType === "string" ? document.mimeType : undefined,
  size: Number.isFinite(document.size) ? document.size : undefined,
});

// Used for ordinary appointment JSON. Dedicated document routes still deliver files.
export function sanitizeAppointmentDocuments(appointment) {
  if (Array.isArray(appointment.supportingDocuments)) {
    appointment.supportingDocuments = appointment.supportingDocuments.map(document => {
      if (mongoose.isObjectIdOrHexString(document)) return document;
      if (!mongoose.isObjectIdOrHexString(document?._id) || typeof document.originalName !== "string") return null;
      const uploadedAt = document.uploadedAt || document.createdAt;
      return { _id: document._id, originalName: document.originalName, ...publicFileFields(document),
        uploadedAt: typeof uploadedAt === "string" || uploadedAt instanceof Date ? uploadedAt : undefined };
    }).filter(Boolean);
  } else if (appointment.supportingDocuments != null) {
    delete appointment.supportingDocuments;
  }
  if (appointment.supportingDocument) {
    const document = appointment.supportingDocument;
    appointment.supportingDocument = typeof document.name === "string"
      ? { name: document.name, ...publicFileFields(document) } : undefined;
  }
  return appointment;
}

// Upload outside transaction retries; discard assets if the database transaction fails.
export async function uploadAppointmentDocuments(files, appointmentId) {
  const entries = [];
  const cleanup = () => Promise.all(entries.map((entry) => destroyAsset({
    publicId: entry.cloudinaryPublicId, resourceType: entry.resourceType,
  }).catch(() => {})));
  try {
    for (const file of files) {
      const originalName = path.basename(file.originalname.replaceAll("\\", "/")).slice(0, 255) || "document";
      const resourceType = file.mimetype.startsWith("image/") ? "image" : file.mimetype.startsWith("video/") ? "video" : "raw";
      const uploaded = await uploadBuffer(file.buffer, { folder: `consultio/consultation-documents/${appointmentId}`,
        resource_type: resourceType, public_id: `${crypto.randomUUID()}${resourceType === "raw" ? path.extname(originalName).toLowerCase() : ""}` });
      entries.push({ _id: new mongoose.Types.ObjectId(), originalName, cloudinaryUrl: uploaded.secure_url,
        cloudinaryPublicId: uploaded.public_id, resourceType: uploaded.resource_type,
        mimeType: file.mimetype, size: file.size, uploadedAt: new Date() });
    }
  } catch (error) { await cleanup(); throw error; }
  return { entries, cleanup };
}
