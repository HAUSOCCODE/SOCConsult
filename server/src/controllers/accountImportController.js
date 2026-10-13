import { randomUUID } from "node:crypto";
import User from "../models/User.js";
import AccountImport from "../models/AccountImport.js";
import { env } from "../config/env.js";
import { accountImportConfig as config } from "../config/accountImport.js";
import {
  validateCsv,
  CsvValidationError,
} from "../services/csvValidationService.js";

const publicPreview = (preview) => ({
  previewId: preview.previewId,
  expiresAt: preview.expiresAt,
  summary: preview.summary,
  rows: preview.rows,
  canConfirm: preview.summary.invalidRows === 0,
});
export async function validateAccountImport(req, res) {
  try {
    const result = await validateCsv(req.file.buffer, {
      studentDomain: env.studentDomain,
      facultyDomain: env.facultyDomain,
      findUsers: (ids, emails) =>
        User.find({
          $or: [
            { studentId: { $in: ids } },
            { employeeId: { $in: ids } },
            { email: { $in: emails } },
          ],
        })
          .select("studentId employeeId email -_id")
          .lean(),
    });
    const preview = await AccountImport.create({
      previewId: randomUUID(),
      owner: req.user._id,
      rows: result.rows,
      summary: result.summary,
      schemaVersion: 1,
      expiresAt: new Date(Date.now() + config.lifetimeMs),
    });
    return res.json(publicPreview(preview));
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
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      req.params.previewId,
    )
  )
    return missing();
  try {
    const preview = await AccountImport.findOne({
      previewId: req.params.previewId,
      owner: req.user._id,
      expiresAt: { $gt: new Date() },
    })
      .select("previewId expiresAt summary rows -_id")
      .lean();
    return preview ? res.json(publicPreview(preview)) : missing();
  } catch {
    return res
      .status(500)
      .json({ message: "Unable to retrieve preview. Please try again." });
  }
}
