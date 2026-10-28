import { createEventNotification } from "./notificationService.js";
import mongoose from "mongoose";
import Appointment from "../models/Appointment.js";
import User from "../models/User.js";
import ReportExport from "../models/ReportExport.js";
import { recordReportExportAudit } from "./activityService.js";
import { generateReportPdf } from "./deanReportPdfService.js";
import { loadReportData, buildReport } from "./deanReportDataService.js";
export { parseReportFilters, buildReport, safeParticipant, REPORT_LIMIT } from "./deanReportDataService.js";
const fail = (statusCode) => { throw Object.assign(new Error("Report unavailable."), { statusCode }); };
export async function createDeanReport(input, actor) {
  if (actor?.role !== "dean" || actor.accountStatus !== "Active") fail(403);
  const { rows, filters } = await loadReportData(input, actor, true);
  const populated = await Appointment.populate(rows, {
    path: "student faculty",
    select: "name firstName middleName lastName -_id",
    options: { maxTimeMS: 10000 },
  });
  const generatedAt = new Date(),
    report = buildReport(populated, filters, generatedAt);
  const bytes = await generateReportPdf(report);
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const dean = await User.findById(actor.id || actor._id)
        .select("role accountStatus")
        .session(session);
      if (dean?.role !== "dean" || dean.accountStatus !== "Active") fail(403);
      const [metadata] = await ReportExport.create(
        [
          {
            dean: dean._id || actor.id,
            reportType: "soc_consultations_pdf",
            generatedAt,
            dateBasis: "createdAt",
            timezone: "Asia/Manila",
            filters,
            summary: report.summary,
          },
        ],
        { session },
      );
      await createEventNotification({ recipient: dean._id || actor.id, event: "report_generated", relatedEntityId: metadata._id, actionUrl: "/dean/reports", key: String(metadata._id), session });
      await recordReportExportAudit({
        actor: dean._id || actor.id,
        report: metadata,
        summary: report.summary,
        session,
      });
    });
  } finally {
    await session.endSession();
  }
  return {
    bytes,
    total: report.summary.total,
    filename: `SOCConsult_Report_${filters.start}_${filters.end}.pdf`,
  };
}
