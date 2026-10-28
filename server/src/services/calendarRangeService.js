const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
const DATE_RANGES = [
  "today",
  "this_week",
  "this_month",
  "this_year",
  "all_time",
];
const inputError = (message) =>
  Object.assign(new Error(message), { code: "AI_TOOL_ARGUMENT_ERROR" });
export function getDateRangeFilter(range = "all_time", now = new Date()) {
  if (!DATE_RANGES.includes(range)) throw inputError("Invalid date range.");
  if (range === "all_time") return {};

  const manilaNow = new Date(now.getTime() + MANILA_OFFSET_MS);
  const year = manilaNow.getUTCFullYear();
  const month = manilaNow.getUTCMonth();
  const day = manilaNow.getUTCDate();
  let startParts;
  let endParts;

  if (range === "today") {
    startParts = [year, month, day];
    endParts = [year, month, day + 1];
  } else if (range === "this_week") {
    const mondayOffset = (manilaNow.getUTCDay() + 6) % 7;
    startParts = [year, month, day - mondayOffset];
    endParts = [year, month, day - mondayOffset + 7];
  } else if (range === "this_month") {
    startParts = [year, month, 1];
    endParts = [year, month + 1, 1];
  } else {
    startParts = [year, 0, 1];
    endParts = [year + 1, 0, 1];
  }

  const toUtc = ([y, m, d]) => new Date(Date.UTC(y, m, d) - MANILA_OFFSET_MS);
  return { startAt: { $gte: toUtc(startParts), $lt: toUtc(endParts) } };
}
