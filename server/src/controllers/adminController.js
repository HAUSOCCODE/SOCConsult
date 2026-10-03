import bcrypt from "bcryptjs";
import User from "../models/User.js";
import Appointment from "../models/Appointment.js";
import { logActivity, notify } from "../services/activityService.js";
import { createConsultationSummary } from "../services/consultationSummaryService.js";

const managedRoles = ["student", "faculty"];
const withProfileUrl = (user) => ({
  ...user,
  profilePicture:
    typeof user.profilePicture === "string"
      ? user.profilePicture
      : user.profilePicture?.url,
});

export async function getRegistrations(req, res) {
  const registrations = await User.find({
    role: { $in: managedRoles },
    registrationStatus: req.query.status || "Pending",
  })
    .select("-password")
    .sort({ createdAt: -1 });
  res.json({ registrations });
}
export async function getRegistration(req, res) {
  const registration = await User.findOne({
    _id: req.params.id,
    role: { $in: managedRoles },
  }).select("-password");
  if (!registration)
    return res.status(404).json({ message: "Registration not found." });
  res.json({ registration });
}
export async function approveRegistration(req, res) {
  const user = await User.findOneAndUpdate(
    {
      _id: req.params.id,
      role: { $in: managedRoles },
      registrationStatus: "Pending",
    },
    {
      $set: {
        registrationStatus: "Approved",
        accountStatus: "Active",
        approvalMethod: "admin",
        approvedAt: new Date(),
        approvedBy: req.user.id,
      },
      $unset: { rejectedAt: 1, rejectedBy: 1, rejectionReason: 1 },
    },
    { new: true },
  ).select("-password");
  if (!user)
    return res
      .status(409)
      .json({ message: "This registration is no longer pending." });
  await Promise.all([
    logActivity("registration_approved", req.user.id, "User", user.id, {
      role: user.role,
      previousStatus: "Pending",
      newStatus: "Active",
    }),
    notify(
      user.id,
      "registration",
      "Registration approved",
      "Your SOCConsult account has been approved. You may now log in.",
      user.id,
    ),
  ]);
  res.json({
    message: "Registration approved successfully.",
    registration: user,
  });
}
export async function rejectRegistration(req, res) {
  const reason = (req.body.reason || "").trim();
  const user = await User.findOneAndUpdate(
    {
      _id: req.params.id,
      role: { $in: managedRoles },
      registrationStatus: "Pending",
    },
    {
      $set: {
        registrationStatus: "Rejected",
        accountStatus: "Inactive",
        rejectedAt: new Date(),
        rejectedBy: req.user.id,
        rejectionReason: reason,
      },
    },
    { new: true },
  ).select("-password");
  if (!user)
    return res
      .status(409)
      .json({ message: "This registration is no longer pending." });
  await Promise.all([
    logActivity("registration_rejected", req.user.id, "User", user.id, {
      role: user.role,
      previousStatus: "Pending",
      newStatus: "Rejected",
    }),
    notify(
      user.id,
      "registration",
      "Registration rejected",
      reason || "Please contact the School of Computing administrator.",
      user.id,
    ),
  ]);
  res.json({ message: "Registration rejected.", registration: user });
}
export async function getUsers(_req, res) {
  const users = await User.find({ role: { $ne: "admin" } })
    .select("-password +profilePicture")
    .sort({ createdAt: -1 })
    .lean();
  res.json({
    users: users.map(withProfileUrl),
  });
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
  const user = await User.findOne({
    _id: req.params.id,
    role: { $in: managedRoles },
  })
    .select("-password +profilePicture")
    .lean();
  if (!user) return res.status(404).json({ message: "User not found." });
  res.json({ user: withProfileUrl(user) });
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
  await logActivity("admin_password_reset", req.user.id, "User", user.id, {
    role: user.role,
  });
  res.json({ message: "Password reset successfully." });
}
export async function updateUserStatus(req, res) {
  if (!["Active", "Inactive"].includes(req.body.accountStatus))
    return res.status(400).json({ message: "Invalid account status." });
  const previous = await User.findOne({
    _id: req.params.id,
    role: { $ne: "admin" },
  }).select("accountStatus");
  const user = await User.findOneAndUpdate(
    { _id: req.params.id, role: { $ne: "admin" } },
    { accountStatus: req.body.accountStatus },
    { new: true },
  ).select("-password");
  if (!user) return res.status(404).json({ message: "User not found." });
  await logActivity(
    req.body.accountStatus === "Active"
      ? "account_activated"
      : "account_deactivated",
    req.user.id,
    "User",
    user.id,
    {
      previousStatus: previous?.accountStatus,
      newStatus: req.body.accountStatus,
    },
  );
  res.json({
    message: `Account ${req.body.accountStatus.toLowerCase()}.`,
    user,
  });
}
export async function getAdminAppointments(_req, res) {
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
    if (status >= 500) console.error("[Admin AI Summary]", error.message);
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
export async function changeAdminPassword(req, res) {
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
