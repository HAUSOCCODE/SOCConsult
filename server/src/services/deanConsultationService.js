import mongoose from "mongoose";
import Appointment from "../models/Appointment.js";
import User from "../models/User.js";
import SupportingDocument from "../models/SupportingDocument.js";
import { APPOINTMENT_STATUSES, LEGACY_APPOINTMENT_STATUSES } from "../config/appointmentStatus.js";
import { formatFullName } from "./personNameService.js";
import { safeReason } from "./appointmentHistoryService.js";

// Deployment boundary: this database contains authorized School of Computing records only.
// Multi-school isolation requires an authoritative scope field; program/department are not one.
export const validRecordId = value => typeof value === "string" && /^[a-f\d]{24}$/i.test(value);
const invalid = () => { throw Object.assign(new Error("Invalid consultation filters or reference."), { statusCode: 400 }); };
const statuses = [...APPOINTMENT_STATUSES, ...LEGACY_APPOINTMENT_STATUSES];
const literal = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const text = (value, max = 150) => {
  if (typeof value !== "string" || value.length > max || /[\x00-\x1f\x7f]/.test(value)) invalid();
  return value.normalize("NFC").trim();
};
const integer = (value, fallback, max) => {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(+value) || +value > max) invalid();
  return +value;
};
export function parseConsultationQuery(query = {}) {
  const allowed = ["search", "start", "end", "facultyId", "studentId", "status", "mode", "page", "limit", "sort"];
  if (Object.keys(query).some(key => !allowed.includes(key))) invalid();
  const filter = {}, filters = {};
  for (const key of Object.keys(query)) if (typeof query[key] !== "string") invalid();
  for (const key of ["facultyId", "studentId"]) {
    if (query[key] !== undefined) {
      if (!validRecordId(query[key])) invalid();
      filter[key === "facultyId" ? "faculty" : "student"] = new mongoose.Types.ObjectId(query[key]);
      filters[key] = query[key];
    }
  }
  for (const [key, values, field] of [["status", statuses, "status"], ["mode", ["Online", "Face-to-Face"], "consultationMode"]]) {
    if (query[key] !== undefined) {
      if (!values.includes(query[key])) invalid();
      filter[field] = filters[key] = query[key];
    }
  }
  if (query.start !== undefined || query.end !== undefined) {
    const parse = value => {
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid();
      const n = Date.parse(`${value}T00:00:00Z`);
      if (!Number.isFinite(n) || new Date(n).toISOString().slice(0, 10) !== value) invalid();
      return n;
    };
    const start = parse(query.start), end = parse(query.end);
    if (end < start || (end - start) / 86400000 + 1 > 366) invalid();
    filter.createdAt = { $gte: new Date(start - 28800000), $lt: new Date(end + 86400000 - 28800000) };
    filters.start = query.start; filters.end = query.end;
  }
  const sort = query.sort ?? "newest";
  if (!["newest", "oldest"].includes(sort)) invalid();
  const search = query.search === undefined ? "" : text(query.search);
  return { filter, filters: { ...filters, search, sort }, search, page: integer(query.page, 1, 1000000), limit: integer(query.limit, 20, 100), sort: { createdAt: sort === "newest" ? -1 : 1, _id: sort === "newest" ? -1 : 1 } };
}
const names = "name firstName middleName lastName";
const projection = "student faculty subject startAt endAt consultationMode status createdAt updatedAt";
const populate = { path: "student faculty", select: names, options: { maxTimeMS: 10000 } };
const displayName = user => user && typeof user === "object" && user.name ? formatFullName(user) : null;
export const listRecord = row => ({
  recordId: String(row._id), studentName: displayName(row.student), facultyName: displayName(row.faculty),
  subject: row.subject, startAt: row.startAt ?? null, endAt: row.endAt ?? null,
  mode: row.consultationMode ?? null, status: row.status, legacy: LEGACY_APPOINTMENT_STATUSES.includes(row.status),
  createdAt: row.createdAt, updatedAt: row.updatedAt,
});
export async function listConsultations(query) {
  const parsed = parseConsultationQuery(query);
  // Name matching stays in MongoDB, avoiding an unbounded participant-ID array.
  const pipeline = [{ $match: parsed.filter }];
  if (parsed.search) {
    pipeline.push(...["student", "faculty"].map(field => ({ $lookup: {
      from: User.collection.name, localField: field, foreignField: "_id", as: `${field}Search`,
      pipeline: [{ $project: { name: 1, firstName: 1, middleName: 1, lastName: 1 } }],
    } })));
    const regex = { $regex: literal(parsed.search), $options: "i" };
    pipeline.push({ $match: { $or: [
      { subject: regex }, ...["studentSearch", "facultySearch"].map(field => ({ [`${field}.name`]: regex })),
      ...(validRecordId(parsed.search) ? [{ _id: new mongoose.Types.ObjectId(parsed.search) }] : []),
    ] } });
  }
  pipeline.push({ $facet: {
    count: [{ $count: "total" }],
    records: [{ $sort: parsed.sort }, { $skip: (parsed.page - 1) * parsed.limit }, { $limit: parsed.limit },
      { $project: Object.fromEntries(projection.split(" ").map(key => [key, 1])) }],
  } });
  const [result] = await Appointment.aggregate(pipeline).option({ maxTimeMS: 10000 });
  const rows = await Appointment.populate(result?.records || [], populate);
  const total = result?.count?.[0]?.total || 0;
  return { consultations: rows.map(listRecord), pagination: { page: parsed.page, limit: parsed.limit, total, totalPages: Math.ceil(total / parsed.limit) },
    filters: parsed.filters, capabilities: { attendanceOutcome: false, dateBasis: "createdAt", timezone: "Asia/Manila" } };
}
const safeLocation = (mode, location) => mode === "Face-to-Face" && typeof location === "string" ? location.replace(/https?:\/\/\S+/gi, "[link removed]") : null;
const snapshot = value => value ? { startAt: value.startAt ?? null, endAt: value.endAt ?? null, mode: value.mode ?? null, location: safeLocation(value.mode, value.location) } : null;
export async function consultationDetails(id) {
  if (!validRecordId(id)) invalid();
  const row = await Appointment.findById(id).select(`${projection} reason bookingMethod location proposedStartAt proposedEndAt proposedConsultationMode proposedLocation scheduleHistory statusHistory supportingDocuments supportingDocument.name supportingDocument.mimeType supportingDocument.size`)
    .populate(populate).maxTimeMS(10000).lean();
  if (!row) throw Object.assign(new Error("Consultation not found."), { statusCode: 404 });
  const documents = [];
  for (const entry of row.supportingDocuments || []) {
    if (entry?.originalName && validRecordId(String(entry._id))) documents.push({ documentId: String(entry._id), name: entry.originalName, mimeType: entry.mimeType, size: entry.size });
    else if (validRecordId(String(entry))) {
      const legacy = await SupportingDocument.findOne({ _id: entry, appointment: id }).select("originalName mimeType size").maxTimeMS(10000).lean();
      if (legacy) documents.push({ documentId: String(legacy._id), name: legacy.originalName, mimeType: legacy.mimeType, size: legacy.size });
    }
  }
  if (row.supportingDocument?.name) documents.push({ documentId: null, name: row.supportingDocument.name, mimeType: row.supportingDocument.mimeType, size: row.supportingDocument.size });
  const history = [...(row.statusHistory || [])].sort((a, b) => new Date(a.changedAt) - new Date(b.changedAt)).map(entry => {
    let reason = ""; try { reason = safeReason(entry.reason || ""); } catch { /* malformed historical text is omitted */ }
    return { from: entry.previousStatus, to: entry.newStatus,
      actorRole: ["Student", "Faculty", "Dean", "System"].includes(entry.changedByRole) ? entry.changedByRole : "Unknown",
      actorType: entry.actorType === "system" ? "system" : "user", timestamp: entry.changedAt, reason,
      source: entry.migrationVersion || /migration/i.test(entry.source || "") ? "Legacy migration" : ["request", "confirm", "reject", "propose", "accept_proposal", "reject_proposal", "cancel", "expire"].includes(entry.source) ? entry.source : "Legacy record" };
  });
  const accepted = (row.scheduleHistory || []).filter(entry => entry.response === "Accepted").sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  return { consultation: { ...listRecord(row), concern: row.reason, bookingMethod: row.bookingMethod,
    originalSchedule: accepted.length ? snapshot(accepted[0].previous) : null,
    currentSchedule: row.startAt ? snapshot({ startAt: row.startAt, endAt: row.endAt, mode: row.consultationMode, location: row.location }) : null,
    proposedSchedule: row.status === "Reschedule Proposed" && row.proposedStartAt ? snapshot({ startAt: row.proposedStartAt, endAt: row.proposedEndAt, mode: row.proposedConsultationMode, location: row.proposedLocation }) : null,
    statusHistory: history, documents } };
}
export async function consultationFilterOptions(query = {}) {
  if (Object.keys(query).some(key => !["role", "search", "limit"].includes(key)) || !["student", "faculty"].includes(query.role)) invalid();
  const search = query.search === undefined ? "" : text(query.search, 100), limit = integer(query.limit, 20, 50);
  const field = query.role === "student" ? "student" : "faculty";
  const users = await User.aggregate([
    { $match: { role: query.role === "student" ? "student" : { $in: ["faculty", "dean"] }, ...(search && { name: { $regex: literal(search), $options: "i" } }) } },
    { $lookup: { from: Appointment.collection.name, localField: "_id", foreignField: field, as: "participation", pipeline: [{ $limit: 1 }, { $project: { _id: 1 } }] } },
    { $match: { "participation.0": { $exists: true } } }, { $sort: { name: 1, _id: 1 } }, { $limit: limit + 1 },
    { $project: { name: 1, firstName: 1, middleName: 1, lastName: 1, role: 1 } },
  ]).option({ maxTimeMS: 10000 });
  return { options: users.slice(0, limit).map(user => ({ userId: String(user._id), name: formatFullName(user), role: user.role })), hasMore: users.length > limit };
}
