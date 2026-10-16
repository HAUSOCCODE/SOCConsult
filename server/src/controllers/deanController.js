import bcrypt from "bcryptjs";
import { createManualAccount } from "../services/manualAccountService.js";
import User from "../models/User.js";
import { logActivity } from "../services/activityService.js";

import {
  listManagedUsers,
  readManagedUser,
  changeManagedUserStatus,
  resetManagedUserPassword,
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
  if (req.body === undefined && (Number(req.get("Content-Length")) > 0 || req.get("Transfer-Encoding")))
    return res.status(400).json({ message: "Password reset requires an empty request body." });
  const result = await resetManagedUserPassword(req.params.id, req.body, req.user.id, req.get("If-Match"));
  return res.status(result.statusCode).json(result.body);
}
export async function updateUserStatus(req, res) {
  const result = await changeManagedUserStatus(
    req.params.id,
    req.body,
    req.user.id,
  );
  return res.status(result.statusCode).json(result.body);
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
