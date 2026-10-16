import mongoose from "mongoose";
import AuditLog from "../models/AuditLog.js";
import { safeMetadata } from "../services/auditPolicy.js";
import { bestEffortNotification } from "../services/notificationService.js";
import { randomUUID } from "node:crypto";
import AccountImport from "../models/AccountImport.js";
import { env } from "../config/env.js";
import { accountImportConfig as config } from "../config/accountImport.js";
import {
  validateCsv,
  CsvValidationError,
} from "../services/csvValidationService.js";
import { publicAccountImport, validPreviewId, sanitizeFilename, findAccountConflicts, confirmAccountImport } from "../services/accountImportService.js";

export async function validateAccountImport(req, res) {
  let session;
  const attemptId = new mongoose.Types.ObjectId();
  try {
    const result = await validateCsv(req.file.buffer, {
      studentDomain: env.studentDomain,
      facultyDomain: env.facultyDomain,
      findUsers: findAccountConflicts,
    });
    session = await mongoose.startSession();
    let preview;
    await session.withTransaction(async () => {
      [preview] = await AccountImport.create([{
        _id: attemptId,
        previewId: randomUUID(),
        owner: req.user._id,
        rows: result.rows,
        summary: result.summary,
        displayFilename: sanitizeFilename(req.file.originalname),
        schemaVersion: 2,
        status: "validated",
        expiresAt: new Date(Date.now() + config.lifetimeMs),
        purgeAt: new Date(Date.now() + config.lifetimeMs + config.temporaryRetentionMs),
      }], { session });
      await AuditLog.create([{ subjectUser: req.user._id, subjectRole: "dean", actorUser: req.user._id, actorRole: "dean",
        action: "accounts_csv_validated", category: "Account", relatedEntityType: "AccountImport", relatedEntityId: attemptId,
        metadata: safeMetadata("accounts_csv_validated", { ...result.summary, outcome: result.canConfirm ? "valid" : "invalid", code: result.canConfirm ? "VALIDATED" : "VALIDATION_ERRORS" }) }], { session });
    });
    return res.json(publicAccountImport(preview));
  } catch (error) {
    if (error instanceof CsvValidationError) {
      try { await AuditLog.create({ subjectUser: req.user._id, subjectRole: "dean", actorUser: req.user._id, actorRole: "dean",
        action: "accounts_csv_validated", category: "Account", relatedEntityType: "AuditAttempt", relatedEntityId: attemptId,
        metadata: { outcome: "rejected", code: "CSV_REJECTED" } }); } catch { return res.status(503).json({ message: "Unable to record CSV validation." }); }
    }
    if (error instanceof CsvValidationError) await bestEffortNotification({ recipient: req.user.id, event: "import_failed", actionUrl: "/dean/import" });
    return res
      .status(error instanceof CsvValidationError ? 400 : 500)
      .json({
        message:
          error instanceof CsvValidationError
            ? error.message
            : "Unable to validate CSV. Please try again.",
      });
  } finally {
    if (session) await session.endSession().catch(() => {});
    delete req.file;
  }
}
export async function getAccountImport(req, res) {
  const missing = () =>
    res.status(404).json({ message: "Preview is unavailable." });
  if (!validPreviewId(req.params.previewId))
    return missing();
  try {
    const preview = await AccountImport.findOne({
      previewId: req.params.previewId,
      owner: req.user._id,
      $or: [{ status: "completed" }, { expiresAt: { $gt: new Date() } }],
    })
      .lean();
    return preview ? res.json(publicAccountImport(preview)) : missing();
  } catch {
    return res
      .status(500)
      .json({ message: "Unable to retrieve preview. Please try again." });
  }
}

export async function confirmImport(req, res) {
  const body = req.body;
  if ((body !== undefined && (body === null || Array.isArray(body) || typeof body !== "object" || Object.keys(body).length)) ||
    (body === undefined && (Number(req.headers["content-length"]) > 0 || req.headers["transfer-encoding"])))
    return res.status(400).json({ code: "EMPTY_BODY_REQUIRED", message: "Confirmation accepts no account data." });
  const result = await confirmAccountImport(req.params.previewId, req.user._id);
  return res.status(result.statusCode).json(result.body);
}
