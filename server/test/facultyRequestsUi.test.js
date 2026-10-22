import { safeStudentError } from "../../client/src/utils/studentUiErrors.js";
import { isRecoverableUiError, safeUiError } from "../../client/src/utils/safeUiErrors.js";
﻿import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../client/package.json", import.meta.url));
const React = require("react"), { renderToStaticMarkup } = require("react-dom/server"), { transform } = require("esbuild");
const settle = () => new Promise(resolve => setImmediate(resolve));
const elements = tree => !tree || typeof tree !== "object" ? [] : Array.isArray(tree) ? tree.flatMap(elements) : [tree, ...elements(tree.props?.children)];
const record = { _id: "first", student: { name: "Student <script>" }, subject: "<img src=x onerror=alert(1)>", reason: "Separate concern\nFull text", status: "Pending", startAt: null, endAt: null, createdAt: "2026-10-19T00:00:00Z", bookingMethod: "published_slot", __v: 4, hasSupportingDocuments: true };
const result = (requests = [record]) => ({ requests, pagination: { page: 1, limit: 20, total: 21, totalPages: 2 } });
async function harness(file = "pages/Faculty/AppointmentRequests.jsx", overrides = {}) {
  const raw = await readFile(new URL(`../../client/src/${file}`, import.meta.url), "utf8");
  const compiled = await transform(raw.replace(/^import.*$/gm, "").replace("export default function", "function"), { loader: "jsx" });
  const state = [], refs = [], effects = [], pending = [], listeners = {}; let slot = 0, refSlot = 0;
  const imports = {
    safeStudentError, safeUiError, isRecoverableUiError, useMemo: fn => fn(),
    useState: initial => { const i = slot++; if (!(i in state)) state[i] = initial; return [state[i], value => state[i] = typeof value === "function" ? value(state[i]) : value]; },
    useRef: initial => { const i = refSlot++; return refs[i] ||= { current: initial }; }, useEffect: fn => effects.push(fn), useDialogFocus() {},
    createPortal: tree => tree, document: { body: {} }, window: { document: { body: {} }, addEventListener: (key, fn) => listeners[key] = fn, removeEventListener: key => delete listeners[key] },
    api: (path, options) => new Promise((resolve, reject) => pending.push({ path, options, resolve, reject })),
    useToast: () => ({ success() {}, error() {} }), formatManilaDisplay: value => value.toISOString(),
    StatusBadge: ({ status }) => React.createElement("span", null, status), EmptyState: ({ title, text }) => React.createElement("p", null, title, text),
    Loading: ({ message }) => React.createElement("p", null, message), ErrorState: ({ message, onRetry }) => React.createElement("div", null, React.createElement("p", null, message), React.createElement("button", { onClick: onRetry }, "Try again")),
    AppointmentRequestDetailsModal: ({ appointment, actions }) => React.createElement("div", null, appointment.reason, actions),
    OneTimeScheduleRequests: () => null, ...overrides,
  };
  const name = file.includes("FacultyRescheduleModal") ? "FacultyRescheduleModal" : file.includes("AppointmentRequestDetailsModal") ? "AppointmentRequestDetailsModal" : file.includes("SupportingDocumentViewer") ? "ProtectedRequestDocuments" : file.includes("OneTimeScheduleRequests") ? "OneTimeScheduleRequests" : "AppointmentRequests";
  const Component = new Function("React", ...Object.keys(imports), `${compiled.code};return ${name};`)(React, ...Object.values(imports));
  return { state, effects, pending, listeners, render: props => { slot = 0; refSlot = 0; effects.length = 0; return Component(props || {}); }, html: renderToStaticMarkup };
}
const button = (tree, text) => elements(tree).find(el => el.type === "button" && el.props.children === text);

test("request list renders escaped separate text, schedule fallback, server pages and no decisions before fresh detail", async () => {
  const h = await harness(); assert.match(h.html(h.render()), /Loading consultation requests/);
  const cleanup = h.effects[0](); assert.equal(h.pending[0].path, "/appointments/requests?status=Pending&page=1");
  h.pending[0].resolve(result()); await settle(); let tree = h.render(), html = h.html(tree);
  assert.match(html, /&lt;img/); assert.match(html, /Student &lt;script&gt;/); assert.match(html, /Separate concern/); assert.match(html, /Not scheduled/); assert.match(html, /Supporting document attached/);
  assert.equal(button(tree, "Confirm"), undefined); assert.equal(button(tree, "Reject"), undefined);
  button(tree, "View Details").props.onClick(); assert.equal(h.pending[1].path, "/appointments/requests/first");
  tree = h.render(); assert.match(h.html(tree), /Loading request details/); assert.equal(button(tree, "Reject"), undefined);
  h.pending[1].resolve({ appointment: { ...record, startAt: "2026-10-20T00:00:00Z", endAt: "2026-10-20T01:00:00Z" } }); await settle();
  tree = h.render(); const modal = elements(tree).find(el => el.props?.personalRequest);
  assert.ok(modal); assert.ok(button(modal.props.actions, "Confirm"));
  assert.ok(button(modal.props.actions, "Propose Schedule"));
  button(modal.props.actions, "Confirm").props.onClick();
  assert.equal(h.pending.length,2);
  const confirmedModal = elements(h.render()).find(el => el.props?.personalRequest);
  const confirm = button(confirmedModal.props.actions, "Confirm appointment"); confirm.props.onClick(); confirm.props.onClick();
  assert.equal(h.pending[2].path, "/appointments/first/status"); assert.deepEqual(JSON.parse(h.pending[2].options.body), { status: "Confirmed", note: "", expectedVersion: 4 });
  h.pending[2].resolve({ appointment: { meetingLink: "PRIVATE" } }); await settle(); assert.doesNotMatch(h.html(h.render()), /PRIVATE/);
  button(h.render(), "Next").props.onClick(); h.render(); assert.equal(h.state[1], 2);
  cleanup();
});

test("retry, empty, filter, All explanation and aborted responses preserve current list and detail", async () => {
  const h = await harness(); h.render(); let cleanup = h.effects[0]();
  h.pending[0].reject(Error("PRIVATE")); await settle(); let tree = h.render(); assert.match(h.html(tree), /Unable to connect to SOCConsult/); assert.doesNotMatch(h.html(tree), /PRIVATE/);
  elements(tree).find(element => typeof element.props?.onRetry === "function").props.onRetry(); cleanup(); h.render(); cleanup = h.effects[0]();
  h.listeners.focus(); assert.equal(h.pending[1].options.signal.aborted, true);
  h.pending[2].resolve(result()); await settle(); h.pending[1].resolve(result([])); await settle(); assert.equal(h.state[3].data.requests.length, 1);
  tree = h.render(); button(tree, "View Details").props.onClick();
  button(h.render(), "View Details").props.onClick(); assert.equal(h.pending[3].options.signal.aborted, true);
  h.pending[4].resolve({ appointment: { ...record, _id: "latest" } }); await settle();
  h.pending[3].resolve({ appointment: { ...record, _id: "stale" } }); await settle(); assert.equal(h.state[5].appointment._id, "latest");
  const select = elements(h.render()).find(el => el.type === "select"); select.props.onChange({ target: { value: "All" } });
  cleanup(); h.render(); cleanup = h.effects[0](); assert.match(h.pending[5].path, /status=All&page=1/);
  h.pending[5].resolve(result([])); await settle(); tree = h.render(); assert.match(h.html(tree), /No appointment requests/); assert.match(h.html(tree), /attendance, finalized/);
  cleanup(); h.effects.at(-1)();
});

test("personal details hide profile IDs and links while rendering full escaped subject and concern", async () => {
  const h = await harness("components/appointments/AppointmentRequestDetailsModal.jsx", {
    formatPersonName: value => value, X: () => null, SupportingDocumentViewer: () => null,
    OnlineMeetingDetails: () => React.createElement("p", null, "PRIVATE_LINK"),
  });
  const html = h.html(h.render({ appointment: { ...record, student: { name: "Student", email: "PRIVATE_EMAIL", studentId: "PRIVATE_ID", program: "PRIVATE_PROGRAM" } }, onClose() {}, personalRequest: true }));
  assert.match(html, /Subject \/ Course/); assert.match(html, /Consultation Concern/); assert.match(html, /&lt;img/); assert.match(html, /Full text/); assert.doesNotMatch(html, /PRIVATE/);
});

test("legacy review reuses versioned decisions without fetching or rendering another request list", async () => {
  const h = await harness("components/appointments/OneTimeScheduleRequests.jsx", { formatPersonName: value => value });
  const props = { reviewRequest: { ...record, bookingMethod: "schedule_request", estimatedDurationMinutes: 30 }, onClose() {}, onDecided() {} };
  let tree = h.render(props);
  h.effects[0](); assert.equal(h.pending.length, 0);
  assert.doesNotMatch(h.html(tree), /Requests for a Schedule|No pending schedule requests/);
  const date = elements(tree).find(el => el.type === "input" && el.props.type === "date"); date.props.onChange({ target: { value: "2026-10-20" } });
  tree = h.render(props); elements(tree).find(el => el.type === "input" && el.props.type === "time").props.onChange({ target: { value: "09:00" } });
  tree = h.render(props); button(tree, "Approve and Schedule").props.onClick();
  assert.equal(h.pending[0].path, "/schedule-requests/first/approve");
  const body = JSON.parse(h.pending[0].options.body);
  assert.equal(body.expectedVersion, 4); assert.equal(body.startAt, "2026-10-20T09:00:00+08:00"); assert.equal(body.durationMinutes, 30);
  h.pending[0].resolve({ message: "Saved" }); await settle(); assert.equal(h.pending.length, 1);
});

test("protected document viewer uses binary personal endpoints, rejects stale loads and revokes object URLs", async () => {
  const revoked = [], created = [], requests = [];
  const api = { download: (path, options) => new Promise((resolve, reject) => requests.push({ path, options, resolve, reject })) };
  const h = await harness("components/appointments/SupportingDocumentViewer.jsx", { api, URL: { createObjectURL: blob => { created.push(blob); return `blob:safe-${created.length}`; }, revokeObjectURL: value => revoked.push(value) } });
  const props = { appointment: { ...record, supportingDocuments: [{ _id: "doc", originalName: "<script>.txt", size: 10 }] } };
  let tree = h.render(props); const cleanup = h.effects[0]();
  button(tree, "View document").props.onClick();
  assert.equal(requests[0].path, "/appointments/requests/first/documents/doc");
  tree = h.render(props); button(tree, "View document").props.onClick(); assert.equal(requests[0].options.signal.aborted, true);
  requests[1].resolve({ blob: new Blob(["<script>Concern</script>"], { type: "text/plain" }) }); await settle();
  requests[0].resolve({ blob: new Blob(["STALE"], { type: "text/plain" }) }); await settle();
  tree = h.render(props); const html = h.html(tree); assert.match(html, /&lt;script&gt;Concern/); assert.doesNotMatch(html, /STALE/); assert.match(html, /blob:safe-1/);
  button(tree, "View document").props.onClick(); assert.deepEqual(revoked, ["blob:safe-1"]);
  requests[2].reject(Error("PRIVATE STORAGE")); await settle(); assert.doesNotMatch(h.html(h.render(props)), /PRIVATE STORAGE/); assert.match(h.html(h.render(props)), /Unable to load this document/);
  cleanup(); assert.equal(requests[2].options.signal.aborted, true);
});

test("legacy rejection preserves its payload, blocks repeat decisions and refreshes details after conflicts", async () => {
  const h = await harness(); h.render(); const cleanup = h.effects[0]();
  h.pending[0].resolve(result()); await settle(); button(h.render(), "View Details").props.onClick();
  h.pending[1].resolve({ appointment: { ...record, bookingMethod: "schedule_request" } }); await settle();
  let modal = elements(h.render()).find(el => el.props?.personalRequest);
  button(modal.props.actions, "Reject").props.onClick();
  modal = elements(h.render()).find(el => el.props?.personalRequest);
  elements(modal.props.actions).find(el => el.type === "textarea").props.onChange({ target: { value: "Unavailable" } });
  modal = elements(h.render()).find(el => el.props?.personalRequest);
  const reject = button(modal.props.actions, "Confirm rejection"); reject.props.onClick(); reject.props.onClick();
  assert.equal(h.pending.length, 3); assert.equal(h.pending[2].path, "/schedule-requests/first/reject");
  assert.deepEqual(JSON.parse(h.pending[2].options.body), { note: "Unavailable", expectedVersion: 4 });
  h.pending[2].reject(Error("PRIVATE CONFLICT")); await settle();
  assert.equal(h.pending[3].path, "/appointments/requests/first");
  assert.doesNotMatch(h.html(h.render()), /PRIVATE CONFLICT/);
  h.pending[3].resolve({ appointment: { ...record, status: "Confirmed", __v: 5 } }); await settle();
  modal = elements(h.render()).find(el => el.props?.personalRequest); assert.equal(modal.props.actions, false);
  cleanup();
});


test("FAC-06 unscheduled proposal reviews before sending, requires a version, guards same-tick submits and refreshes conflicts safely", async () => {
  let refreshed = 0;
  const h = await harness("components/appointments/FacultyRescheduleModal.jsx", { X: () => null, formatPersonName: value => value });
  const props = { appointment: { ...record, _id: "request", student: { name: "Student" }, startAt: null, endAt: null }, onClose() {}, onSuccess() {}, onConflict() { refreshed++; } };
  let tree = h.render(props); assert.match(h.html(tree), /Not scheduled/); assert.doesNotMatch(h.html(tree), /NaN/);
  const change = (type,value) => { tree = h.render(props); elements(tree).find(el => el.type === "input" && el.props.type === type).props.onChange({target:{value}}); };
  change("date","2099-02-01"); change("time","10:00");
  tree = h.render(props); const inputs = elements(tree).filter(el => el.type === "input");
  inputs.find(el => el.props.maxLength === 100).props.onChange({ target:{value:"Teams"} });
  tree = h.render(props); elements(tree).find(el => el.type === "textarea").props.onChange({target:{value:"Change schedule"}});
  const submit = () => elements(h.render(props)).find(el => el.type === "form").props.onSubmit;
  const event = {preventDefault(){}};
  await submit()(event); assert.equal(h.pending.length,0); assert.match(h.html(h.render(props)),/Send proposal/);
  const send = submit(); const first = send(event); await send(event); assert.equal(h.pending.length,1);
  assert.equal(JSON.parse(h.pending[0].options.body).expectedVersion,4);
  h.pending[0].reject(Object.assign(Error("PRIVATE"),{status:409})); await first;
  assert.equal(refreshed,1); assert.doesNotMatch(h.html(h.render(props)),/PRIVATE/);
  props.appointment.__v = undefined; await submit()(event); assert.equal(h.pending.length,1); assert.match(h.html(h.render(props)),/Reload these details/);
});
