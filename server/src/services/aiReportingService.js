import { getDateRangeFilter } from "./calendarRangeService.js";
export { getDateRangeFilter } from "./calendarRangeService.js";
import Appointment from "../models/Appointment.js";
import User from "../models/User.js";

export const APPOINTMENT_STATUSES = [
  "Pending",
  "Awaiting Faculty Schedule",
  "Approved",
  "Rejected",
  "Needs Reschedule",
  "Rescheduled",
  "Completed",
  "No Show",
  "Cancelled",
];

export const CONSULTATION_MODES = ["Online", "Face-to-Face"];
export const DATE_RANGES = [
  "today",
  "this_week",
  "this_month",
  "this_year",
  "all_time",
];

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const inputError = (message) => {
  const error = new Error(message);
  error.code = "AI_TOOL_ARGUMENT_ERROR";
  return error;
};
export const toSafeFacultyList = (faculty) =>
  faculty.map(({ name, position }) => ({
    name,
    position: position || null,
  }));

const assertEnum = (value, allowed, label) => {
  if (value !== undefined && !allowed.includes(value))
    throw inputError(`Invalid ${label}.`);
};

const appointmentFilter = ({ status, mode, dateRange = "all_time" } = {}) => {
  assertEnum(status, APPOINTMENT_STATUSES, "appointment status");
  assertEnum(mode, CONSULTATION_MODES, "consultation mode");
  return {
    ...(status ? { status } : {}),
    ...(mode ? { consultationMode: mode } : {}),
    ...getDateRangeFilter(dateRange),
  };
};

const countsByField = async (field, match = {}) => {
  const rows = await Appointment.aggregate([
    { $match: match },
    { $group: { _id: `$${field}`, count: { $sum: 1 } } },
    { $sort: { count: -1, _id: 1 } },
  ]);
  return Object.fromEntries(
    rows.filter((row) => row._id).map((row) => [row._id, row.count]),
  );
};

export async function getUserCounts({
  role,
  accountStatus,
  registrationStatus,
} = {}) {
  assertEnum(role, ["student", "faculty", "dean"], "role");
  assertEnum(accountStatus, ["Active", "Inactive"], "account status");
  assertEnum(
    registrationStatus,
    ["Pending", "Approved", "Rejected"],
    "registration status",
  );
  const filter = {
    ...(role ? { role } : {}),
    ...(accountStatus ? { accountStatus } : {}),
    ...(registrationStatus ? { registrationStatus } : {}),
  };
  return {
    role: role || "all",
    accountStatus: accountStatus || "all",
    registrationStatus: registrationStatus || "all",
    count: await User.countDocuments(filter),
  };
}

export async function getFacultyCountByDesignation({ designation } = {}) {
  const value = String(designation || "").trim();
  if (!value || value.length > 100)
    throw inputError("A valid designation is required.");
  const count = await User.countDocuments({
    role: "faculty",
    position: { $regex: `^${escapeRegex(value)}$`, $options: "i" },
  });
  return { designation: value, count };
}

export async function getRegisteredFacultyList({
  designation,
  limit = 50,
} = {}) {
  const value = designation === undefined ? "" : String(designation).trim();
  if (value.length > 100) throw inputError("Invalid faculty designation.");
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 50);
  const filter = {
    role: "faculty",
    registrationStatus: "Approved",
    ...(value
      ? { position: { $regex: `^${escapeRegex(value)}$`, $options: "i" } }
      : {}),
  };
  const [total, faculty] = await Promise.all([
    User.countDocuments(filter),
    User.find(filter)
      .select("name position -_id")
      .sort({ name: 1 })
      .limit(safeLimit)
      .lean(),
  ]);
  return {
    registrationStatus: "Approved",
    designation: value || "all",
    total,
    shown: faculty.length,
    limited: total > faculty.length,
    faculty: toSafeFacultyList(faculty),
  };
}

export async function getFacultyDesignationBreakdown() {
  const rows = await User.aggregate([
    { $match: { role: "faculty", position: { $type: "string", $ne: "" } } },
    { $group: { _id: "$position", count: { $sum: 1 } } },
    { $sort: { count: -1, _id: 1 } },
  ]);
  return {
    designations: rows.map(({ _id, count }) => ({ designation: _id, count })),
  };
}

export async function getAppointmentCount(args = {}) {
  return {
    ...args,
    dateRange: args.dateRange || "all_time",
    count: await Appointment.countDocuments(appointmentFilter(args)),
  };
}

export async function getAppointmentStatusBreakdown({
  dateRange = "all_time",
} = {}) {
  return {
    dateRange,
    statuses: await countsByField("status", getDateRangeFilter(dateRange)),
  };
}

export async function getConsultationSummary({ dateRange = "all_time" } = {}) {
  const filter = getDateRangeFilter(dateRange);
  const [totalAppointments, statuses, modes] = await Promise.all([
    Appointment.countDocuments(filter),
    countsByField("status", filter),
    countsByField("consultationMode", filter),
  ]);
  return { dateRange, totalAppointments, statuses, modes };
}

export async function getRegistrationSummary() {
  const rows = await User.aggregate([
    {
      $facet: {
        roles: [{ $group: { _id: "$role", count: { $sum: 1 } } }],
        accounts: [{ $group: { _id: "$accountStatus", count: { $sum: 1 } } }],
        registrations: [
          { $group: { _id: "$registrationStatus", count: { $sum: 1 } } },
        ],
        total: [{ $count: "count" }],
      },
    },
  ]);
  const mapCounts = (items) =>
    Object.fromEntries(
      items.filter((item) => item._id).map((item) => [item._id, item.count]),
    );
  return {
    totalUsers: rows[0]?.total[0]?.count || 0,
    roles: mapCounts(rows[0]?.roles || []),
    accountStatuses: mapCounts(rows[0]?.accounts || []),
    registrationStatuses: mapCounts(rows[0]?.registrations || []),
  };
}

async function findFacultyMatches(facultyName) {
  const value = String(facultyName || "").trim();
  if (!value || value.length > 100)
    throw inputError("A valid faculty name is required.");
  const exact = await User.find({
    role: "faculty",
    name: { $regex: `^${escapeRegex(value)}$`, $options: "i" },
  })
    .select("name position")
    .lean();
  if (exact.length) return exact;
  return User.find({
    role: "faculty",
    name: { $regex: escapeRegex(value), $options: "i" },
  })
    .select("name position")
    .limit(10)
    .lean();
}

export async function getConsultationCountByFaculty({
  facultyName,
  dateRange = "all_time",
  status,
} = {}) {
  assertEnum(status, APPOINTMENT_STATUSES, "appointment status");
  const matches = await findFacultyMatches(facultyName);
  if (matches.length === 0)
    return { matchStatus: "not_found", facultyName, count: 0 };
  if (matches.length > 1)
    return {
      matchStatus: "multiple_matches",
      matches: matches.map(({ name, position }) => ({
        name,
        position: position || null,
      })),
    };
  const faculty = matches[0];
  const count = await Appointment.countDocuments({
    faculty: faculty._id,
    ...(status ? { status } : {}),
    ...getDateRangeFilter(dateRange),
  });
  return {
    matchStatus: "matched",
    faculty: { name: faculty.name, position: faculty.position || null },
    dateRange,
    status: status || "all",
    count,
  };
}

export async function getFacultyConsultationBreakdown({
  dateRange = "all_time",
  status,
  limit = 25,
} = {}) {
  assertEnum(status, APPOINTMENT_STATUSES, "appointment status");
  const safeLimit = Math.min(Math.max(Number(limit) || 25, 1), 50);
  const dateFilter = getDateRangeFilter(dateRange);
  const rows = await User.aggregate([
    { $match: { role: "faculty" } },
    {
      $lookup: {
        from: Appointment.collection.name,
        let: { facultyId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ["$faculty", "$$facultyId"] },
              ...(status ? { status } : {}),
              ...dateFilter,
            },
          },
          { $count: "count" },
        ],
        as: "consultations",
      },
    },
    {
      $project: {
        _id: 0,
        name: 1,
        position: 1,
        consultationCount: { $ifNull: [{ $first: "$consultations.count" }, 0] },
      },
    },
    { $sort: { consultationCount: -1, name: 1 } },
    { $limit: safeLimit },
  ]);
  return { dateRange, status: status || "all", faculty: rows };
}

export async function getSystemOverview() {
  const [registration, consultation] = await Promise.all([
    getRegistrationSummary(),
    getConsultationSummary({ dateRange: "all_time" }),
  ]);
  return { registration, consultation };
}

export const reportingTools = Object.freeze({
  getUserCounts,
  getFacultyCountByDesignation,
  getRegisteredFacultyList,
  getFacultyDesignationBreakdown,
  getAppointmentCount,
  getAppointmentStatusBreakdown,
  getConsultationSummary,
  getRegistrationSummary,
  getConsultationCountByFaculty,
  getFacultyConsultationBreakdown,
  getSystemOverview,
});
