import mongoose from "mongoose";
import crypto from "node:crypto";
import path from "node:path";
import { uploadBuffer, destroyAsset } from "./cloudinaryStorage.js";

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
