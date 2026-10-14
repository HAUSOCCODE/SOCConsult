import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import AuditLog from "../models/AuditLog.js";
import { migrateDeanAccount } from "../services/deanAccountMigrationService.js";
import { env } from "../config/env.js";
import { STUDENT_PROGRAMS } from "../config/programs.js";
import {
  formatFullName,
  validatePersonName,
} from "../services/personNameService.js";
import {
  cloudinaryReference,
  destroyAsset,
  uploadBuffer,
} from "../services/cloudinaryStorage.js";

const normalize = (value = "") => value.trim().toLowerCase();
const validEmail = (email, domain) => {
  const normalized = normalize(email);
  const emailDomain = normalized.slice(normalized.lastIndexOf("@") + 1);
  return (
    /^[^\s@]+@[^\s@]+$/.test(normalized) && emailDomain === normalize(domain)
  );
};
const validPassword = (password) =>
  password.length >= 8 &&
  !/\s/.test(password) &&
  /[A-Z]/.test(password) &&
  /[0-9]/.test(password);
const passwordValidationMessage =
  "Password must be at least 8 characters and include one uppercase letter and one number. Spaces are not allowed.";
import { logActivity, notify, recordAuditEvent } from "../services/activityService.js";
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
  profilePicture:
    typeof user.profilePicture === "string"
      ? user.profilePicture
      : user.profilePicture?.url,
});
const tokenFor = (user) =>
  jwt.sign({ sub: user.id }, env.jwtSecret, { expiresIn: "8h" });

export async function register(req, res) {
  const role = req.params.role;
  if (!["student", "faculty"].includes(role))
    return res
      .status(404)
      .json({ message: "Registration is unavailable for this role." });
  const nameValidation = validatePersonName(req.body);
  const email = normalize(req.body.email);
  const password = req.body.password || "";
  const domain = role === "student" ? env.studentDomain : env.facultyDomain;
  const roleLabel = role === "student" ? "student" : "faculty";
  if (!nameValidation.valid)
    return res.status(400).json({
      message: "Please correct the highlighted name fields.",
      errors: nameValidation.errors,
    });
  const { firstName, middleName, lastName } = nameValidation.values;
  const name = formatFullName(nameValidation.values);
  if (!validEmail(email, domain)) {
    return res.status(400).json({
      message: `Please use your official Holy Angel University ${roleLabel} email (@${domain}).`,
    });
  }
  if (!validPassword(password))
    return res.status(400).json({ message: passwordValidationMessage });
  const existing = await User.findOne({ email });
  if (existing?.registrationStatus === "Pending")
    return res.status(409).json({
      message:
        "An account with this email has already been created and is awaiting dean approval. You do not need to register again.",
    });
  if (existing?.registrationStatus === "Approved")
    return res.status(409).json({
      message: "An account with this email already exists. Please log in.",
    });
  if (existing)
    return res.status(409).json({
      message:
        "A registration with this email already exists. Please contact the School of Computing dean.",
    });
  const idField = role === "student" ? "studentId" : "employeeId";
  const idValue = (req.body[idField] || "").trim();
  if (!idValue)
    return res.status(400).json({
      message: `${role === "student" ? "Student" : "Employee"} ID is required.`,
    });
  if (Buffer.byteLength(idValue, "utf8") > 72)
    return res.status(400).json({ message: "Institutional ID must be 72 UTF-8 bytes or fewer." });
  if (await User.findOne({ $or: [{ institutionalId: idValue }, { studentId: idValue }, { employeeId: idValue }] }))
    return res.status(409).json({ message: "An account with this institutional ID already exists." });
  const program =
    role === "student" ? (req.body.program || "").trim() : undefined;
  if (role === "student" && !STUDENT_PROGRAMS.includes(program))
    return res.status(400).json({ message: "Please select your program." });
  const position =
    role === "faculty" ? (req.body.position || "").trim() : undefined;
  if (role === "faculty" && !position)
    return res
      .status(400)
      .json({ message: "Position / Designation is required." });
  let user;
  try {
    user = await User.create({
      name,
      firstName,
      middleName,
      lastName,
      email,
      password: await bcrypt.hash(password, 12),
      role,
      [idField]: idValue,
      institutionalId: idValue,
      accountSource: "self_registration",
      program,
      position,
      registrationStatus: "Pending",
      accountStatus: "Inactive",
    });
  } catch (error) {
    if (error.code === 11000)
      return res.status(409).json({ message: "An account with this email or institutional ID already exists." });
    throw error;
  }
  await logActivity(`${role}_registered`, user.id, "User", user.id, { role });
  const deans = await User.find({
    role: "dean",
    accountStatus: "Active",
  }).select("_id");
  await Promise.all(
    deans.map((dean) =>
      notify(
        dean.id,
        "registration",
        `New ${role} registration`,
        `${name} is awaiting approval.`,
        user.id,
      ),
    ),
  );
  res.status(201).json({
    message: "Registration submitted and awaiting dean approval.",
    user: publicUser(user),
  });
}

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
  if (user.role === "faculty" && user.registrationStatus === "Pending")
    return res.status(403).json({
      message:
        "Your account has already been created. Please wait for a Dean to approve your registration before you can access SOCConsult. You do not need to register again.",
    });
  if (user.role === "faculty" && user.registrationStatus === "Rejected")
    return res.status(403).json({
      message:
        "Your registration was not approved. Please contact the Dean if you believe this requires review.",
    });
  if (user.accountStatus !== "Active")
    return res.status(403).json({
      message:
        "Your account is currently inactive. Please contact the Dean for assistance.",
    });
  await logActivity("login", user.id, "User", user.id, { role: user.role });
  res.json({ token: tokenFor(user), user: publicUser(user) });
}

// Logout records activity; JWT expiry remains the existing session boundary.
export async function logout(req, res) {
  await logActivity("logout", req.user.id, "User", req.user.id, { role: req.user.role });
  res.json({ message: "Signed out successfully." });
}

export async function me(req, res) {
  const user = await User.findById(req.user.id).select("+profilePicture");
  res.json({ user: publicUser(user) });
}

export async function updateProfile(req, res) {
  const allowed = [
    "program",
    "yearLevel",
    "position",
    "office",
    "specialization",
    "contactNumber",
  ];
  const updates = Object.fromEntries(
    allowed
      .filter((key) => req.body[key] !== undefined)
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
  if (!req.file)
    return res
      .status(400)
      .json({ message: "Please select a valid image file." });
  const currentUser = await User.findById(req.user.id).select(
    "+profilePicture",
  );
  const uploaded = await uploadBuffer(req.file.buffer, {
    folder: `consultio/profile-pictures/${req.user.role === "student" ? "students" : "faculty"}`,
    resource_type: "image",
    transformation: [
      { width: 1000, height: 1000, crop: "limit", quality: "auto" },
    ],
  });
  const profilePicture = cloudinaryReference(uploaded);
  let user;
  try {
    user = await User.findByIdAndUpdate(
      req.user.id,
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
  const currentUser = await User.findById(req.user.id).select(
    "+profilePicture",
  );
  const user = await User.findByIdAndUpdate(
    req.user.id,
    { $unset: { profilePicture: 1 } },
    { new: true },
  ).select("+profilePicture");
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
  const currentPassword = req.body.currentPassword || "";
  const newPassword = req.body.newPassword || "";
  const confirmNewPassword = req.body.confirmNewPassword || "";
  if (!currentPassword || !newPassword || !confirmNewPassword)
    return res.status(400).json({
      message:
        "Current password, new password, and password confirmation are required.",
    });
  if (newPassword !== confirmNewPassword)
    return res.status(400).json({
      message: "New password and confirmation do not match.",
    });
  if (!validPassword(newPassword))
    return res.status(400).json({ message: passwordValidationMessage });

  const user = await User.findById(req.user.id).select("+password");
  if (!user || !(await bcrypt.compare(currentPassword, user.password)))
    return res.status(400).json({ message: "Current password is incorrect." });
  if (await bcrypt.compare(newPassword, user.password))
    return res.status(400).json({
      message: "New password must be different from your current password.",
    });

  user.password = await bcrypt.hash(newPassword, 12);
  user.passwordChangedAt = new Date();
  await user.save();
  await logActivity("password_changed", user.id, "User", user.id, {
    role: user.role,
  });
  res.json({ message: "Password changed successfully." });
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
