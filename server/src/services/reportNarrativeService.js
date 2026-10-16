import mongoose from "mongoose";
import User from "../models/User.js";
import AuditLog from "../models/AuditLog.js";
import ReportNarrative from "../models/ReportNarrative.js";
import ReportNarrativeReview from "../models/ReportNarrativeReview.js";
import { loadReportData } from "./deanReportDataService.js";
import { generateNarrative } from "./reportNarrativeAdapter.js";

export const DISCLAIMER = "This narrative was generated from authorized aggregate SOCConsult data. It must be reviewed by the Dean before inclusion in an official report.";
const fail = (statusCode) => { throw Object.assign(new Error("Narrative unavailable."), { statusCode }); };
const authorize = (actor) => { if (actor?.role !== "dean" || actor.accountStatus !== "Active") fail(403); };
const validId = (id) => { if (typeof id !== "string" || !/^[a-f\d]{24}$/i.test(id)) fail(400); };
export function aggregateSnapshot(filters, summary) {
  return { dateRange: { start: filters.start, end: filters.end }, totalConsultations: summary.total, statusCounts: { ...summary.status }, attendanceOutcomeCounts: { ...summary.attendance }, consultationModeCounts: { ...summary.mode } };
}
async function transaction(actor, work) {
  authorize(actor);
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(async () => {
      const dean = await User.findById(actor.id || actor._id).select("role accountStatus").session(session);
      authorize(dean);
      return work(session, dean._id);
    });
  } finally { await session.endSession(); }
}
async function audit(action, actor, summary, session, timestamp) {
  await AuditLog.create([{ subjectUser: actor, subjectRole: "dean", actorUser: actor, actorRole: "dean", actor, action, category: "Consultation", description: action === "report_narrative_generated" ? "AI-assisted report narrative generated" : "AI-assisted report narrative reviewed", relatedEntityType: "ReportNarrative", relatedEntityId: summary, metadata: { timestamp } }], { session });
}
function response(summary, review = null) {
  const value = summary.toObject ? summary.toObject({ flattenMaps: true }) : summary;
  return { id: String(value._id), filters: value.filters, snapshot: value.snapshot, narrative: value.narrative, generatedAt: value.generatedAt, reviewState: review ? "reviewed" : "unreviewed", reviewedAt: review?.reviewedAt || null, version: review ? 2 : 1, disclaimer: DISCLAIMER };
}
export async function createNarrative(input, actor, adapter = generateNarrative) {
  authorize(actor);
  const { filters, summary } = await loadReportData(input, actor);
  const snapshot = aggregateSnapshot(filters, summary);
  const narrative = await adapter(snapshot), generatedAt = new Date();
  return transaction(actor, async (session, dean) => {
    const [record] = await ReportNarrative.create([{ dean, filters, snapshot, narrative, generatedAt }], { session });
    await audit("report_narrative_generated", dean, record._id, session, generatedAt);
    return response(record);
  });
}
export async function readNarrative(id, actor) {
  authorize(actor); validId(id);
  const summary = await ReportNarrative.findById(id);
  if (!summary) fail(404);
  const review = await ReportNarrativeReview.findOne({ summary: id });
  return response(summary, review);
}
export async function reviewNarrative(id, input, actor) {
  authorize(actor); validId(id);
  if (!input || Array.isArray(input) || Object.keys(input).length !== 1 || !Object.hasOwn(input, "expectedVersion") || !Number.isInteger(input.expectedVersion)) fail(400);
  if (input.expectedVersion !== 1) fail(409);
  try {
    return await transaction(actor, async (session, dean) => {
      const record = await ReportNarrative.findById(id).session(session);
      if (!record) fail(404);
      if (await ReportNarrativeReview.findOne({ summary: id }).session(session)) fail(409);
      const reviewedAt = new Date();
      const [review] = await ReportNarrativeReview.create([{ summary: id, dean, expectedVersion: 1, reviewedAt }], { session });
      await audit("report_narrative_reviewed", dean, record._id, session, reviewedAt);
      return response(record, review);
    });
  } catch (error) { if (error?.code === 11000) fail(409); throw error; }
}
