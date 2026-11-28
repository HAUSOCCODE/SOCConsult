import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { APPOINTMENT_STATUSES, isUnresolvedStatus } from "../config/appointmentStatus.js";
import Appointment from "../models/Appointment.js";
import AuditLog from "../models/AuditLog.js";
import Availability from "../models/Availability.js";
import OneTimeScheduleHold from "../models/OneTimeScheduleHold.js";
import User from "../models/User.js";
import { eligibleAccount } from "./accountEligibility.js";
import { storedManagementRoles } from "./deanAccountMigrationService.js";
import { deanInstallationMarker } from "./deanInitializationService.js";
import { hasFacultyAccessIdentity, hasOfficialFacultyEmail, publicManagedUser, resolveResetInstitutionalId } from "./userManagementService.js";

const fields = "name firstName middleName lastName email username institutionalId employeeId role accountStatus registrationStatus emailVerified updatedAt authRevision +password";
const validId = value => typeof value === "string" && /^[a-f\d]{24}$/i.test(value);
const validVersion = value => value === null || (typeof value === "string" &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)));
const version = user => user.updatedAt?.toISOString() ?? null;
// Check canonical bcrypt encoding before a false comparison can be interpreted as personalized.
const usableHash = hash => typeof hash === "string" &&
  /^\$2[aby]\$(?:0[4-9]|1[0-4])\$[./A-Za-z0-9]{21}[.Oeu][./A-Za-z0-9]{30}[.CGKOSWaeimquy26]$/.test(hash);
const canRevise = user => Number.isSafeInteger(user.authRevision ?? 0) &&
  (user.authRevision ?? 0) >= 0 && (user.authRevision ?? 0) < Number.MAX_SAFE_INTEGER;
const successorIdentity = user => {
  const id = resolveResetInstitutionalId(user);
  return id && (!user.employeeId || user.employeeId === id) && hasOfficialFacultyEmail(user.email) &&
    typeof user.username === "string" && /^[^\s\p{Cc}\p{Cf}]{1,254}$/u.test(user.username) &&
    user.username === user.username.toLowerCase() && user.emailVerified !== false;
};

const responses = {
  TRANSFER_INPUT_INVALID: [400, "Select a Faculty successor and a disposition, enter your current password and type TRANSFER."],
  TRANSFER_CONFLICT: [409, "The Dean or Faculty account changed. Review the current details before confirming again."],
  SUCCESSOR_INELIGIBLE: [422, "Select an active Faculty account with an eligible registration state."],
  SUCCESSOR_IDENTITY_REQUIRED: [422, "The Faculty account needs valid institutional identity and sign-in details. Contact the institutional administrator for assistance."],
  SUCCESSOR_PASSWORD_REQUIRED: [422, "Ask the Faculty member to personalize their password in Faculty Account Settings before transfer. If they cannot sign in, resolve access first."],
  OUTGOING_FACULTY_INELIGIBLE: [422, "Your account needs a valid official Faculty email and institutional ID to continue as Faculty. Contact the institutional administrator or choose deactivation."],
  OUTGOING_CONSULTATIONS_OPEN: [409, "Resolve outstanding consultations, reservations and attendance through the consultation workflows before deactivating your account."],
  TRANSFER_PASSWORD_INVALID: [400, "The current password is incorrect."],
  TRANSFER_UNAVAILABLE: [503, "Dean privilege transfer is temporarily unavailable."],
  TRANSFER_UNCERTAIN: [503, "The transfer could not be confirmed. Contact the institutional administrator to verify the current Dean and transfer audit before trying again."],
};

class TransferError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = code => { throw new TransferError(code); };
const response = code => {
  const [statusCode, message] = responses[code];
  return { statusCode, body: { code, message } };
};

async function successorIssue(user) {
  if (!eligibleAccount(user, "faculty")) return "SUCCESSOR_INELIGIBLE";
  if (!successorIdentity(user)) return "SUCCESSOR_IDENTITY_REQUIRED";
  if (!canRevise(user)) return "TRANSFER_UNAVAILABLE";
  if (!usableHash(user.password) || await bcrypt.compare(resolveResetInstitutionalId(user), user.password))
    return "SUCCESSOR_PASSWORD_REQUIRED";
  return null;
}

export async function previewDeanTransfer(actor, successorId) {
  if (!validId(successorId) || successorId.toLowerCase() === String(actor._id))
    return response("TRANSFER_INPUT_INVALID");
  try {
    const successor = await User.findOne({ _id: successorId, role: "faculty" }).select(fields).lean();
    if (!successor) return response("SUCCESSOR_INELIGIBLE");
    return { statusCode: 200, body: {
      successor: publicManagedUser(successor),
      successorIssue: await successorIssue(successor),
      outgoingVersion: version(actor),
      canRemainFaculty: hasFacultyAccessIdentity(actor),
    } };
  } catch {
    return response("TRANSFER_UNAVAILABLE");
  }
}

const inputKeys = ["successorId", "successorVersion", "outgoingVersion", "disposition", "currentPassword", "confirmation"];
const unresolvedStatuses = [...APPOINTMENT_STATUSES.filter(isUnresolvedStatus),
  "Awaiting Faculty Schedule", "Approved", "Needs Reschedule", "Rescheduled"];

async function hasOpenConsultations(faculty, session) {
  const now = new Date();
  return await Appointment.exists({ faculty, status: { $in: unresolvedStatuses } }).session(session) ||
    await OneTimeScheduleHold.exists({ faculty, expiresAt: { $gt: now } }).session(session) ||
    await Availability.exists({ faculty, endAt: { $gt: now }, reservationToken: { $exists: true } }).session(session);
}

export async function transferDeanPrivileges(actor, input) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).length !== inputKeys.length || inputKeys.some(key => !Object.hasOwn(input, key)) ||
      !validId(input.successorId) || input.successorId.toLowerCase() === String(actor._id) ||
      !validVersion(input.successorVersion) || !validVersion(input.outgoingVersion) ||
      !["Active", "Inactive"].includes(input.disposition) || input.confirmation !== "TRANSFER" ||
      typeof input.currentPassword !== "string" || !input.currentPassword || input.currentPassword.length > 1024)
    return response("TRANSFER_INPUT_INVALID");

  let session;
  let committing = false;
  try {
    session = await mongoose.startSession();
    session.startTransaction({ readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, maxCommitTimeMS: 30000 });
    // Every transfer writes the same marker. A competing transaction must abort or see the new roles.
    const marker = await mongoose.connection.collection("installationState").updateOne(
      deanInstallationMarker, { $inc: { deanTransferRevision: 1 } }, { session },
    );
    if (marker.modifiedCount !== 1) fail("TRANSFER_UNAVAILABLE");

    const management = await User.find({ role: { $in: storedManagementRoles } }).select(fields).limit(2).session(session).lean();
    const [outgoing] = management;
    if (management.length !== 1 || !eligibleAccount(outgoing, "dean") ||
        String(outgoing._id) !== String(actor._id) || (outgoing.authRevision ?? 0) !== (actor.authRevision ?? 0) ||
        version(outgoing) !== input.outgoingVersion)
      fail("TRANSFER_CONFLICT");
    if (!canRevise(outgoing)) fail("TRANSFER_UNAVAILABLE");
    if (!outgoing.password || !(await bcrypt.compare(input.currentPassword, outgoing.password)))
      fail("TRANSFER_PASSWORD_INVALID");

    const successor = await User.findById(input.successorId).select(fields).session(session).lean();
    if (!successor || version(successor) !== input.successorVersion) fail("TRANSFER_CONFLICT");
    const issue = await successorIssue(successor);
    if (issue) fail(issue);
    if (input.disposition === "Active" && !hasFacultyAccessIdentity(outgoing)) fail("OUTGOING_FACULTY_INELIGIBLE");

    for (const [user, role, accountStatus] of [[outgoing, "faculty", input.disposition], [successor, "dean", "Active"]]) {
      const updated = await User.updateOne({
        _id: user._id, role: user.role, accountStatus: "Active", password: user.password,
        updatedAt: user.updatedAt ?? null, authRevision: user.authRevision ?? null,
      }, { $set: {
        role, accountStatus, authRevision: (user.authRevision ?? 0) + 1,
        ...(role === "faculty" && { deanAccessRelinquishedAt: new Date() }),
        updatedAt: new Date(Math.max(Date.now(), (user.updatedAt?.getTime() ?? 0) + 1)),
      } }, { session, runValidators: true, timestamps: false });
      if (updated.modifiedCount !== 1) fail("TRANSFER_CONFLICT");
    }
    // The outgoing user write conflicts with scheduling writers that share the participant lock.
    if (input.disposition === "Inactive" && await hasOpenConsultations(outgoing._id, session))
      fail("OUTGOING_CONSULTATIONS_OPEN");

    await AuditLog.create([{
      subjectUser: successor._id, subjectUsers: [outgoing._id, successor._id], subjectRole: "dean",
      actorUser: outgoing._id, actorRole: "dean", action: "dean_privilege_transferred", category: "Account",
      relatedEntityType: "User", relatedEntityId: successor._id,
      metadata: { outgoingBefore: "dean", outgoingAfter: "faculty", incomingBefore: "faculty", incomingAfter: "dean",
        outgoingAccountStatus: input.disposition },
    }], { session });

    // The driver may retry the commit command for this transaction. The application never replays the swap.
    committing = true;
    await session.commitTransaction();
    return { statusCode: 200, body: { code: "TRANSFER_COMPLETED" } };
  } catch (error) {
    if (error.hasErrorLabel?.("UnknownTransactionCommitResult")) return response("TRANSFER_UNCERTAIN");
    if (error instanceof TransferError) return response(error.code);
    if (error.code === 112 || error.hasErrorLabel?.("TransientTransactionError")) return response("TRANSFER_CONFLICT");
    return response(committing ? "TRANSFER_UNCERTAIN" : "TRANSFER_UNAVAILABLE");
  } finally {
    if (session?.inTransaction()) await session.abortTransaction().catch(() => {});
    if (session) await session.endSession().catch(() => {});
  }
}
