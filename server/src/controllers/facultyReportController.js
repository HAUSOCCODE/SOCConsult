import { createFacultyReport } from "../services/facultyReportService.js";

export async function postFacultyReport(req, res) {
  res.set("Cache-Control", "no-store");
  try {
    if (Object.keys(req.query).length) return res.status(400).json({ message: "Invalid report filters." });
    const report = await createFacultyReport(req.body, req.user);
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${report.filename}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Report-Total": String(report.total),
      "Access-Control-Expose-Headers": "Content-Disposition, X-Report-Total",
    }).send(report.bytes);
  } catch (error) {
    const status = [400, 403, 404, 413].includes(error.statusCode) ? error.statusCode : 503;
    const messages = {
      400: "Invalid report filters. Select valid dates within 366 days.",
      403: "Personal Faculty report access is unavailable.",
      404: "No consultation records match the selected report filters.",
      413: "Report exceeds safety limits. Narrow the selected filters.",
      503: "Report generation is temporarily unavailable. Please try again.",
    };
    res.status(status).json({ message: messages[status] });
  }
}
