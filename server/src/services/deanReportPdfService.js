import PDFDocument from "pdfkit";
import { fileURLToPath } from "node:url";

export const PDF_LIMIT = 8 * 1024 * 1024;
const font = fileURLToPath(
  new URL("../assets/fonts/NotoSans-Regular.ttf", import.meta.url),
);
const date = (value) =>
  value && Number.isFinite(+new Date(value))
    ? new Date(value).toLocaleString("en-PH", {
        timeZone: "Asia/Manila",
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : "Not scheduled";
export async function generateReportPdf(report, maxBytes = PDF_LIMIT) {
  const doc = new PDFDocument({
    size: "A4",
    layout: "landscape",
    margin: 32,
    bufferPages: true,
    font,
    info: {
      Title: "SOC Consultation Report",
      Author: "School of Computing",
      CreationDate: report.generatedAt,
    },
  });
  const output = new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    doc.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes)
        doc.destroy(
          Object.assign(new Error("PDF limit exceeded."), { statusCode: 413 }),
        );
      else chunks.push(chunk);
    });
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });
  try {
    doc.fontSize(18).text("SOC Consultation Report");
    doc.fontSize(12).text("School of Computing");
    doc
      .moveDown(0.4)
      .fontSize(9)
      .text(
        `Request date: ${report.filters.start} to ${report.filters.end} | Asia/Manila (createdAt)`,
      );
    doc.text(`Generated: ${date(report.generatedAt)} Asia/Manila`);
    doc.text(
      `Faculty: ${report.filters.facultyId ? "Selected faculty" : "All faculty"} | Status: ${report.filters.status || "All"} | Attendance: ${report.filters.attendanceOutcome || "All"} | Mode: ${report.filters.mode || "All"}`,
    );
    doc
      .moveDown(0.4)
      .fontSize(11)
      .text(`Total consultations: ${report.summary.total}`);
    for (const [label, counts] of [
      ["Status", report.summary.status],
      ["Attendance outcome / classification", report.summary.attendance],
      ["Mode", report.summary.mode],
    ]) {
      doc.fontSize(9).text(
        `${label}: ${Object.entries(counts)
          .map(([key, count]) => `${key}: ${count}`)
          .join(" | ")}`,
        { width: 777 },
      );
      doc.moveDown(0.3);
    }
    doc
      .fontSize(8)
      .text(
        "Completed status means workflow finalization, not proof of attendance. Historical records remain unverified. Counts describe records; they are not Faculty rankings or disciplinary findings.",
        { width: 777 },
      );
    let y = doc.y + 14;
    const widths = [24, 80, 100, 100, 105, 65, 103, 100];
    const headers = [
      "#",
      "Request date",
      "Student",
      "Faculty",
      "Scheduled time",
      "Mode",
      "Status",
      "Attendance",
    ];
    const cell = (value, x, top, width, height) =>
      doc
        .fontSize(8)
        .text(String(value), x + 3, top + 4, {
          width: width - 6,
          height: height - 8,
          ellipsis: true,
        });
    const heading = () => {
      let x = 32;
      doc.rect(32, y, 777, 30).fill("#eeeeee").fillColor("black");
      headers.forEach((value, i) => {
        cell(value, x, y, widths[i], 30);
        x += widths[i];
      });
      y += 30;
    };
    if (y > 450) {
      doc.addPage();
      y = 32;
    }
    heading();
    if (!report.records.length)
      doc
        .fontSize(10)
        .text("No consultations match the selected filters.", 36, y + 12);
    report.records.forEach((row, index) => {
      const values = [
        index + 1,
        date(row.createdAt),
        row.student,
        row.faculty,
        row.startAt
          ? `${date(row.startAt)}\nEnd: ${date(row.endAt)}`
          : "Not scheduled",
        row.mode,
        row.status,
        row.attendance,
      ];
      const height = Math.max(
        42,
        ...values.map(
          (value, i) =>
            doc
              .fontSize(8)
              .heightOfString(String(value), { width: widths[i] - 6 }) + 12,
        ),
      );
      if (y + height > 540) {
        doc.addPage();
        y = 32;
        heading();
      }
      let x = 32;
      values.forEach((value, i) => {
        cell(value, x, y, widths[i], height);
        x += widths[i];
      });
      y += height;
      doc
        .moveTo(32, y)
        .lineTo(809, y)
        .strokeColor("#dddddd")
        .stroke()
        .strokeColor("black");
    });
    const { count } = doc.bufferedPageRange();
    for (let page = 0; page < count; page++) {
      doc.switchToPage(page);
      doc
        .fontSize(8)
        .text(
          `School of Computing | Administrative reference | Asia/Manila | Page ${page + 1} of ${count}`,
          32,
          555,
          { width: 777, lineBreak: false },
        );
    }
    doc.end();
  } catch (error) {
    doc.destroy(error);
  }
  return output;
}
