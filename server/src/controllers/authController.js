import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import AuditLog from "../models/AuditLog.js";
import { migrateDeanAccount } from "../services/deanAccountMigrationService.js";
import { env } from "../config/env.js";
import { eligibleRegistrationState } from "../services/accountEligibility.js";
import {
  formatFullName,
  validatePersonName,
} from "../services/personNameService.js";
import {
  cloudinaryReference,
  destroyAsset,
  uploadBuffer,
} from "../services/cloudinaryStorage.js";

import { logActivity, recordAuditEvent, recordAuthenticationAudit } from "../services/activityService.js";

const normalize = (value = "") => value.trim().toLowerCase();
const validPassword = (password) =>
  password.length >= 8 &&
  !/\s/.test(password) &&
  /[A-Z]/.test(password) &&
  /[0-9]/.test(password);
const passwordValidationMessage =
  "Password must be at least 8 characters and include one uppercase letter and one number. Spaces are not allowed.";
const publicUser = (user) => ({
  id: user.id,
  firstName: user.firstName || "",
  middleName: user.middleName || "",
  lastName: user.lastName || "",
  name: formatFullName(user),
  email: user.email,
  username: user.username,
  role: user.role,
  studentId: user.studentId,
  employeeId: user.employeeId,
  program: user.program,
  position: user.position,
  yearLevel: user.yearLevel,
  office: user.office,
  specialization: user.specialization,
  contactNumber: user.contactNumber,
  ...(user.role === "dean" ? { institutionalId: user.institutionalId, accountSource: user.accountSource, accountStatus: user.accountStatus, passwordChangedAt: user.passwordChangedAt } : {}),
  profilePicture:
    typeof user.profilePicture === "string"
      ? user.profilePicture
      : user.profilePicture?.url,
});
const tokenFor = (user) =>
  jwt.sign({ sub: user.id }, env.jwtSecret, { expiresIn: "8h" });

export async function login(req, res) {
  const requestedRole = req.params.role;
  if (!["student", "faculty", "dean"].includes(requestedRole))
    return res.status(404).json({ message: "Unknown role." });
  const fail = async (user) => {
    if (requestedRole === "dean") {
      await recordAuditEvent({
        subjectUser: user?.id,
        actorRole: "system",
        action: "login_failed",
        category: "Authentication",
        description: "Failed sign-in",
        metadata: { role: requestedRole },
      });
    }
    return res.status(401).json({ message: "Invalid credentials." });
  };
  const password = req.body?.password;
  const rawIdentifier = req.body?.identifier ?? req.body?.email ?? req.body?.username;
  if (typeof rawIdentifier !== "string" || typeof password !== "string")
    return fail();
  const identifier = normalize(rawIdentifier);
  if (!identifier || !password) return fail();
  const user = await User.findOne(
    requestedRole === "dean"
      ? { username: identifier }
      : { email: identifier },
  ).select("+password +profilePicture");
  if (!user) {
    if (requestedRole === "student")
      return res.status(404).json({
        message: "No Student account was found for this email.",
      });
    return fail();
  }
  if (!(await bcrypt.compare(password, user.password))) {
    if (requestedRole === "student")
      return res.status(401).json({ message: "Incorrect email or password." });
    return fail(user);
  }
  if (requestedRole === "dean" &&
      (user.role !== "dean" || user.accountStatus !== "Active"))
    return fail(user);
  // The stored database role—not the selected frontend role—is authoritative.
  if (user.role !== requestedRole)
    return res
      .status(403)
      .json({ message: "This account cannot access the selected portal." });
  if (!eligibleRegistrationState(user))
    return res.status(403).json({ message: "Account access is unavailable. Please contact the Dean for assistance." });
  if (user.accountStatus !== "Active")
    return res.status(403).json({
      message:
        "Your account is currently inactive. Please contact the Dean for assistance.",
    });
  if (user.role === "dean") { try { await recordAuthenticationAudit(user, "login"); } catch { return res.status(503).json({ message: "Sign-in temporarily unavailable." }); }
  } else await logActivity("login", user.id, "User", user.id, { role: user.role });
  res.json({ token: tokenFor(user), user: publicUser(user) });
}

// Logout records activity; JWT expiry remains the existing session boundary.
export async function logout(req, res) {
  if (req.user.role === "dean") { try { await recordAuthenticationAudit(req.user, "logout"); } catch { return res.status(503).json({ message: "Unable to record sign-out." }); }
  } else await logActivity("logout", req.user.id, "User", req.user.id, { role: req.user.role });
  res.json({ message: "Signed out successfully." });
}

export async function me(req, res) {
  const user = await User.findById(req.user.id).select("+profilePicture");
  if (!user) return res.status(401).json({ message: "Authentication required." });
  res.json({ user: publicUser(user) });
}

export async function updateProfile(req, res) {
  const allowed = req.user.role === "dean"
    ? ["firstName", "middleName", "lastName", "office", "contactNumber"]
    : ["firstName", "middleName", "lastName", "program", "yearLevel", "position", "office", "specialization", "contactNumber"];
  if (!req.body || Array.isArray(req.body) || typeof req.body !== "object" ||
      Object.keys(req.body).some(key => !allowed.includes(key)) ||
      Object.entries(req.body).some(([key, value]) => typeof value !== "string" ||
        value.length > (["office", "contactNumber"].includes(key) ? 100 : 500) || /[\x00-\x1f\x7f-\x9f]/.test(value)))
    return res.status(400).json({ message: "Invalid profile update." });
  const updates = Object.fromEntries(
    allowed
      .filter((key) => !["firstName", "middleName", "lastName"].includes(key) && req.body[key] !== undefined)
      .map((key) => [key, String(req.body[key]).trim()]),
  );
  const hasNameUpdate = ["firstName", "middleName", "lastName"].some(
    (key) => req.body[key] !== undefined,
  );
  if (hasNameUpdate) {
    const existing = await User.findById(req.user.id).select(
      "firstName middleName lastName name",
    );
    if (!existing)
      return res.status(404).json({ message: "User not found." });
    const nameValidation = validatePersonName({
      firstName: req.body.firstName ?? existing.firstName,
      middleName: req.body.middleName ?? existing.middleName,
      lastName: req.body.lastName ?? existing.lastName,
    });
    if (!nameValidation.valid)
      return res.status(400).json({
        message: "Please correct the highlighted name fields.",
        errors: nameValidation.errors,
      });
    Object.assign(updates, nameValidation.values, {
      name: formatFullName(nameValidation.values),
    });
  }
  if (!["faculty", "dean"].includes(req.user.role)) delete updates.position;
  if (
    ["faculty", "dean"].includes(req.user.role) &&
    req.body.position !== undefined &&
    !updates.position
  )
    return res
      .status(400)
      .json({ message: "Position / Designation is required." });
  const user = await User.findByIdAndUpdate(req.user.id, updates, {
    new: true,
    runValidators: true,
  }).select("-password +profilePicture");
  if (!user) return res.status(409).json({ message: "Account changed. Refresh before trying again." });
  await logActivity("profile_updated", req.user.id, "User", req.user.id, {
    role: req.user.role,
    fieldNames: Object.keys(updates),
  });
  res.json({
    message: "Profile updated successfully.",
    user: publicUser(user),
  });
}

export async function updateProfilePicture(req, res) {
  if (req.body && Object.keys(req.body).length)
    return res.status(400).json({ message: "Invalid profile picture request." });
  if (!req.file)
    return res
      .status(400)
      .json({ message: "Please select a valid image file." });
  const currentUser = await User.findById(req.user.id).select(
    "+profilePicture",
  );
  if (!currentUser) return res.status(401).json({ message: "Authentication required." });
  const uploaded = await uploadBuffer(req.file.buffer, {
    folder: `consultio/profile-pictures/${req.user.role === "student" ? "students" : req.user.role === "dean" ? "deans" : "faculty"}`,
    resource_type: "image",
    transformation: [
      { width: 1000, height: 1000, crop: "limit", quality: "auto" },
    ],
  });
  const profilePicture = cloudinaryReference(uploaded);
  let user;
  try {
    user = await User.findOneAndUpdate(
      { _id: req.user.id, profilePicture: currentUser?.profilePicture ?? null },
      { profilePicture },
      { new: true, runValidators: true },
    ).select("+profilePicture");
    if (!user) throw new Error("Authenticated user no longer exists.");
  } catch (error) {
    await destroyAsset(profilePicture).catch(() => {});
    throw error;
  }
  const previous = currentUser?.profilePicture;
  if (previous && typeof previous !== "string")
    await destroyAsset(previous).catch(() => {});
  await logActivity(
    "profile_picture_updated",
    req.user.id,
    "User",
    req.user.id,
    { role: req.user.role },
  );
  res.json({
    message: "Profile picture updated successfully.",
    user: publicUser(user),
  });
}

export async function removeProfilePicture(req, res) {
  if (req.body && Object.keys(req.body).length)
    return res.status(400).json({ message: "Invalid profile picture request." });
  const currentUser = await User.findById(req.user.id).select(
    "+profilePicture",
  );
  const user = await User.findOneAndUpdate(
    { _id: req.user.id, profilePicture: currentUser?.profilePicture ?? null },
    { $unset: { profilePicture: 1 } },
    { new: true },
  ).select("+profilePicture");
  if (!user) return res.status(409).json({ message: "Account changed. Refresh before trying again." });
  const previous = currentUser?.profilePicture;
  if (previous && typeof previous !== "string")
    await destroyAsset(previous).catch(() => {});
  await logActivity(
    "profile_picture_removed",
    req.user.id,
    "User",
    req.user.id,
    { role: req.user.role },
  );
  res.json({
    message: "Profile picture removed successfully.",
    user: publicUser(user),
  });
}

export async function changePassword(req, res) {
  const keys = ["currentPassword", "newPassword", "confirmNewPassword"];
  if (!req.body || Array.isArray(req.body) || Object.keys(req.body).some(key => !keys.includes(key)) ||
      keys.some(key => typeof req.body[key] !== "string" || !req.body[key]))
    return res.status(400).json({ code: "PASSWORD_INPUT_INVALID", message: "Current password, new password, and password confirmation are required." });
  const { currentPassword, newPassword, confirmNewPassword } = req.body;
  if (newPassword !== confirmNewPassword)
    return res.status(400).json({ code: "PASSWORD_INPUT_INVALID", message: "New password and confirmation do not match." });
  if (!validPassword(newPassword))
    return res.status(400).json({ code: "PASSWORD_INPUT_INVALID", message: passwordValidationMessage });
  let session;
  try {
    session = await mongoose.startSession();
    await session.withTransaction(async () => {
      const user = await User.findById(req.user.id).select("+password").session(session);
      if (!user || user.accountStatus !== "Active" || user.role !== req.user.role ||
          !(await bcrypt.compare(currentPassword, user.password))) {
        const error = new Error("Unable to change password. Check your input and try again.");
        error.statusCode = 400; error.code = "PASSWORD_INPUT_INVALID"; throw error;
      }
      if (await bcrypt.compare(newPassword, user.password)) {
        const error = new Error("New password must be different from your current password.");
        error.statusCode = 400; error.code = "PASSWORD_SAME"; throw error;
      }
      const timestamp = new Date();
      const updated = await User.updateOne({ _id: user._id, password: user.password, accountStatus: "Active", role: user.role },
        { $set: { password: await bcrypt.hash(newPassword, 12), passwordChangedAt: timestamp } }, { session, runValidators: true });
      if (updated.modifiedCount !== 1) throw new Error("Concurrent password update");
      await AuditLog.create([{
        subjectUser: user._id, subjectRole: user.role, actorUser: user._id, actorRole: user.role,
        action: "password_changed", category: "Account", description: "Password changed",
        relatedEntityType: "User", relatedEntityId: user._id,
      }], { session });
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, maxCommitTimeMS: 30000 });
    res.json({ message: "Password changed successfully." });
  } catch (error) {
    const uncertain = error.hasErrorLabel?.("UnknownTransactionCommitResult");
    res.status(error.statusCode === 400 ? 400 : 503).json({ code: error.statusCode === 400 ? error.code : uncertain ? "PASSWORD_CHANGE_UNCERTAIN" : "PASSWORD_CHANGE_UNAVAILABLE", message: error.statusCode === 400 ? error.message :
      uncertain ? "Unable to confirm password change. Try signing in before retrying." : "Password change is temporarily unavailable." });
  } finally {
    if (session) await session.endSession().catch(() => {});
  }
}

export async function ensureDean() {
  const result = await migrateDeanAccount({ users: User.collection, auditLogs: AuditLog.collection, username: env.deanUsername });
  if (result.status !== "missing") return;
  await User.create({
    name: "SOCConsult Dean",
    username: env.deanUsername,
    password: await bcrypt.hash(env.deanPassword, 12),
    role: "dean",
    registrationStatus: "Approved",
    accountStatus: "Active",
  });
}
