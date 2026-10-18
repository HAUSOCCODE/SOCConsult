import { deanUiError } from "../../client/src/utils/deanUiErrors.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
const requireClient = createRequire(new URL("../../client/package.json", import.meta.url));
const React = requireClient("react"), { transform } = requireClient("esbuild"), { renderToStaticMarkup } = requireClient("react-dom/server");
const read = path => readFile(new URL(`../../client/src/${path}`, import.meta.url), "utf8");
const settle = () => new Promise(resolve => setImmediate(resolve));
const elements = tree => !tree || typeof tree !== "object" ? [] : Array.isArray(tree) ? tree.flatMap(elements) : [tree, ...elements(tree.props?.children)];
async function harness(path, name, props = {}) {
  const raw = await read(path);
  const code = await transform(raw.replace(/^import.*$/gm, "").replace(/export default function/g, "function").replace(/export const/g, "const"), { loader: "jsx" });
  let index = 0, params = new URLSearchParams(); const state = [], effects = [], pending = [];
  const imports = {
    deanUiError,
    useState: initial => { const slot = index++; if (!(slot in state)) state[slot] = typeof initial === "function" ? initial() : initial; return [state[slot], value => state[slot] = typeof value === "function" ? value(state[slot]) : value]; },
    useRef: initial => { const slot = index++; if (!(slot in state)) state[slot] = { current: initial }; return state[slot]; },
    useEffect: effect => effects.push(effect), useSearchParams: () => [params, value => params = new URLSearchParams(value)],
    useParams: () => ({}), useNavigate: () => () => {},
    api: (path, options) => new Promise((resolve, reject) => pending.push({ path, options, resolve, reject })),
    ConfirmDialog: props => React.createElement("aside", { "data-confirm": props.open }),
    AttendanceReviewDetails: () => null, monitoringDate: value => value || "Unavailable",
  };
  const Component = new Function("React", ...Object.keys(imports), `${code.code}; return ${name};`)(React, ...Object.values(imports));
  return { state, effects, pending, render() { index = 0; effects.length = 0; return Component(props); }, get query() { return params.toString(); } };
}
test("resolution form requires explicit selection, confirms finals and synchronously blocks duplicate clicks", async () => {
  const saved = [], busy = [];
  const h = await harness("components/attendance/AttendanceResolutionForm.jsx", "AttendanceResolutionForm", { recordId: "record", version: 4, onSaved: value => saved.push(value), onBusy: value => busy.push(value), onStale: () => {} });
  let tree = h.render();
  assert.equal(elements(tree).find(e => e.type === "button").props.disabled, true);
  elements(tree).find(e => e.type === "select").props.onChange({ target: { value: "confirm_student_no_show" } });
  elements(tree).find(e => e.type === "textarea").props.onChange({ target: { value: "  Evidence reviewed  " } });
  tree = h.render(); tree.props.onSubmit({ preventDefault() {} }); assert.equal(h.pending.length, 0);
  tree = h.render(); const confirmation = elements(tree).find(e => typeof e.type === "function"); assert.equal(confirmation.props.open, true);
  const first = confirmation.props.onConfirm(), second = confirmation.props.onConfirm();
  assert.equal(h.pending.length, 1); assert.equal(JSON.parse(h.pending[0].options.body).expectedVersion, 4);
  assert.equal(JSON.parse(h.pending[0].options.body).reason, "Evidence reviewed");
  assert.equal(elements(h.render()).find(e => e.type === "fieldset").props.disabled, true);
  h.pending[0].resolve({ state: "Resolved" }); await Promise.all([first, second]);
  assert.equal(saved.length, 1); assert.deepEqual(busy, [true, false]);
});
test("leave-under-review saves without final confirmation; stale and uncertain responses require refresh", async () => {
  for (const status of [409, 503]) {
    let refreshes = 0;
    const h = await harness("components/attendance/AttendanceResolutionForm.jsx", "AttendanceResolutionForm", { recordId: "record", version: 0, onSaved: () => {}, onBusy: () => {}, onStale: () => refreshes++ });
    let tree = h.render(); elements(tree).find(e => e.type === "select").props.onChange({ target: { value: "leave_under_review" } });
    elements(tree).find(e => e.type === "textarea").props.onChange({ target: { value: "Need more information" } });
    tree = h.render(); tree.props.onSubmit({ preventDefault() {} }); assert.equal(h.pending.length, 1);
    h.pending[0].reject(Object.assign(new Error("Unavailable"), { status })); await settle(); tree = h.render();
    assert.equal(elements(tree).find(e => e.type === "fieldset").props.disabled, true);
    const refresh = elements(tree).find(e => e.type === "button" && e.props.children === "Refresh details"); refresh.props.onClick(); assert.equal(refreshes, 1);
    tree.props.onSubmit({ preventDefault() {} }); assert.equal(h.pending.length, 1);
  }
});
test("queue actual handlers load, retry, reset, paginate and ignore aborted responses", async () => {
  const h = await harness("pages/Dean/AttendanceReview.jsx", "AttendanceReview");
  let tree = h.render(); const cleanup = h.effects[2](); assert.match(h.pending[0].path, /\/dean\/attendance-review$/);
  cleanup(); h.render(); h.effects[2]();
  h.pending[1].resolve({ reviews: [], pagination: { page: 1, total: 0, totalPages: 0 } }); await settle();
  h.pending[0].reject(new Error("Old request")); await settle(); tree = h.render(); assert.ok(elements(tree).some(e => e.props?.role === "status" && /No unresolved/.test(e.props.children)));
  const select = elements(tree).find(e => e.type === "select"); select.props.onChange({ target: { value: "responses_conflict" } });
  tree = h.render(); elements(tree).find(e => e.type === "form").props.onSubmit({ preventDefault() {} }); assert.match(h.query, /reviewReason=responses_conflict/);
  h.render(); h.effects[2](); h.pending[2].reject(new Error()); await settle(); tree = h.render();
  elements(tree).find(e => e.type === "button" && e.props.children === "Retry").props.onClick(); h.render(); h.effects[2]();
  h.pending[3].resolve({ reviews: [], pagination: { page: 1, total: 21, totalPages: 2 } }); await settle(); tree = h.render();
  elements(tree).find(e => e.type === "button" && e.props.children === "Next").props.onClick(); assert.match(h.query, /page=2/);
  elements(tree).find(e => e.type === "button" && e.props.children === "Reset filters").props.onClick(); assert.equal(h.query, "");
});
test("review routing, private detail and document delivery remain isolated from monitoring and AI", async () => {
  const [app, layout, details, form, confirmation] = await Promise.all([read("App.jsx"), read("layouts/DeanLayout.jsx"), read("components/attendance/AttendanceReviewDetails.jsx"), read("components/attendance/AttendanceResolutionForm.jsx"), read("components/ConfirmDialog.jsx")]);
  assert.match(app, /element={<AttendanceReview \/>}/); assert.match(layout, /path: "\/dean\/attendance-review"/);
  assert.match(details, /ConsultationDocumentViewer/); assert.match(details, /Private reason/); assert.match(details, /No response was submitted/);
  assert.match(form, /portalTarget={form.current\?\.closest\("dialog"\)}/); assert.match(confirmation, /portalTarget \|\| document.body/);
  assert.doesNotMatch(details + form, /groq|openai|chatWithAi|dangerouslySetInnerHTML|\.notes\b/i);
});
