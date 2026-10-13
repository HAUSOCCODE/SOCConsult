import mongoose from "mongoose";
import User from "../models/User.js";
import { formatFullName } from "./personNameService.js";
import { recordUserStatusAudit } from "./activityService.js";

export const managedRoles = ["student", "faculty"];
const fields =
  "name firstName middleName lastName institutionalId studentId employeeId email role accountSource accountStatus createdAt updatedAt";
const fail = (statusCode, message, code) => ({
  statusCode,
  body: { message, ...(code && { code }) },
});
const unavailable = () =>
  fail(
    503,
    "User management is temporarily unavailable. Please try again later.",
    "SERVICE_UNAVAILABLE",
  );
class ManagementError extends Error {
  constructor(response) {
    super(response.body.message);
    this.response = response;
  }
}
const validId = (id) => typeof id === "string" && /^[a-f0-9]{24}$/i.test(id);
export function publicManagedUser(user) {
  return {
    _id: String(user._id),
    name: formatFullName(user),
    institutionalId: String(
      user.institutionalId ||
        (user.role === "student" ? user.studentId : user.employeeId) ||
        "",
    ),
    email: user.email || "",
    role: user.role,
    accountSource: ["csv", "manual"].includes(user.accountSource)
      ? user.accountSource
      : "legacy",
    accountStatus: user.accountStatus,
    createdAt: user.createdAt,
    // Used for optimistic concurrency, never rendered as an account detail.
    version: user.updatedAt ? new Date(user.updatedAt).toISOString() : null,
  };
}
export function parseUserQuery(query = {}) {
  const values = {};
  for (const [key, allowed] of Object.entries({
    role: ["all", ...managedRoles],
    status: ["all", "Active", "Inactive"],
    source: ["all", "csv", "manual"],
  })) {
    const value = query[key] ?? "all";
    if (typeof value !== "string" || !allowed.includes(value)) return null;
    values[key] = value;
  }
  if (query.search !== undefined && typeof query.search !== "string")
    return null;
  const search = (query.search || "")
    .normalize("NFC")
    .trim()
    .replace(/\s+/g, " ");
  if (search.length > 200 || /[\x00-\x1f\x7f]/.test(search)) return null;
  const integer = (value, fallback, max) =>
    value === undefined
      ? fallback
      : typeof value === "string" &&
          /^[1-9]\d*$/.test(value) &&
          Number.isSafeInteger(Number(value)) &&
          Number(value) <= max
        ? Number(value)
        : null;
  const page = integer(query.page, 1, 1000000),
    limit = integer(query.limit, 20, 100);
  if (!page || !limit) return null;
  const filter = {
    role: values.role === "all" ? { $in: managedRoles } : values.role,
  };
  if (values.status !== "all") filter.accountStatus = values.status;
  if (values.source !== "all") filter.accountSource = values.source;
  if (search) {
    const literal = search
      .split(" ")
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("\\s+");
    filter.$or = [
      "name",
      "firstName",
      "middleName",
      "lastName",
      "institutionalId",
      "studentId",
      "employeeId",
      "email",
    ].map((field) => ({ [field]: { $regex: literal, $options: "i" } }));
  }
  return { filter, page, limit, filters: { search, ...values } };
}
export async function listManagedUsers(query) {
  const parsed = parseUserQuery(query);
  if (!parsed) return fail(400, "Invalid user search, filters, or pagination.");
  try {
    const { filter, limit, filters } = parsed;
    const total = await User.countDocuments(filter);
    const totalPages = Math.ceil(total / limit);
    const page = Math.min(parsed.page, Math.max(1, totalPages));
    const users = await User.find(filter)
      .select(fields)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();
    return {
      statusCode: 200,
      body: {
        users: users.map(publicManagedUser),
        pagination: { page, limit, total, totalPages },
        filters,
      },
    };
  } catch {
    return unavailable();
  }
}
export async function readManagedUser(id) {
  if (!validId(id)) return fail(400, "Invalid user reference.");
  try {
    const user = await User.findOne({ _id: id, role: { $in: managedRoles } })
      .select(fields)
      .lean();
    return user
      ? { statusCode: 200, body: { user: publicManagedUser(user) } }
      : fail(404, "User not found.");
  } catch {
    return unavailable();
  }
}
export async function changeManagedUserStatus(id, body, actor) {
  if (!validId(id)) return fail(400, "Invalid user reference.");
  if (String(id) === String(actor))
    return fail(403, "You cannot change your own account status.");
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some(
      (key) =>
        !["accountStatus", "expectedStatus", "version", "reason"].includes(key),
    ) ||
    !["Active", "Inactive"].includes(body.accountStatus) ||
    !["Active", "Inactive"].includes(body.expectedStatus) ||
    body.accountStatus === body.expectedStatus ||
    !(
      body.version === null ||
      (typeof body.version === "string" &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(body.version) &&
        Number.isFinite(Date.parse(body.version)))
    )
  )
    return fail(400, "Invalid account status request.");
  let reason = "";
  if (body.accountStatus === "Inactive") {
    if (typeof body.reason !== "string")
      return fail(
        400,
        "A deactivation reason is required (maximum 500 characters).",
      );
    reason = body.reason
      .normalize("NFC")
      .replace(/[\p{Cc}\p{Cf}<>]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!reason || reason.length > 500 || body.reason.trim().length > 500)
      return fail(
        400,
        "A deactivation reason is required (maximum 500 characters).",
      );
  }
  let session;
  try {
    session = await mongoose.startSession();
    let updated;
    await session.withTransaction(
      async () => {
        const current = await User.findOne({
          _id: id,
          role: { $in: managedRoles },
        })
          .select(`${fields} registrationStatus`)
          .session(session)
          .lean();
        if (!current) throw new ManagementError(fail(404, "User not found."));
        if (
          current.accountStatus !== body.expectedStatus ||
          publicManagedUser(current).version !== body.version
        )
          throw new ManagementError(
            fail(
              409,
              "This account has changed. Refresh the user list before trying again.",
              "STATUS_CONFLICT",
            ),
          );
        // Activation is not registration approval. Pending/rejected accounts remain visible,
        // but cannot be activated through this workflow. Missing legacy state is normalized.
        if (
          body.accountStatus === "Active" &&
          current.registrationStatus != null &&
          current.registrationStatus !== "Approved"
        )
          throw new ManagementError(
            fail(
              409,
              "This account cannot be activated because its registration state is incompatible with sign-in.",
              "REGISTRATION_CONFLICT",
            ),
          );
        const set = {
          accountStatus: body.accountStatus,
          updatedAt: new Date(
            Math.max(
              Date.now(),
              new Date(current.updatedAt || 0).getTime() + 1,
            ),
          ),
        };
        if (
          body.accountStatus === "Active" &&
          current.registrationStatus == null
        )
          set.registrationStatus = "Approved";
        updated = await User.findOneAndUpdate(
          {
            _id: id,
            role: current.role,
            accountStatus: body.expectedStatus,
            updatedAt:
              current.updatedAt === undefined
                ? { $exists: false }
                : current.updatedAt,
            registrationStatus:
              current.registrationStatus === undefined
                ? { $exists: false }
                : current.registrationStatus,
          },
          { $set: set },
          { new: true, runValidators: true, timestamps: false, session },
        )
          .select(fields)
          .lean();
        if (!updated)
          throw new ManagementError(
            fail(
              409,
              "This account has changed. Refresh the user list before trying again.",
              "STATUS_CONFLICT",
            ),
          );
        await recordUserStatusAudit({
          user: updated,
          actor,
          previousStatus: current.accountStatus,
          previousRegistrationStatus: current.registrationStatus,
          normalizedRegistration: Boolean(set.registrationStatus),
          reason,
          session,
        });
      },
      {
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority" },
        maxCommitTimeMS: 30000,
      },
    );
    return {
      statusCode: 200,
      body: {
        message: `Account ${body.accountStatus === "Active" ? "activated" : "deactivated"} successfully.`,
        user: publicManagedUser(updated),
      },
    };
  } catch (error) {
    if (error.hasErrorLabel?.("UnknownTransactionCommitResult"))
      return fail(
        503,
        "Unable to confirm the status change. Refresh the user list before trying again.",
        "STATUS_CHANGE_UNCERTAIN",
      );
    return error instanceof ManagementError ? error.response : unavailable();
  } finally {
    if (session) await session.endSession().catch(() => {});
  }
}
