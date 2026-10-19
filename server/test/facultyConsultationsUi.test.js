import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../client/package.json", import.meta.url));
const React = require("react"), { renderToStaticMarkup } = require("react-dom/server"), { transform } = require("esbuild");
const settle = () => new Promise(resolve => setImmediate(resolve));
const elements = tree => !tree || typeof tree !== "object" ? [] : Array.isArray(tree) ? tree.flatMap(elements) : [tree, ...elements(tree.props?.children)];
const button = (tree, text) => elements(tree).find(el => el.type === "button" && el.props.children === text);
async function harness(role = "faculty") {
  const raw = await readFile(new URL("../../client/src/components/appointments/FacultyConsultationsView.jsx", import.meta.url), "utf8");
  const compiled = await transform(raw.replace(/^import.*$/gm, "").replace("export default function", "function"), { loader: "jsx" });
  const state = [], refs = [], effects = [], pending = []; let slot = 0, refSlot = 0;
  const imports = {
    useState: initial => { const i = slot++; if (!(i in state)) state[i] = initial; return [state[i], value => state[i] = typeof value === "function" ? value(state[i]) : value]; },
    useRef: initial => { const i = refSlot++; return refs[i] ||= { current: initial }; }, useEffect: fn => effects.push(fn),
    useAuth: () => ({ user: { role } }), api: (path, options) => new Promise((resolve, reject) => pending.push({ path, options, resolve, reject })),
    window: { addEventListener() {}, removeEventListener() {} }, setInterval: () => 1, clearInterval() {},
    Link: ({ to, children }) => React.createElement("a", { href: to }, children),
    Loading: () => React.createElement("p", null, "Loading"), ErrorState: ({ message, onRetry }) => React.createElement("button", { onClick: onRetry }, message), EmptyState: ({ title }) => React.createElement("p", null, title),
    StatusBadge: ({ status }) => React.createElement("span", null, status), consultationTime: v => v || "Not scheduled",
    FacultyAppointmentDetailsModal: ({ children }) => React.createElement("section", null, children), FacultyRescheduleModal: () => null, ConfirmDialog: () => null,
  };
  const Component = new Function("React", ...Object.keys(imports), `${compiled.code};return FacultyConsultationsView;`)(React, ...Object.values(imports));
  return { state, effects, pending, render: () => { slot = 0; refSlot = 0; effects.length = 0; return Component(); }, html: renderToStaticMarkup };
}
const result = { appointments: [{ _id: "first", student: { name: "Student <script>" }, subject: "<img>" }], pagination: { totalPages: 2 } };
test("personal list escapes text, paginates, exposes required sections and loads fresh abortable details", async () => {
  const h = await harness(); assert.match(h.html(h.render()), /Loading/);
  const cleanup = h.effects[0](); h.effects[1]();
  assert.equal(h.pending[0].path, "/appointments/consultations?section=Upcoming&page=1");
  h.pending[0].resolve(result); await settle(); let tree = h.render();
  assert.match(h.html(tree), /Student &lt;script&gt;/); assert.match(h.html(tree), /&lt;img&gt;/);
  for (const section of ["Upcoming", "Pending", "Reschedule Proposed", "Awaiting Attendance Update", "Attendance Review", "Recently Finalized", "Compatibility"]) assert.ok(button(tree, section));
  button(tree, "View Details").props.onClick({ currentTarget: { focus() {} } });
  assert.equal(h.pending[1].path, "/appointments/consultations/first"); assert.equal(h.pending[1].options.cache, "no-store");
  tree = h.render(); assert.match(h.html(tree), /Loading consultation details/);
  button(tree, "Close details").props.onClick(); assert.equal(h.pending[1].options.signal.aborted, true);
  h.pending[1].resolve({ appointment: { _id: "stale" } }); await settle(); assert.equal(h.state[4], null);
  tree = h.render(); button(tree, "Next").props.onClick(); assert.equal(h.state[1], 2);
  cleanup(); assert.equal(h.pending[0].options.signal.aborted, true);
});
test("bounded sections link to the correct Faculty and Dean history and expose no inert attendance action", async () => {
  for (const role of ["faculty", "dean"]) {
    const h = await harness(role); h.render(); h.state[0] = "Recently Finalized"; h.state[3] = { data: result };
    let tree = h.render(), html = h.html(tree);
    assert.match(html, /Latest 20 finalized records/); assert.match(html, new RegExp(role === "dean" ? '/dean/faculty/history' : '/faculty/history'));
    assert.equal(button(tree, "Next"), undefined);
    h.state[0] = "Awaiting Attendance Update"; html = h.html(h.render()); assert.match(html, /pending FAC-11/); assert.doesNotMatch(html, /Submit Attendance/);
    h.state[0] = "Compatibility"; html = h.html(h.render()); assert.match(html, /Read-only/);
  }
});
test("details use opt-in personal mode, owner eligibility and safe errors; shared defaults remain", async () => {
  const h = await harness(); h.render(); h.state[4] = { appointment: { _id: "a", status: "Confirmed", actions: { propose: false, cancel: false } } }; h.state[5] = "a";
  let tree = h.render(); assert.equal(button(tree, "Propose reschedule"), undefined); assert.equal(button(tree, "Cancel consultation"), undefined);
  h.state[4].appointment.actions = { propose: true, cancel: true }; tree = h.render(); assert.ok(button(tree, "Propose reschedule")); assert.ok(button(tree, "Cancel consultation"));
  assert.ok(elements(tree).find(el => el.props?.personal === true));
  const modal = await readFile(new URL("../../client/src/components/appointments/FacultyAppointmentDetailsModal.jsx", import.meta.url), "utf8"); assert.match(modal, /personal = false/);
  const detail = await readFile(new URL("../../client/src/components/appointments/PersonalConsultationDetails.jsx", import.meta.url), "utf8");
  assert.match(detail, /role="dialog"/); assert.match(detail, /aria-modal="true"/); assert.match(detail, /useDialogFocus/); assert.match(detail, /personalConsultation/);
  assert.doesNotMatch(detail, /student\?\.(email|studentId|program|yearLevel)|\.notes|attendanceSummary|StudentAttendanceResponseForm/);
});
