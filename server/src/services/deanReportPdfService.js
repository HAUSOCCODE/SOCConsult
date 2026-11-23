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
    const left = 32;
    const width = doc.page.width - 64;
    const bottom = doc.page.height - 56;
    const maroon = "#741F35", ink = "#243244", muted = "#566273";
    let y = 32;
    const text = (value, x, top, w, size = 9, color = ink, align = "left") => {
      doc.fontSize(size).fillColor(color).text(String(value), x, top, {
        width: w, align, lineGap: 2,
      });
      return doc.y;
    };
    const rule = (top) => doc.moveTo(left, top).lineTo(left + width, top)
      .lineWidth(0.6).strokeColor("#DDE2E8").stroke();
    const newPage = () => {
      doc.addPage();
      text("School of Computing  /  Consultation Report", left, 24, width, 10, maroon);
      rule(45);
      y = 57;
    };
    const section = (title, required = 64) => {
      if (y + required > bottom) newPage();
      y = text(title, left, y, width, 12, maroon) + 8;
    };
    // Use the same measured font and width for drawing and pagination. Nothing is ellipsized.
    const wrap = (value, w, size) => {
      doc.fontSize(size);
      const lines = [];
      for (const paragraph of String(value).split("\n")) {
        let line = "";
        for (const word of paragraph.split(/\s+/)) {
          const candidate = line ? `${line} ${word}` : word;
          if (doc.widthOfString(candidate) <= w) { line = candidate; continue; }
          if (line) lines.push(line);
          line = "";
          for (const char of word) {
            if (line && doc.widthOfString(line + char) > w) { lines.push(line); line = ""; }
            line += char;
          }
        }
        lines.push(line);
      }
      return lines;
    };
    const table = (headers, rows, widths, { x = left, top = y, size = 8.5, padding = 12 } = {}) => {
      let cursor = top;
      const tableWidth = widths.reduce((sum, item) => sum + item, 0);
      const lineHeight = size + 4;
      const draw = (cells, height, header, stripe) => {
        doc.rect(x, cursor, tableWidth, height).fill(header ? maroon : stripe ? "#F5F6F8" : "#FFFFFF");
        let column = x;
        cells.forEach((lines, i) => {
          lines.forEach((line, n) => text(line, column + 7, cursor + padding / 2 + n * lineHeight,
            widths[i] - 14, size, header ? "#FFFFFF" : ink, i === widths.length - 1 && headers.length === 2 ? "right" : "left"));
          column += widths[i];
        });
        cursor += height;
        doc.moveTo(x, cursor).lineTo(x + tableWidth, cursor).lineWidth(0.4).strokeColor("#DDE2E8").stroke();
      };
      const headerCells = headers.map((value, i) => wrap(value, widths[i] - 14, size));
      const headerHeight = Math.max(...headerCells.map(lines => lines.length)) * lineHeight + padding;
      let headerBottom;
      const heading = () => { draw(headerCells, headerHeight, true, false); headerBottom = cursor; };
      heading();
      rows.forEach((values, index) => {
        let cells = values.map((value, i) => wrap(value, widths[i] - 14, size));
        let remaining = Math.max(...cells.map(lines => lines.length));
        const fullHeight = remaining * lineHeight + padding;
        // Keep normal rows together; exceptionally tall rows continue without dropping text.
        if (cursor + fullHeight > bottom && (cursor > headerBottom || fullHeight <= bottom - 57 - headerHeight)) {
          newPage(); cursor = y; heading();
        }
        while (remaining > 0) {
          let capacity = Math.floor((bottom - cursor - padding) / lineHeight);
          if (capacity < 1) { newPage(); cursor = y; heading(); capacity = Math.floor((bottom - cursor - padding) / lineHeight); }
          const take = Math.min(remaining, capacity);
          draw(cells.map(lines => lines.slice(0, take)), take * lineHeight + padding, false, index % 2 === 1);
          cells = cells.map(lines => lines.slice(take));
          remaining -= take;
        }
      });
      return cursor;
    };

    doc.rect(left, y, 4, 44).fill(maroon);
    text("SCHOOL OF COMPUTING", left + 16, y, width - 16, 10, maroon);
    y = text("SOC Consultation Report", left + 16, y + 17, width - 16, 21, ink) + 8;
    y = text(`Reporting period: ${report.filters.start} to ${report.filters.end} | Request creation dates (createdAt), inclusive`, left, y, width, 11) + 3;
    y = text(`Generated: ${date(report.generatedAt)} Asia/Manila | Administrative reference`, left, y, width, 8.5, muted) + 6;
    // Participant names are already sanitized by the reporting data service.
    const selectedFaculty = report.filters.facultyId
      ? [...new Set(report.records.map(row => row.faculty))].join(", ") || "Selected faculty (no matching records)"
      : "All faculty";
    y = text(`Faculty: ${selectedFaculty}`, left, y, width, 9) + 1;
    y = text(`Appointment status: ${report.filters.status || "All"}   |   Attendance outcome: ${report.filters.attendanceOutcome || "All"}   |   Consultation mode: ${report.filters.mode || "All"}`, left, y, width, 9) + 8;
    rule(y); y += 8;
    const overviewTop = y;
    section("Executive overview");
    text(`Total consultations: ${report.summary.total}`, left + width / 2, overviewTop, width / 2, 12, ink, "right");
    y = text(`Verified completed attendance: ${report.summary.attendance.Completed ?? 0}   |   Historical unverified Completed: ${report.summary.attendance["Historical unverified Completed"] ?? 0}`, left, y, width, 9) + 4;

    let summaryTop = y;
    const groups = [
      ["Appointment status", report.summary.status, 244],
      ["Attendance classification", report.summary.attendance, 278],
      ["Consultation mode", report.summary.mode, width - 546],
    ];
    const summaryHeight = Math.max(...groups.map(([label, counts, w]) =>
      [[label, "Count"], ...Object.entries(counts)].reduce((height, values) => height +
        Math.max(wrap(values[0], w - 62, 8.5).length, wrap(values[1], 34, 8.5).length) * 12.5 + 4, 0)));
    if (summaryTop + summaryHeight > bottom) { newPage(); summaryTop = y; }
    // Keep all three classification tables aligned and reserve space for every row.
    let x = left, summaryBottom = summaryTop;
    for (const [label, counts, w] of groups) {
      const end = table([label, "Count"], Object.entries(counts), [w - 48, 48], { x, top: summaryTop, padding: 4 });
      summaryBottom = Math.max(summaryBottom, end);
      x += w + 12;
    }
    y = summaryBottom + 6;
    const note = "Completed appointment status means workflow finalization, not proof of attendance. Historical records remain unverified. Counts describe records; they are not Faculty rankings or disciplinary findings.";
    doc.fontSize(8.5);
    const noteHeight = doc.heightOfString(note, { width, lineGap: 2 });
    if (y + noteHeight > bottom) newPage();
    y = text(note, left, y, width, 8.5, muted) + 4;
    const widths = [30, 90, 108, 108, 125, 75, 114, width - 650];
    const rows = report.records.map((row, index) => [
      index + 1, date(row.createdAt), row.student, row.faculty,
      row.startAt ? `Start: ${date(row.startAt)}\nEnd: ${date(row.endAt)}` : "Not scheduled",
      row.mode, row.status, row.attendance,
    ]);
    const firstRowHeight = rows.length
      ? Math.max(...rows[0].map((value, i) => wrap(value, widths[i] - 14, 8.5).length)) * 12.5 + 12
      : 40;
    section("Consultation records", Math.min(bottom - 57, 53 + firstRowHeight));
    y = table(["#", "Request date", "Student", "Faculty", "Scheduled time", "Mode", "Status", "Attendance"], rows, widths);
    if (!rows.length) text("No consultations match the selected filters.", left + 7, y + 12, width - 14, 10, muted);
    const { start, count } = doc.bufferedPageRange();
    for (let page = start; page < start + count; page++) {
      doc.switchToPage(page);
      rule(doc.page.height - 52);
      // Explicit single-line footer stays above the margin and cannot create another page.
      doc.fontSize(8).fillColor(muted).text(
        `School of Computing | Administrative reference | Asia/Manila | Page ${page - start + 1} of ${count}`,
        left, doc.page.height - 44, { width, lineBreak: false },
      );
    }
    doc.end();
  } catch (error) {
    doc.destroy(error);
  }
  return output;
}
