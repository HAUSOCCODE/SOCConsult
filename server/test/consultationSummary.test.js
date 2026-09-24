import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getSummaryDateRange,
  summaryInternals,
} from "../src/services/consultationSummaryService.js";

describe("AI consultation summary aggregation", () => {
  it("uses Asia/Manila date boundaries and rejects invalid ranges", () => {
    const range = getSummaryDateRange("2026-09-01", "2026-09-07");
    assert.equal(range.startAt.toISOString(), "2026-08-31T16:00:00.000Z");
    assert.equal(range.endAt.toISOString(), "2026-09-07T16:00:00.000Z");
    assert.throws(
      () => getSummaryDateRange("2026-09-08", "2026-09-07"),
      /End date/,
    );
    assert.throws(
      () => getSummaryDateRange("2026-02-31", "2026-03-01"),
      /valid calendar dates/,
    );
  });

  it("aggregates verified fields without student private data", () => {
    const insights = summaryInternals.aggregateRecords([
      {
        faculty: { name: "Prof. Santos" },
        subject: "Capstone guidance",
        reason: "Project concerns",
        yearLevel: "4th Year",
        consultationMode: "Online",
        estimatedDurationMinutes: 30,
      },
      {
        faculty: { name: "Prof. Santos" },
        subject: "Grade concerns",
        reason: "Question",
        yearLevel: "3rd Year",
        consultationMode: "Face-to-Face",
        estimatedDurationMinutes: 20,
        student: { email: "private@example.com" },
      },
    ]);
    assert.equal(insights.totalConsultations, 2);
    assert.equal(insights.mostActiveFaculty, "Prof. Santos");
    assert.equal(insights.averageDurationMinutes, 25);
    assert.deepEqual(insights.modeDistribution, {
      Online: 1,
      "Face-to-Face": 1,
    });
    assert.equal(
      JSON.stringify(insights).includes("private@example.com"),
      false,
    );
  });
});
