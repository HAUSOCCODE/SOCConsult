import { createDeanReport } from "../services/deanReportService.js";

export async function postDeanReport(req, res) {
  try {
    if (Object.keys(req.query).length)
      return res.status(400).json({ message: "Invalid report filters." });
    const report = await createDeanReport(req.body, req.user);
    res
      .set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${report.filename}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Report-Total": String(report.total),
        "Access-Control-Expose-Headers": "Content-Disposition, X-Report-Total",
      })
      .send(report.bytes);
  } catch (error) {
    const status = [400, 403, 413].includes(error.statusCode)
      ? error.statusCode
      : 503;
    res
      .status(status)
      .json({
        message:
          status === 400
            ? "Invalid report filters. Select valid dates within 366 days."
            : status === 403
              ? "Active Dean access required."
              : status === 413
                ? "Report exceeds safety limits. Narrow the selected filters."
                : "Report generation is temporarily unavailable. Please try again.",
      });
  }
}
