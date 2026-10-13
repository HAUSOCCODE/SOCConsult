import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import User from "../models/User.js";
import AccountImport from "../models/AccountImport.js";
import { env } from "../config/env.js";
import { accountImportConfig as config } from "../config/accountImport.js";
import { validateAccountRows, CsvValidationError } from "./csvValidationService.js";
import { formatFullName } from "./personNameService.js";
import { assertImportPrerequisites } from "./accountImportMigrationService.js";
import { recordAccountImportAudit } from "./activityService.js";

export const validPreviewId = (id) => typeof id === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
export const sanitizeFilename = (value) => String(value || "accounts.csv").split(/[\\/]/).pop()
  .replace(/[\x00-\x1f\x7f-\x9f]/g, "").trim().slice(0, 120) || "accounts.csv";
export function publicImportResult(batch) {
  return {
    importId: batch.previewId,
    status: batch.status,
    totalRows: batch.summary.totalRows,
    successfulRows: batch.successfulRows,
    failedRows: batch.failedRows,
    studentCount: batch.studentCount,
    facultyCount: batch.facultyCount,
    importedAt: batch.importedAt,
    message: batch.status === "completed" ? "Accounts created successfully." : "No accounts were created. Upload a new CSV to try again.",
  };
}
export function publicAccountImport(preview) {
  if (["completed", "failed"].includes(preview.status)) return publicImportResult(preview);
  return {
    previewId: preview.previewId,
    expiresAt: preview.expiresAt,
    displayFilename: preview.displayFilename,
    status: preview.status || "validated",
    summary: preview.summary,
    rows: preview.rows,
    canConfirm: preview.schemaVersion === 2 && Boolean(preview.displayFilename) &&
      preview.status === "validated" && preview.summary.totalRows > 0 &&
      preview.summary.totalRows <= config.maxRows && preview.summary.invalidRows === 0 &&
      new Date(preview.expiresAt).getTime() > Date.now(),
  };
}
export function findAccountConflicts(ids, emails, session) {
  const query = User.find({ $or: [
    { studentId: { $in: ids } }, { employeeId: { $in: ids } },
    { institutionalId: { $in: ids } }, { email: { $in: emails } }, { username: { $in: emails } },
  ] }).select("institutionalId studentId employeeId email username -_id");
  if (session) query.session(session);
  return query.lean();
}
const revalidate = (rows, session) => validateAccountRows(rows, {
  studentDomain: env.studentDomain,
  facultyDomain: env.facultyDomain,
  findUsers: (ids, emails) => findAccountConflicts(ids, emails, session),
});
const unavailable = () => ({ statusCode: 404, body: { code: "PREVIEW_UNAVAILABLE", message: "Preview is unavailable." } });
const serviceUnavailable = () => ({ statusCode: 503, body: { code: "SERVICE_UNAVAILABLE", message: "Account creation is temporarily unavailable. Please try again later." } });
const owned = (previewId, owner) => ({ previewId, owner });
async function readOwned(previewId, owner) {
  return AccountImport.findOne(owned(previewId, owner)).lean();
}
function stateResponse(preview) {
  if (!preview) return unavailable();
  if (preview.status === "completed") return { statusCode: 409, body: { ...publicImportResult(preview), code: "IMPORT_COMPLETED" } };
  if (new Date(preview.expiresAt).getTime() <= Date.now()) return unavailable();
  return { statusCode: 409, body: { code: preview.status === "processing" ? "IMPORT_PROCESSING" : "PREVIEW_INVALID",
    message: preview.status === "processing" ? "Account creation is processing. Check this import again shortly." : "Upload a new valid CSV before confirmation.",
    preview: publicAccountImport(preview) } };
}
async function hashUsers(rows) {
  const users = new Array(rows.length);
  let next = 0;
  let failure;
  // No plaintext password property is ever constructed. IDs remain account identifiers.
  await Promise.all(Array.from({ length: Math.min(config.hashingConcurrency, rows.length) }, async () => {
    while (next < rows.length && !failure) {
      try {
        const index = next++;
        const row = rows[index];
        const hash = await bcrypt.hash(row.institutional_id, 12);
        users[index] = new User({
          firstName: row.first_name, middleName: row.middle_name, lastName: row.last_name,
          name: formatFullName({ firstName: row.first_name, middleName: row.middle_name, lastName: row.last_name }),
          institutionalId: row.institutional_id,
          [row.role === "student" ? "studentId" : "employeeId"]: row.institutional_id,
          email: row.official_email, username: row.official_email, role: row.role,
          password: hash, registrationStatus: "Approved", accountStatus: "Active", accountSource: "csv",
        });
      } catch (error) {
        failure = error;
      }
    }
  }));
  if (failure) { users.splice(0); throw failure; }
  return users;
}
const attemptFilter = (batch) => ({ _id: batch._id, owner: batch.owner, status: "processing", attemptToken: batch.attemptToken });
async function invalidate(batch, result) {
  const conflict = result?.summary.duplicateRows > 0;
  const updated = await AccountImport.findOneAndUpdate(attemptFilter(batch), {
    $set: { status: "invalidated", rows: result?.rows || [], summary: result?.summary || batch.summary,
      successfulRows: 0, failedRows: result?.summary.totalRows || batch.summary.totalRows,
      failureCode: conflict ? "ACCOUNT_CONFLICT" : "REVALIDATION_FAILED",
      purgeAt: new Date(Date.now() + config.temporaryRetentionMs) },
    $unset: { attemptToken: 1, processingStartedAt: 1, transactionStartedAt: 1 },
  }, { new: true, runValidators: true }).lean();
  if (!updated) return stateResponse(await readOwned(batch.previewId, batch.owner));
  return { statusCode: conflict ? 409 : 422, body: {
    code: conflict ? "ACCOUNT_CONFLICT" : "REVALIDATION_FAILED",
    message: "No accounts were created. Correct the validation errors and upload a new CSV.",
    preview: publicAccountImport(updated),
  } };
}
export async function confirmAccountImport(previewId, owner) {
  if (!validPreviewId(previewId)) return unavailable();
  let batch, session, users;
  try {
    const preview = await readOwned(previewId, owner);
    if (!preview || preview.status === "completed" || new Date(preview.expiresAt).getTime() <= Date.now()) return stateResponse(preview);
    const cutoff = new Date(Date.now() - config.processingTimeoutMs);
    const recoverable = preview.status === "processing" && new Date(preview.processingStartedAt) <= cutoff;
    if ((preview.status !== "validated" && !recoverable) || preview.schemaVersion !== 2 || !preview.displayFilename ||
      preview.summary.invalidRows !== 0 || preview.summary.validRows !== preview.summary.totalRows)
      return stateResponse(preview);
    await assertImportPrerequisites({ users: User.collection, imports: AccountImport.collection, db: mongoose.connection.db });
    const attemptToken = randomUUID();
    batch = await AccountImport.findOneAndUpdate({ ...owned(previewId, owner),
      expiresAt: { $gt: new Date() }, schemaVersion: 2,
      $or: [{ status: "validated" }, { status: "processing", processingStartedAt: { $lte: cutoff } }],
    }, { $set: { status: "processing", processingStartedAt: new Date(), attemptToken,
      purgeAt: new Date(Date.now() + config.temporaryRetentionMs + config.processingTimeoutMs) } },
    { new: true, runValidators: true }).select("+attemptToken").lean();
    if (!batch) return stateResponse(await readOwned(previewId, owner));
    const validation = await revalidate(batch.rows);
    if (!validation.canConfirm) return await invalidate(batch, validation);
    users = await hashUsers(validation.rows);
    session = await mongoose.startSession();
    let completed;
    await session.withTransaction(async () => {
      const current = await AccountImport.findOneAndUpdate({ ...attemptFilter(batch),
        expiresAt: { $gt: new Date() }, processingStartedAt: { $gt: new Date(Date.now() - config.processingTimeoutMs) },
      }, { $set: { transactionStartedAt: new Date() } }, { new: true, session }).lean();
      if (!current) throw Object.assign(new Error("Import attempt unavailable."), { code: "ATTEMPT_UNAVAILABLE" });
      const fresh = await revalidate(current.rows, session);
      if (!fresh.canConfirm) throw Object.assign(new Error("Revalidation failed."), { code: "REVALIDATION_FAILED", validation: fresh });
      // The immutable claimed rows are the source of hashes and writes. Never accept client data.
      if (JSON.stringify(fresh.rows) !== JSON.stringify(validation.rows))
        throw Object.assign(new Error("Preview changed."), { code: "REVALIDATION_FAILED", validation: fresh });
      for (const user of users) {
        await user.validate();
        // create fresh instances on a driver retry; save changes isNew on aborted attempts.
        const write = new User(user.toObject());
        await write.save({ session });
      }
      const importedAt = new Date();
      completed = await AccountImport.findOneAndUpdate(attemptFilter(batch), {
        $set: { status: "completed", importedAt, summary: fresh.summary, successfulRows: users.length, failedRows: 0,
          studentCount: users.filter((user) => user.role === "student").length,
          facultyCount: users.filter((user) => user.role === "faculty").length },
        $unset: { rows: 1, purgeAt: 1, attemptToken: 1, processingStartedAt: 1, transactionStartedAt: 1, failureCode: 1 },
      }, { new: true, runValidators: true, session }).lean();
      if (!completed) throw Object.assign(new Error("Import attempt unavailable."), { code: "ATTEMPT_UNAVAILABLE" });
      await recordAccountImportAudit({ batch: completed, actor: owner, session });
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, maxCommitTimeMS: 30000 });
    return { statusCode: 201, body: publicImportResult(completed) };
  } catch (error) {
    // Never print error.message: duplicate-key/validation errors may contain IDs or hashes.
    if (!batch) return serviceUnavailable();
    try {
      const persisted = await readOwned(previewId, owner);
      if (persisted?.status === "completed") return { statusCode: 200, body: publicImportResult(persisted) };
      if (error.hasErrorLabel?.("UnknownTransactionCommitResult")) return serviceUnavailable();
      if (error.code === "ATTEMPT_UNAVAILABLE") return stateResponse(persisted);
      if (error.validation) return await invalidate(batch, error.validation);
      if (error instanceof CsvValidationError) return await invalidate(batch);
      if (error.code === 11000) {
        const fresh = await revalidate(batch.rows);
        if (!fresh.canConfirm) return await invalidate(batch, fresh);
      }
      await AccountImport.updateOne(attemptFilter(batch), {
        $set: { status: "failed", successfulRows: 0, failedRows: batch.summary.totalRows,
          failureCode: "IMPORT_FAILED", purgeAt: new Date(Date.now() + config.temporaryRetentionMs) },
        $unset: { rows: 1, attemptToken: 1, processingStartedAt: 1, transactionStartedAt: 1 },
      });
    } catch { /* Preserve processing state when database recovery itself is unavailable. */ }
    return serviceUnavailable();
  } finally {
    users?.splice(0);
    if (session) await session.endSession().catch(() => {});
  }
}
