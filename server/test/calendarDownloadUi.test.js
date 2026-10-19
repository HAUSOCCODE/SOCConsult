import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../client/package.json", import.meta.url));
const React = require("react"), { transform } = require("esbuild");
const elements = tree => !tree || typeof tree !== "object" ? [] : Array.isArray(tree) ? tree.flatMap(elements) : [tree, ...elements(tree.props?.children)];
test("shared calendar control guards immediate duplicates, progress, stale eligibility, safe errors and browser feedback", async () => {
  const raw = await readFile(new URL("../../client/src/components/appointments/CalendarDownload.jsx", import.meta.url), "utf8");
  const compiled = await transform(raw.replace(/^import.*$/gm, "").replace("export const", "const").replace("export default function", "function"), { loader: "jsx" });
  const state = [], refs = [], effects = [], pending = []; let slot = 0, refSlot = 0, clicks = 0, removed = 0, revoked = 0;
  const imports = {
    useState: initial => { const i = slot++; if (!(i in state)) state[i] = initial; return [state[i], v => state[i] = v]; },
    useRef: initial => refs[refSlot++] ||= { current: initial }, useEffect: fn => effects.push(fn),
    api: { download: (path, options) => new Promise((resolve, reject) => pending.push({ path, options, resolve, reject })) },
    URL: { createObjectURL: () => "blob:test", revokeObjectURL: () => revoked++ },
    document: { body: { appendChild() {} }, createElement: () => ({ click: () => clicks++, remove: () => removed++ }) },
    setTimeout: fn => fn(), AbortController,
  };
  const Component = new Function("React", ...Object.keys(imports), `${compiled.code};return CalendarDownload;`)(React, ...Object.values(imports));
  let appointment = { _id: "assigned", status: "Confirmed", startAt: "2035-01-01", endAt: "2035-01-02" };
  const render = () => { slot = 0; refSlot = 0; return Component({ appointment }); };
  const button = () => elements(render()).find(e => e.type === "button");
  render(); const cleanup = effects[0](); const handler = button().props.onClick;
  const work = handler(); await handler(); assert.equal(pending.length, 1); assert.equal(button().props.disabled, true);
  assert.equal(pending[0].path, "/appointments/assigned/calendar.ics"); assert.equal(pending[0].options.cache, "no-store");
  pending[0].resolve({ blob: { type: "text/calendar" }, filename: "unsafe/path" }); await work;
  assert.equal(clicks, 1); assert.equal(removed, 1); assert.equal(revoked, 1); assert.ok(state.includes("Calendar download started"));
  const failure = button().props.onClick(); pending[1].reject(new Error("secret")); await failure;
  assert.equal(elements(render()).some(e => e.props?.role === "alert"), true); assert.equal(JSON.stringify(state).includes("secret"), false);
  const stale = button().props.onClick; appointment.endAt = "2000-01-01"; await stale();
  assert.equal(pending.length, 2);
  cleanup();
});

test("Student and fresh personal details share the calendar control", async () => {
  for (const file of ["StudentAppointmentDetailsModal", "PersonalConsultationDetails"]) {
    const source = await readFile(new URL(`../../client/src/components/appointments/${file}.jsx`, import.meta.url), "utf8");
    assert.match(source, /<CalendarDownload/); assert.doesNotMatch(source, /api\.download|createObjectURL/);
  }
  const source = await readFile(new URL("../../client/src/components/appointments/FacultyConsultationsView.jsx", import.meta.url), "utf8");
  assert.match(source, /cache: "no-store"/); assert.match(source, /FacultyAppointmentDetailsModal appointment=\{a\} personal/);
});
