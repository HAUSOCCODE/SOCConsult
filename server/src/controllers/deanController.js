import bcrypt from "bcryptjs";
import { createManualAccount } from "../services/manualAccountService.js";
import User from "../models/User.js";
import Appointment from "../models/Appointment.js";
import { logActivity } from "../services/activityService.js";
import { createConsultationSummary } from "../services/consultationSummaryService.js";

import {
  listManagedUsers,
  readManagedUser,
  changeManagedUserStatus,
} from "../services/userManagementService.js";

const managedRoles = ["student", "faculty"];
export async function createUser(req, res) {
  const result = await createManualAccount(req.body, req.user.id);
  return res.status(result.statusCode).json(result.body);
}
export async function getUsers(req, res) {
  const result = await listManagedUsers(req.query);
  return res.status(result.statusCode).json(result.body);
}
export async function getUserRegistrationReport(_req, res) {
  const users = await User.find({ role: { $in: managedRoles } })
    .select(
      "name firstName middleName lastName email role createdAt emailVerified emailVerifiedAt registrationStatus approvalMethod approvedBy approvedAt rejectedBy rejectedAt accountStatus",
    )
    .populate("approvedBy", "name email")
    .populate("rejectedBy", "name email")
    .sort({ createdAt: -1 })
    .lean();
  res.json({ users });
}
export async function getUser(req, res) {
  const result = await readManagedUser(req.params.id);
  return res.status(result.statusCode).json(result.body);
}
export async function resetUserPassword(req, res) {
  const newPassword = req.body.newPassword || "";
  const confirmPassword = req.body.confirmPassword || "";
  if (!newPassword || !confirmPassword)
    return res
      .status(400)
      .json({ message: "New password and confirmation are required." });
  if (newPassword !== confirmPassword)
    return res.status(400).json({ message: "Passwords do not match." });
  if (
    newPassword.length < 8 ||
    /\s/.test(newPassword) ||
    !/[A-Z]/.test(newPassword) ||
    !/[0-9]/.test(newPassword)
  )
    return res.status(400).json({
      message:
        "Password must be at least 8 characters and include one uppercase letter and one number. Spaces are not allowed.",
    });
  const user = await User.findOne({
    _id: req.params.id,
    role: { $in: managedRoles },
  });
  if (!user) return res.status(404).json({ message: "User not found." });
  user.password = await bcrypt.hash(newPassword, 12);
  user.passwordChangedAt = new Date();
  await user.save();
  await logActivity("dean_password_reset", req.user.id, "User", user.id, {
    role: user.role,
  });
  res.json({ message: "Password reset successfully." });
}
export async function updateUserStatus(req, res) {
  const result = await changeManagedUserStatus(
    req.params.id,
    req.body,
    req.user.id,
  );
  return res.status(result.statusCode).json(result.body);
}
export async function getDeanAppointments(_req, res) {
  const records = await Appointment.find()
    .select("+meetingLink")
    .populate("student", "name email program")
    .populate("faculty", "name email position")
    .populate("availability", "meetingPlatform +meetingLink")
    .sort({ createdAt: -1 })
    .lean();
  const appointments = records.map(({ availability, ...appointment }) => ({
    ...appointment,
    availability: availability?._id || availability,
    meetingPlatform:
      availability?.meetingPlatform ||
      appointment.meetingPlatform ||
      (appointment.consultationMode === "Online" ? appointment.location : ""),
    meetingLink: availability?.meetingLink || appointment.meetingLink || "",
  }));
  res.json({ appointments });
}

export async function getAiConsultationSummary(req, res) {
  try {
    const report = await createConsultationSummary(
      req.query.startDate,
      req.query.endDate,
    );
    return res.json(report);
  } catch (error) {
    const status = Number(error.statusCode) || 502;
    if (status >= 500) console.error("[Dean AI Summary]", error.message);
    return res.status(status).json({
      message:
        status === 503
          ? "AI summary is currently unavailable because the AI service is not configured."
          : status >= 500
            ? "AI summary is temporarily unavailable. Please try again later."
            : error.message,
    });
  }
}
export async function changeDeanPassword(req, res) {
  const user = await User.findById(req.user.id).select("+password");
  if (!(await bcrypt.compare(req.body.currentPassword || "", user.password)))
    return res.status(400).json({ message: "Current password is incorrect." });
  if ((req.body.newPassword || "").length < 8)
    return res
      .status(400)
      .json({ message: "New password must contain at least 8 characters." });
  user.password = await bcrypt.hash(req.body.newPassword, 12);
  user.passwordChangedAt = new Date();
  await user.save();
  await logActivity("password_changed", user.id, "User", user.id);
  res.json({ message: "Password changed successfully." });
}
