import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { formatDateOnly, formatManilaDateTime, formatManilaDate, formatManilaTime, formatManilaDisplay } from "../../client/src/utils/formatDateTime.js";

test("Manila timestamp display crosses midnight and is independent of host timezone", () => {
  const value = "2026-10-18T16:05:00Z";
  assert.match(formatManilaDateTime(value), /19 Oct 2026|Oct 19, 2026/);
  assert.match(formatManilaTime(value), /12:05\s*am/i);
  assert.equal(formatManilaDisplay(value, { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }), formatManilaTime(value));
  const module = new URL("../../client/src/utils/formatDateTime.js", import.meta.url).href;
  const script = `import {formatManilaDateTime,formatDateOnly} from ${JSON.stringify(module)}; console.log(JSON.stringify([formatManilaDateTime(${JSON.stringify(value)}),formatDateOnly('2026-10-18')]))`;
  const outputs = ["UTC", "America/Los_Angeles", "Asia/Tokyo"].map(TZ => execFileSync(process.execPath, ["--input-type=module", "-e", script], { env: { ...process.env, TZ }, encoding: "utf8" }));
  assert.equal(new Set(outputs).size, 1);
});

test("date-only filters retain their calendar day, validate leap dates and remain unchanged", () => {
  const filters = { start: "2026-10-18", end: "2026-10-19" };
  const before = JSON.stringify(filters);
  assert.match(formatDateOnly(filters.start), /18 Oct 2026|Oct 18, 2026/);
  assert.equal(formatManilaDate(filters.start), formatDateOnly(filters.start));
  assert.match(formatDateOnly("2024-02-29"), /29|Feb/);
  for (const value of ["2026-02-29", "2026-13-01", "2026-04-31", "2026-1-01", "bad", null]) assert.equal(formatDateOnly(value), "Unavailable");
  for (const value of ["bad", null, undefined, ""]) assert.equal(formatManilaDateTime(value, "Not recorded"), "Not recorded");
  assert.equal(JSON.stringify(filters), before);
});
