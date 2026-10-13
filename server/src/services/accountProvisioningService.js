import bcrypt from "bcryptjs";
import User from "../models/User.js";
import { env } from "../config/env.js";
import { validateAccountRows } from "./csvValidationService.js";
import { formatFullName } from "./personNameService.js";

export function findAccountConflicts(ids, emails, session) {
  const query = User.find({ $or: [
    { studentId: { $in: ids } }, { employeeId: { $in: ids } },
    { institutionalId: { $in: ids } }, { email: { $in: emails } }, { username: { $in: emails } },
  ] }).select("institutionalId studentId employeeId email username -_id");
  if (session) query.session(session);
  return query.lean();
}
export const validateProvisioningRows = (rows, session) => validateAccountRows(rows, {
  studentDomain: env.studentDomain, facultyDomain: env.facultyDomain,
  findUsers: (ids, emails) => findAccountConflicts(ids, emails, session),
});

// Only validated, normalized rows enter this helper. Never construct a plaintext password field.
export async function provisionedUser(row, { source, creator } = {}) {
  if (!["csv", "manual"].includes(source) || !row.valid ||
      !["student", "faculty"].includes(row.role) ||
      Buffer.byteLength(row.institutional_id, "utf8") > 72)
    throw new Error("Invalid provisioning data.");
  const hash = await bcrypt.hash(row.institutional_id, 12);
  return new User({
    firstName: row.first_name, middleName: row.middle_name, lastName: row.last_name,
    name: formatFullName({ firstName: row.first_name, middleName: row.middle_name, lastName: row.last_name }),
    institutionalId: row.institutional_id,
    [row.role === "student" ? "studentId" : "employeeId"]: row.institutional_id,
    email: row.official_email, username: row.official_email, role: row.role,
    password: hash, registrationStatus: "Approved", accountStatus: "Active", accountSource: source,
    ...(source === "manual" && { createdBy: creator }),
  });
}
