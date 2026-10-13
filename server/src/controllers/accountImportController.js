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
  try {
    const result = await validateCsv(req.file.buffer, {
      studentDomain: env.studentDomain,
      facultyDomain: env.facultyDomain,
      findUsers: findAccountConflicts,
    });
    const preview = await AccountImport.create({
      previewId: randomUUID(),
      owner: req.user._id,
      rows: result.rows,
      summary: result.summary,
      displayFilename: sanitizeFilename(req.file.originalname),
      schemaVersion: 2,
      status: "validated",
      expiresAt: new Date(Date.now() + config.lifetimeMs),
      purgeAt: new Date(Date.now() + config.lifetimeMs + config.temporaryRetentionMs),
    });
    return res.json(publicAccountImport(preview));
  } catch (error) {
    return res
      .status(error instanceof CsvValidationError ? 400 : 500)
      .json({
        message:
          error instanceof CsvValidationError
            ? error.message
            : "Unable to validate CSV. Please try again.",
      });
  } finally {
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
