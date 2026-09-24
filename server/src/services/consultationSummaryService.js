import Groq from "groq-sdk";
import Appointment from "../models/Appointment.js";
import { getGroqModel } from "./groqModel.js";

const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const STOP_WORDS = new Set([
  "about",
  "and",
  "consultation",
  "consultations",
  "concern",
  "concerns",
  "help",
  "need",
  "please",
  "question",
  "questions",
  "request",
  "the",
  "with",
]);

const inputError = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
};

const manilaDate = (date) =>
  new Date(date.getTime() + MANILA_OFFSET_MS).toISOString().slice(0, 10);

export function getSummaryDateRange(startDate, endDate) {
  if (
    typeof startDate !== "string" ||
    typeof endDate !== "string" ||
    !DATE_PATTERN.test(startDate) ||
    !DATE_PATTERN.test(endDate)
  ) {
    throw inputError("Start date and end date must use YYYY-MM-DD format.");
  }
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()))
    throw inputError("Please provide valid dates.");
  if (
    start.toISOString().slice(0, 10) !== startDate ||
    end.toISOString().slice(0, 10) !== endDate
  )
    throw inputError("Please provide valid calendar dates.");
  const startAt = new Date(start.getTime() - MANILA_OFFSET_MS);
  const endAt = new Date(end.getTime() - MANILA_OFFSET_MS + 86400000);
  if (startAt >= endAt)
    throw inputError("End date must be on or after start date.");
  if (end.getTime() - start.getTime() > 366 * 86400000)
    throw inputError("The date range cannot exceed one year.");
  return { startDate, endDate, startAt, endAt };
}

const cleanText = (value) => String(value || "").trim();

function topicCounts(records) {
  const counts = new Map();
  for (const record of records) {
    const words = `${cleanText(record.subject)} ${cleanText(record.reason)}`
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length >= 5 && !STOP_WORDS.has(word));
    for (const word of new Set(words))
      counts.set(word, (counts.get(word) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([topic]) => topic.replace(/^./, (letter) => letter.toUpperCase()));
}

function aggregateRecords(records) {
  const facultyCounts = new Map();
  const yearCounts = new Map();
  const modeDistribution = { Online: 0, "Face-to-Face": 0 };
  let durationTotal = 0;
  let durationCount = 0;
  for (const record of records) {
    const facultyName = cleanText(record.faculty?.name) || "Unassigned Faculty";
    facultyCounts.set(facultyName, (facultyCounts.get(facultyName) || 0) + 1);
    if (record.yearLevel)
      yearCounts.set(
        record.yearLevel,
        (yearCounts.get(record.yearLevel) || 0) + 1,
      );
    if (record.consultationMode in modeDistribution)
      modeDistribution[record.consultationMode] += 1;
    const duration = Number(record.estimatedDurationMinutes);
    if (Number.isFinite(duration) && duration > 0) {
      durationTotal += duration;
      durationCount += 1;
    }
  }
  const rank = (map) =>
    [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const facultyRank = rank(facultyCounts);
  const yearRank = rank(yearCounts);
  return {
    totalConsultations: records.length,
    mostActiveFaculty: facultyRank[0]?.[0] || null,
    commonTopics: topicCounts(records),
    mostActiveYearLevel: yearRank[0]?.[0] || null,
    modeDistribution,
    averageDurationMinutes: durationCount
      ? Math.round(durationTotal / durationCount)
      : null,
    facultyCounts: Object.fromEntries(facultyRank),
    yearLevelCounts: Object.fromEntries(yearRank),
  };
}

const SYSTEM_PROMPT = `You are an administrative report-writing assistant for SOCConsult. Write one concise, factual paragraph about completed consultations. Use only the supplied verified aggregate data. Do not invent numbers, names, trends, causes, recommendations, or individual identities. Do not evaluate faculty performance and do not make appointment or academic decisions. Return plain text only.`;

async function generateNarrative(aggregatedData, dateRange) {
  if (!process.env.GROQ_API_KEY) {
    const error = new Error(
      "AI summary is currently unavailable because the AI service is not configured.",
    );
    error.statusCode = 503;
    throw error;
  }
  const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY,
    timeout: 25000,
    maxRetries: 0,
  });
  const completion = await groq.chat.completions.create({
    model: getGroqModel(),
    temperature: 0,
    max_tokens: 300,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: JSON.stringify({ dateRange, aggregatedData }),
      },
    ],
  });
  const summary = cleanText(completion.choices?.[0]?.message?.content);
  if (!summary || summary.length > 3000) {
    const error = new Error("The AI service returned an invalid summary.");
    error.statusCode = 502;
    throw error;
  }
  return summary
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function createConsultationSummary(startDate, endDate) {
  const range = getSummaryDateRange(startDate, endDate);
  const records = await Appointment.find({
    status: "Completed",
    startAt: { $gte: range.startAt, $lt: range.endAt },
  })
    .select(
      "faculty subject reason yearLevel consultationMode estimatedDurationMinutes startAt",
    )
    .populate("faculty", "name position")
    .lean();
  const insights = aggregateRecords(records);
  const dateRange = { start: range.startDate, end: range.endDate };
  if (!records.length) {
    return {
      dateRange,
      summary:
        "No completed consultations were recorded during the selected period. Choose another date range to generate a summary.",
      insights,
      generatedAt: new Date().toISOString(),
      hasData: false,
    };
  }
  return {
    dateRange,
    summary: await generateNarrative(insights, dateRange),
    insights,
    generatedAt: new Date().toISOString(),
    hasData: true,
  };
}

export const summaryInternals = { aggregateRecords, manilaDate };
