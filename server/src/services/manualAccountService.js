import mongoose from "mongoose";
import User from "../models/User.js";
import { CSV_ACCOUNT_COLUMNS } from "../config/csvAccountFields.js";
import { validateProvisioningRows, provisionedUser } from "./accountProvisioningService.js";
import { assertProvisioningPrerequisites } from "./accountImportMigrationService.js";
import { recordManualAccountAudit } from "./activityService.js";

const unavailable = () => ({ statusCode: 503, body: { code: "SERVICE_UNAVAILABLE",
  message: "Account creation is temporarily unavailable. Please try again later." } });
const setupUnavailable = () => ({ statusCode: 503, body: { code: "PROVISIONING_SETUP_UNAVAILABLE",
  message: "Account creation is temporarily unavailable until account provisioning setup is completed." } });
const uncertain = () => ({ statusCode: 503, body: { code: "ACCOUNT_CREATION_UNCERTAIN",
  message: "Unable to confirm account creation. Refresh the user list before trying again." } });
const invalid = (errors) => ({ statusCode: 400, body: { code: "INVALID_REQUEST",
  message: "Submit only the required account fields and optional middle name as text.", errors } });
const feedback = (result) => ({ statusCode: result.summary.duplicateRows ? 409 : 422,
  body: { code: result.summary.duplicateRows ? "ACCOUNT_CONFLICT" : "VALIDATION_FAILED",
    message: "Please correct the highlighted fields.",
    errors: Object.fromEntries(result.rows[0].errors.map(({ field, message }) => [field, message])) } });
export async function createManualAccount(body, actor) {
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).some((key) => !CSV_ACCOUNT_COLUMNS.includes(key))) return invalid();
  const errors = {};
  for (const field of CSV_ACCOUNT_COLUMNS) {
    if (field === "middle_name" && !Object.hasOwn(body, field)) continue;
    if (Object.hasOwn(body, field) && typeof body[field] !== "string") errors[field] = "Enter a text value.";
  }
  if (Object.keys(errors).length) return invalid(errors);
  const row = Object.fromEntries(CSV_ACCOUNT_COLUMNS.map((field) => [field, body[field] ?? ""]));
  let session;
  try {
    const checked = await validateProvisioningRows([row]);
    if (!checked.canConfirm) return feedback(checked);
    await assertProvisioningPrerequisites({ users: User.collection, db: mongoose.connection.db });
    const prepared = await provisionedUser(checked.rows[0], { source: "manual", creator: actor });
    session = await mongoose.startSession();
    let created;
    await session.withTransaction(async () => {
      const fresh = await validateProvisioningRows([row], session);
      if (!fresh.canConfirm) throw Object.assign(new Error("Account conflict."), { feedback: feedback(fresh) });
      const user = new User(prepared.toObject());
      await user.save({ session });
      await recordManualAccountAudit({ user, actor, session });
      created = user;
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, maxCommitTimeMS: 30000 });
    return { statusCode: 201, body: { message: "User account created successfully.", user: {
      id: created.id, name: created.name, email: created.email, role: created.role,
      accountStatus: created.accountStatus, accountSource: created.accountSource, createdAt: created.createdAt,
    } } };
  } catch (error) {
    // Never forward or log raw exceptions, values, request bodies, or index names.
    if (session && error.hasErrorLabel?.("UnknownTransactionCommitResult")) return uncertain();
    if (error.code === "PROVISIONING_SETUP_UNAVAILABLE") return setupUnavailable();
    if (error.feedback) return error.feedback;
    if (error.code === 11000) {
      const fields = Object.keys(error.keyPattern || {});
      const conflicts = {};
      if (fields.some((key) => ["institutionalId", "studentId", "employeeId"].includes(key)))
        conflicts.institutional_id = "Institutional ID is already used by an account.";
      if (fields.some((key) => ["email", "username"].includes(key)))
        conflicts.official_email = "Official email is already used by an account.";
      try {
        const fresh = await validateProvisioningRows([row]);
        if (!fresh.canConfirm) return feedback(fresh);
      } catch { /* Fixed safe field mapping remains available without a recovery read. */ }
      if (!Object.keys(conflicts).length) {
        conflicts.institutional_id = "Check whether this institutional ID is already in use.";
        conflicts.official_email = "Check whether this official email is already in use.";
      }
      return { statusCode: 409, body: { code: "ACCOUNT_CONFLICT", message: "Account details are already in use.", errors: conflicts } };
    }
    return unavailable();
  } finally {
    if (session) await session.endSession().catch(() => {});
  }
}
