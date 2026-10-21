import PDFDocument from "pdfkit";
import { fileURLToPath } from "node:url";

export const FACULTY_PDF_MAX_BYTES = 8 * 1024 * 1024;
const font = fileURLToPath(new URL("../assets/fonts/NotoSans-Regular.ttf", import.meta.url));
const display = value => value && Number.isFinite(+new Date(value)) ? new Date(value).toLocaleString("en-PH", { timeZone: "Asia/Manila", year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) : "Not scheduled";

export async function generateFacultyReportPdf(report, maxBytes = FACULTY_PDF_MAX_BYTES) {
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 32, bufferPages: true, font, info: { Title: report.title, Author: report.facultyName, CreationDate: report.generatedAt } });
  const output = new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    doc.on("data", chunk => { size += chunk.length; if (size > maxBytes) doc.destroy(Object.assign(new Error("PDF limit exceeded."), { statusCode: 413 })); else chunks.push(chunk); });
    doc.on("error", reject); doc.on("end", () => resolve(Buffer.concat(chunks)));
  });
  try {
    doc.fontSize(18).text(report.title).fontSize(11).text(`Faculty: ${report.facultyName}`);
    doc.fontSize(9).text(`Covered date range: ${report.filters.startDate} to ${report.filters.endDate} (Asia/Manila scheduled date)`);
    doc.text(`Generated: ${display(report.generatedAt)} Asia/Manila`);
    doc.text(`Filters — Appointment status: ${report.filters.status || "All"} | Attendance outcome: ${report.filters.attendanceOutcome || "All"} | Mode: ${report.filters.mode || "All"}`);
    doc.moveDown(0.4).fontSize(11).text(`Total consultation records: ${report.summary.total}`);
    doc.fontSize(8.5).text(`Appointment Status: ${Object.entries(report.summary.status).map(([key, count]) => `${key}: ${count}`).join(" | ")}`, { width: 777 });
    doc.text(`Attendance Outcome: ${Object.entries(report.summary.attendance).map(([key, count]) => `${key}: ${count}`).join(" | ")}`, { width: 777 });
    doc.moveDown(0.4).fontSize(8).text("Appointment status and final attendance outcome are separate workflow concepts. This report contains deterministic authorized record data.", { width: 777 });
    let y = doc.y + 12;
    const widths = [27, 90, 115, 104, 70, 100, 100, 171];
    const headers = ["#", "Date", "Student / ID", "Subject / Course", "Mode", "Appointment Status", "Attendance Outcome", "Concern"];
    const cell = (value, x, top, width, height) => doc.fontSize(7.5).text(String(value), x + 3, top + 4, { width: width - 6, height: height - 8, ellipsis: true });
    const heading = () => { let x = 32; doc.rect(32, y, 777, 28).fill("#eeeeee").fillColor("black"); headers.forEach((value, index) => { cell(value, x, y, widths[index], 28); x += widths[index]; }); y += 28; };
    if (y > 475) { doc.addPage(); y = 32; }
    heading();
    report.records.forEach((row, index) => {
      const values = [index + 1, display(row.startAt), `${row.student}\n${row.institutionalId}`, row.subject, row.mode, row.status, row.attendanceOutcome, row.concern];
      const height = Math.min(76, Math.max(38, ...values.map((value, column) => doc.fontSize(7.5).heightOfString(String(value), { width: widths[column] - 6 }) + 10)));
      if (y + height > 540) { doc.addPage(); y = 32; heading(); }
      let x = 32; values.forEach((value, column) => { cell(value, x, y, widths[column], height); x += widths[column]; });
      y += height; doc.moveTo(32, y).lineTo(809, y).strokeColor("#dddddd").stroke().strokeColor("black");
    });
    const { count } = doc.bufferedPageRange();
    for (let page = 0; page < count; page++) { doc.switchToPage(page); doc.fontSize(8).text(`SOCConsult | Personal Faculty consultation report | Asia/Manila | Page ${page + 1} of ${count}`, 32, 555, { width: 777, lineBreak: false }); }
    doc.end();
  } catch (error) { doc.destroy(error); }
  return output;
}
