import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
const requireClient = createRequire(new URL("../../client/package.json", import.meta.url));
const React = requireClient("react");
const { renderToString } = requireClient("react-dom/server");
const { transform } = requireClient("esbuild");
async function component(path, imports) {
  const raw = await readFile(new URL(`../../client/src/${path}.jsx`, import.meta.url), "utf8");
  const name = /export default function (\w+)/.exec(raw)[1];
  const body = raw.replace(/^import[\s\S]*?from\s+["'][^"']+["'];?/gm, "").replace("export default function", "function");
  const compiled = await transform(body, { loader: "jsx", jsx: "transform" });
  return new Function("React", ...Object.keys(imports), `${compiled.code}; return ${name};`)(React, ...Object.values(imports));
}
function elements(tree, predicate) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap((child) => elements(child, predicate));
  return [...(predicate(tree) ? [tree] : []), ...elements(tree.props?.children, predicate)];
}
const validForm = { institutional_id: "000123", first_name: "Juan", middle_name: "", last_name: "Santos", official_email: "juan@student.hau.edu.ph", role: "student" };

test("client API preserves safe backend status/code for setup and uncertain-commit responses", async () => {
  const raw = await readFile(new URL("../../client/src/api/apiClient.js", import.meta.url), "utf8");
  const body = raw.replace("import.meta.env.VITE_API_URL", "undefined").replace("export async function api", "async function api");
  for (const code of ["PROVISIONING_SETUP_UNAVAILABLE", "ACCOUNT_CREATION_UNCERTAIN", "SERVICE_UNAVAILABLE"]) {
    const data = { code, message: "Safe account creation message." };
    const api = new Function("fetch", "sessionStorage", "FormData", `${body}; return api;`)(
      async () => ({ ok: false, status: 503, json: async () => data, headers: { get: () => null } }),
      { getItem: () => "test-only-token" }, FormData,
    );
    await assert.rejects(api("/dean/users", { method: "POST", body: "{}" }),
      (error) => error.status === 503 && error.code === code && error.message === data.message);
  }
});
async function formHarness() {
  const state = [{ ...validForm }, {}, "", false, false];
  const refs = [{ current: false }, { current: null }];
  let index = 0, refIndex = 0;
  const h = { state, refs, calls: [], success: 0, closed: 0 };
  const ConfirmDialog = () => null;
  const Component = await component("components/accounts/ManualAccountForm", {
    useState: (initial) => { const slot = index++; if (!(slot in state)) state[slot] = initial;
      return [state[slot], (value) => { state[slot] = value; }]; },
    useRef: () => refs[refIndex++], useEffect: () => {}, useId: () => "test-dialog",
    createPortal: (tree) => tree, X: () => null, ConfirmDialog,
    api: (path, options) => { h.calls.push({ path, options }); return new Promise((resolve, reject) => { h.resolve = resolve; h.reject = reject; }); },
  });
  const oldDocument = globalThis.document;
  globalThis.document = { body: {} };
  h.restore = () => { if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument; };
  h.render = () => { index = 0; refIndex = 0; return Component({ onClose: () => h.closed++, onSuccess: () => h.success++ }); };
  h.dialog = (tree) => elements(tree, (element) => element.type === ConfirmDialog)[0];
  h.review = (tree) => elements(tree, (element) => element.type === "form")[0].props.onSubmit({ preventDefault() {} });
  return h;
}

test("manual form renders only allowed roles/fields, accessible dialog, and safe explanatory text", async () => {
  const h = await formHarness();
  try {
    const tree = h.render();
    assert.deepEqual(elements(tree, (e) => e.type === "option").map((e) => e.props.value), ["student", "faculty"]);
    assert.equal(elements(tree, (e) => e.type === "input").length, 5);
    assert.equal(elements(tree, (e) => e.type === "input" && e.props.type === "password").length, 0);
    const modal = elements(tree, (e) => e.props?.role === "dialog")[0];
    assert.equal(modal.props["aria-modal"], "true"); assert.ok(modal.props["aria-labelledby"]);
    const html = renderToString(tree);
    for (const text of ["official email will be the username", "institutional ID will be the initial password", "active immediately", "change the password later"])
      assert.ok(html.includes(text), text);
    assert.doesNotMatch(html, /type="password"|permissions|Program Chair|Admin|approvalMethod|accountSource|accountStatus|\$2b\$/i);
    h.review(tree); assert.equal(h.calls.length, 0); assert.equal(h.state[4], true);
    const dialog = h.dialog(h.render()); assert.equal(dialog.props.open, true);
    assert.equal(elements(h.render(), (e) => e.props?.inert === true).length, 1);
    assert.doesNotMatch(JSON.stringify([dialog.props.message, dialog.props.supportingText]), /000123|Juan|juan@/);
  } finally { h.restore(); }
});

test("explicit confirmation and synchronous repeat guard send one allowlisted request then clear form", async () => {
  const h = await formHarness();
  try {
    h.review(h.render());
    const dialog = h.dialog(h.render());
    const first = dialog.props.onConfirm(); const second = dialog.props.onConfirm();
    assert.equal(h.calls.length, 1); assert.equal(h.state[3], true);
    assert.equal(h.calls[0].path, "/dean/users"); assert.equal(h.calls[0].options.method, "POST");
    assert.deepEqual(JSON.parse(h.calls[0].options.body), validForm);
    const busyTree = h.render();
    assert.equal(elements(busyTree, (e) => e.type === "fieldset")[0].props.disabled, true);
    assert.equal(h.dialog(busyTree).props.loading, true);
    h.dialog(busyTree).props.onCancel(); assert.equal(h.state[4], true);
    h.resolve({ message: "ignored", password: "SECRET", institutionalId: "SECRET-ID" });
    await Promise.all([first, second]);
    assert.equal(h.success, 1); assert.equal(h.state[0].institutional_id, ""); assert.equal(h.state[4], false);
    assert.equal(h.state[3], false); assert.equal(h.refs[0].current, false);
  } finally { h.restore(); }
});

test("form checks required/byte fields and shows field feedback without a success callback", async () => {
  const h = await formHarness();
  try {
    h.state[0] = { ...validForm, first_name: " ", institutional_id: "é".repeat(37) };
    h.review(h.render()); assert.ok(h.state[1].first_name); assert.ok(h.state[1].institutional_id);
    assert.equal(h.state[4], false); assert.equal(h.calls.length, 0);
    h.state[0] = { ...validForm }; h.review(h.render());
    const pending = h.dialog(h.render()).props.onConfirm();
    h.reject(Object.assign(new Error("Please correct the highlighted fields."), { status: 409, errors: { official_email: "Email already used." } }));
    await pending;
    const tree = h.render(); const html = renderToString(tree);
    assert.ok(html.includes("Email already used.")); assert.ok(html.includes('aria-invalid="true"'));
    assert.equal(h.success, 0); assert.equal(h.state[4], false); assert.equal(h.state[3], false);
    h.review(tree); const failed = h.dialog(h.render()).props.onConfirm(); h.reject(new Error("raw private request detail"));
    await failed;
    assert.doesNotMatch(h.state[2], /Refresh|private/);
  } finally { h.restore(); }
});

test("form distinguishes provisioning setup, uncertain commit and generic unavailable errors by API code", async () => {
  for (const [code, expected] of [
    ["PROVISIONING_SETUP_UNAVAILABLE", "Account creation is temporarily unavailable until account provisioning setup is completed."],
    ["ACCOUNT_CREATION_UNCERTAIN", "Unable to confirm account creation. Refresh the user list before trying again."],
    ["SERVICE_UNAVAILABLE", "Account creation is temporarily unavailable. Please try again later."],
  ]) {
    const h = await formHarness();
    try {
      h.review(h.render()); const pending = h.dialog(h.render()).props.onConfirm();
      h.reject(Object.assign(new Error("private database connection/index detail"), { status: 503, code }));
      await pending;
      assert.equal(h.state[2], expected); assert.equal(h.success, 0); assert.equal(h.state[3], false);
      assert.equal(h.state[4], false); assert.equal(h.refs[0].current, false);
      assert.ok(renderToString(h.render()).includes(expected));
      assert.doesNotMatch(h.state[2], /private|database|index|connection/i);
    } finally { h.restore(); }
  }
});

test("User Management manual success refreshes server accounts while preserving filters and page", async () => {
  const users = [{ _id: "user-1", name: "Person One", institutionalId: "000123", role: "faculty", accountStatus: "Active", accountSource: "manual", email: "person@hau.edu.ph" }];
  const filters = { search: "Person", role: "faculty", status: "Active", source: "manual" };
  const state = [users, { page: 2, total: 25 }, "Person", filters, 2, false, "", true, null, false, null, "", false];
  let index = 0;
  const calls = [], toasts = [];
  const ManualAccountForm = () => null, Pagination = () => null;
  const Component = await component("pages/Dean/UserManagement", {
    useState: (initial) => { const slot = index++; if (!(slot in state)) state[slot] = initial; return [state[slot], (value) => { state[slot] = typeof value === "function" ? value(state[slot]) : value; }]; },
    Link: "a",
    useSearchParams: () => [new URLSearchParams()],
    useRef: () => ({ current: 0 }), useId: () => "search-id", useCallback: (fn) => fn,
    useEffect: () => {}, createPortal: (value) => value, X: () => null,
    api: async (path) => { calls.push(path); return { users, pagination: { page: 2, total: 25 } }; },
    EmptyState: () => null, ErrorState: () => null, Loading: () => null, StatusBadge: () => null,
    ConfirmDialog: () => null, Pagination, ManualAccountForm,
    useToast: () => ({ success: (message) => toasts.push(message) }),
  });
  const tree = Component();
  assert.ok(elements(tree, (e) => e.type === "button" && e.props.children === "Create User Manually").length);
  assert.equal(elements(tree, (e) => e.type === Pagination)[0].props.currentPage, 2);
  assert.equal(elements(tree, (e) => e.type === Pagination)[0].props.totalItems, 25);
  const html = renderToString(tree);
  for (const text of ["User Accounts", "Faculty", "View Details", "Deactivate", "000123"])
    assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /Pending Registrations|Approve|Reject/);
  const form = elements(tree, (e) => e.type === ManualAccountForm)[0];
  form.props.onSuccess(); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state[7], false); assert.deepEqual(state[3], filters); assert.equal(state[4], 2);
  assert.equal(calls.length, 1);
  const query = new URL(calls[0], "http://test.local").searchParams;
  for (const [key, value] of Object.entries({ ...filters, page: "2", limit: "20" })) assert.equal(query.get(key), value);
  assert.deepEqual(toasts, ["User account created successfully."]);
});
