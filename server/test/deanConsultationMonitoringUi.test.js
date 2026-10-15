import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { monitoringQuery } from "../../client/src/utils/deanWorkspace.js";
import { APPOINTMENT_STATUSES, LEGACY_APPOINTMENT_STATUSES } from "../../client/src/utils/appointmentStatus.js";
const requireClient = createRequire(new URL("../../client/package.json", import.meta.url));
const React = requireClient("react"), { renderToStaticMarkup } = requireClient("react-dom/server"), { transform } = requireClient("esbuild");
const source = path => readFile(new URL(`../../client/src/${path}`, import.meta.url), "utf8");
const settle = () => new Promise(resolve => setImmediate(resolve));
const elements = tree => !tree || typeof tree !== "object" ? [] : Array.isArray(tree) ? tree.flatMap(elements) : [tree, ...elements(tree.props?.children)];
async function harness() {
  const raw = await source("pages/Dean/ConsultationMonitoring.jsx");
  const code = await transform(raw.replace(/^import.*$/gm, "").replace("export default function", "function"), { loader: "jsx" });
  let index = 0, params = new URLSearchParams();
  const state = [], effects = [], pending = [];
  const imports = {
    useState: initial => { const slot = index++; if (!(slot in state)) state[slot] = typeof initial === "function" ? initial() : initial;
      return [state[slot], value => state[slot] = typeof value === "function" ? value(state[slot]) : value]; },
    useEffect: fn => effects.push(fn),
    useSearchParams: () => [params, value => params = new URLSearchParams(value)],
    api: (path, options) => new Promise((resolve, reject) => pending.push({ path, options, resolve, reject })),
    APPOINTMENT_STATUSES, LEGACY_APPOINTMENT_STATUSES,
    ConsultationDetailsDialog: ({ recordId }) => React.createElement("p", null, `Details ${recordId}`),
    monitoringDate: value => value || "Unavailable",
  };
  const Page = new Function("React", ...Object.keys(imports), `${code.code}; return ConsultationMonitoring;`)(React, ...Object.values(imports));
  return { state, effects, pending, render() { index = 0; effects.length = 0; const tree = Page();
    // Participant lookups are tested by HTTP contracts; stub child render without executing their hooks.
    const replace = value => Array.isArray(value) ? value.map((child, index) => { const next = replace(child); return React.isValidElement(next) ? React.cloneElement(next, { key: next.key ?? index }) : next; }) : React.isValidElement(value) ? value.type?.name === "ParticipantFilter" ? React.createElement("span", { key: value.props.role }, value.props.role) : React.cloneElement(value, {}, replace(value.props.children)) : value;
    return replace(tree);
  }, html: tree => renderToStaticMarkup(tree), get query() { return params.toString(); } };
}
const data = { consultations: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } };
test("monitoring compatibility query allowlist drops unsafe, duplicate and unsupported inputs", () => {
  assert.equal(monitoringQuery("?status=Confirmed&unknown=x&redirect=https://bad.test&limit=101&facultyId=bad&attendanceOutcome=Present"), "?status=Confirmed");
  assert.equal(monitoringQuery("?status=Pending&status=Confirmed&search=%00&start=2026-02-30&end=2026-03-01"), "");
  const query = monitoringQuery("?search=Jane&status=No+Show&page=2&limit=100&start=2026-10-01&end=2026-10-16");
  assert.match(query, /status=No\+Show/); assert.match(query, /start=2026-10-01/);
});
test("monitoring loading, empty, filter reset, error and retry execute actual page handlers", async () => {
  const h = await harness();
  let tree = h.render(); assert.match(h.html(tree), /Loading consultations/);
  const cleanup = h.effects[1](); assert.equal(h.pending[0].path, "/dean/consultations");
  h.pending[0].resolve(data); await settle(); tree = h.render();
  assert.match(h.html(tree), /No consultations found/); assert.match(h.html(tree), /Attendance filtering will be available/);
  assert.doesNotMatch(h.html(tree), /Confirm request|Cancel consultation|Mark Completed/);
  const search = elements(tree).find(element => element.props.type === "search");
  search.props.onChange({ target: { value: "Jane" } }); tree = h.render();
  elements(tree).find(element => element.type === "form").props.onSubmit({ preventDefault() {} });
  assert.match(h.query, /search=Jane/); assert.match(h.query, /page=1/);
  cleanup(); tree = h.render(); h.effects[1]();
  assert.match(h.pending[1].path, /search=Jane/); h.pending[1].resolve(data); await settle(); tree = h.render();
  assert.match(h.html(tree), /No consultations match these filters/);
  elements(tree).find(element => element.type === "button" && element.props.children === "Reset filters").props.onClick();
  assert.equal(h.query, ""); tree = h.render(); h.effects[1]();
  h.pending[2].reject(new Error()); await settle(); tree = h.render(); assert.match(h.html(tree), /Unable to load consultations/);
  elements(tree).find(element => element.type === "button" && element.props.children === "Retry").props.onClick();
  tree = h.render(); h.effects[1](); h.pending[3].resolve(data); await settle(); assert.match(h.html(h.render()), /No consultations found/);
});
test("aborted stale responses cannot replace current filters and server pagination drives requests", async () => {
  const h = await harness(); h.render(); const cleanup = h.effects[1]();
  cleanup(); h.render(); h.effects[1]();
  h.pending[1].resolve({ consultations: [{ recordId: "safe-record", studentName: "Student", facultyName: "Faculty", subject: "Course", status: "No Show", legacy: true }], pagination: { page: 1, limit: 20, total: 21, totalPages: 2 } });
  await settle(); h.pending[0].resolve(data); await settle();
  let tree = h.render(); assert.match(h.html(tree), /Course/); assert.match(h.html(tree), /No Show \(Legacy\)/);
  elements(tree).find(element => element.type === "button" && element.props.children === "View Details").props.onClick();
  assert.match(h.html(h.render()), /Details safe-record/);
  tree = h.render(); elements(tree).find(element => element.type === "button" && element.props.children === "Next").props.onClick();
  assert.equal(h.query, "page=2"); h.render(); h.effects[1](); assert.match(h.pending.at(-1).path, /page=2/);
});
test("route consolidation, details, history and document components enforce read-only presentation", async () => {
  const app = await source("App.jsx"), layout = await source("layouts/DeanLayout.jsx"), details = await source("components/dean/ConsultationDetailsDialog.jsx"), document = await source("components/dean/ConsultationDocumentViewer.jsx");
  assert.match(app, /path="consultations" element={<ConsultationMonitoring/);
  assert.match(app, /path="appointments" element={<ConsultationMonitoringRedirect/);
  assert.match(app, /path="consultation-overview" element={<ConsultationMonitoringRedirect/);
  assert.match(app, /monitoringQuery\(location.search\)/); assert.match(layout, /label: "Consultation Monitoring"/);
  assert.doesNotMatch(app, /ConsultationOverview|AppointmentsManagement/);
  assert.match(details, /showModal/); assert.match(details, /onCancel={onClose}/); assert.match(details, /\/dean\/attendance-review/);
  assert.match(details, /Original\/requested schedule/); assert.match(details, /statusHistory.map/);
  assert.doesNotMatch(details + document, /meetingLink|cloudinaryUrl|method: "(?:POST|PUT|PATCH|DELETE)"/);
  assert.match(document, /Authorization/); assert.match(document, /URL.revokeObjectURL/); assert.match(document, /download={state.name}/);
});
