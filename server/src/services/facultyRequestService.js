import mongoose from "mongoose";
import Appointment from "../models/Appointment.js";
import SupportingDocument from "../models/SupportingDocument.js";

export const REQUEST_FILTERS = ["Pending", "Reschedule Proposed", "Confirmed", "Rejected", "Cancelled", "Expired", "All"];
export const validRequestId = id => typeof id === "string" && /^[a-f\d]{24}$/i.test(id);
const fail = statusCode => { throw Object.assign(new Error("Request not found or unavailable."), { statusCode }); };
export function parseRequestQuery(input = {}) {
  if (Object.keys(input).some(key => !["status", "page"].includes(key))) fail(400);
  const status = input.status ?? "Pending", page = input.page ?? "1";
  if (!REQUEST_FILTERS.includes(status) || typeof page !== "string" || !/^[1-9]\d*$/.test(page) || !Number.isSafeInteger(+page) || +page > 10000) fail(400);
  return { status, page: +page };
}
const fields = "student subject reason startAt endAt consultationMode createdAt status bookingMethod estimatedDurationMinutes __v supportingDocument.name supportingDocument.mimeType supportingDocument.size supportingDocuments";
const person = { path: "student", select: "name", options: { maxTimeMS: 10000 } };
const safeDate = value => value && Number.isFinite(new Date(value).getTime()) ? value : null;
export function requestRecord(row, detail = false) {
  return {
    _id: String(row._id), student: { name: typeof row.student?.name === "string" ? row.student.name : "Student unavailable" },
    subject: row.subject, reason: detail ? row.reason : (row.reason || "").slice(0, 180),
    startAt: safeDate(row.startAt), endAt: safeDate(row.endAt), consultationMode: row.consultationMode ?? null,
    createdAt: row.createdAt, status: row.status, bookingMethod: row.bookingMethod,
    estimatedDurationMinutes: row.estimatedDurationMinutes, __v: row.__v,
    hasSupportingDocuments: Boolean(row.hasSupportingDocuments || row.supportingDocument?.name || row.supportingDocuments?.length),
  };
}
export async function listFacultyRequests({ faculty, input }) {
  const { status, page } = parseRequestQuery(input);
  const match = { faculty: new mongoose.Types.ObjectId(faculty), ...(status !== "All" && { status }) };
  const projection = Object.fromEntries(fields.split(" ").map(key => [key, 1]));
  for (const key of ["supportingDocuments", "supportingDocument.name", "supportingDocument.mimeType", "supportingDocument.size"]) delete projection[key];
  projection.hasSupportingDocuments = { $or: [
    { $gt: [{ $size: { $ifNull: ["$supportingDocuments", []] } }, 0] },
    { $ne: [{ $ifNull: ["$supportingDocument.name", null] }, null] },
  ] };
  // No status normalization or date-based transitions are performed by reads.
  const pipeline = [{ $match: match }, { $facet: {
    count: [{ $count: "total" }],
    records: [
      ...(status === "Pending" ? [{ $set: {
        requestUnscheduled: { $cond: [{ $eq: [{ $type: "$startAt" }, "date"] }, 0, 1] },
        requestStartSort: { $cond: [{ $eq: [{ $type: "$startAt" }, "date"] }, "$startAt", null] },
      } }] : []),
      { $sort: status === "Pending" ? { requestUnscheduled: 1, requestStartSort: 1, _id: 1 } : { createdAt: -1, _id: -1 } },
      { $skip: (page - 1) * 20 }, { $limit: 20 }, { $project: projection },
    ],
  } }];
  const [result] = await Appointment.aggregate(pipeline).option({ maxTimeMS: 10000 });
  const rows = await Appointment.populate(result?.records || [], person);
  const total = result?.count?.[0]?.total || 0;
  return { requests: rows.map(row => requestRecord(row)), pagination: { page, limit: 20, total, totalPages: Math.ceil(total / 20) }, filters: { status } };
}
export async function facultyRequestDetails({ faculty, id, input = {} }) {
  if (Object.keys(input).length) fail(400);
  if (!validRequestId(id)) fail(404);
  const row = await Appointment.findOne({ _id: id, faculty }).select(fields).populate(person).maxTimeMS(10000).lean();
  if (!row) fail(404);
  const documents = [];
  for (const entry of row.supportingDocuments || []) {
    if (entry?.originalName && validRequestId(String(entry._id))) documents.push({ _id: String(entry._id), originalName: entry.originalName, mimeType: entry.mimeType, size: entry.size });
    else if (validRequestId(String(entry))) {
      const legacy = await SupportingDocument.findOne({ _id: entry, appointment: id }).select("originalName mimeType size").maxTimeMS(10000).lean();
      if (legacy) documents.push({ _id: String(legacy._id), originalName: legacy.originalName, mimeType: legacy.mimeType, size: legacy.size });
    }
  }
  return { appointment: { ...requestRecord(row, true), supportingDocuments: documents,
    ...(row.supportingDocument?.name && { supportingDocument: { name: row.supportingDocument.name, mimeType: row.supportingDocument.mimeType, size: row.supportingDocument.size } }),
  } };
}
