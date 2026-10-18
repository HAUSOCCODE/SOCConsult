import { sharedClientImports } from "./helpers/clientImports.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
const requireClient = createRequire(
  new URL("../../client/package.json", import.meta.url),
);
const React = requireClient("react");
const { renderToString } = requireClient("react-dom/server");
const { transform } = requireClient("esbuild");
const user = {
  _id: "internal-reference",
  name: "Jane Santos",
  institutionalId: "000456",
  email: "jane@hau.edu.ph",
  role: "faculty",
  accountSource: "legacy",
  accountStatus: "Active",
  createdAt: "2026-10-01T00:00:00Z",
  version: "2026-10-01T00:00:00.000Z",
};
function elements(tree, predicate) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree))
    return tree.flatMap((child) => elements(child, predicate));
  return [
    ...(predicate(tree) ? [tree] : []),
    ...elements(tree.props?.children, predicate),
  ];
}
async function harness() {
  const raw = await readFile(
    new URL("../../client/src/pages/Dean/UserManagement.jsx", import.meta.url),
    "utf8",
  );
  const body = raw
    .replace(/^import[\s\S]*?from\s+["'][^"']+["'];?/gm, "")
    .replace("export default function", "function");
  const compiled = await transform(body, { loader: "jsx", jsx: "transform" });
  const state = [
    [user],
    { page: 2, total: 41 },
    "Jane",
    { search: "Jane", role: "faculty", status: "all", source: "all" },
    2,
    false,
    "",
    false,
    null,
    false,
    null,
    "",
    false,
  ];
  const h = { state, refs: [], calls: [], toasts: [], effects: [], raw };
  let stateIndex = 0,
    refIndex = 0;
  h.ManualAccountForm = () => null;
  h.Pagination = () => null;
  h.ConfirmDialog = () => null;
  h.ErrorState = () => null;
  h.Loading = () => null;
  h.EmptyState = () => null;
  const imports = {
    Link: "a",
    useSearchParams: () => [new URLSearchParams(h.search || "")],
    useState: (initial) => {
      const slot = stateIndex++;
      if (!(slot in state)) state[slot] = initial;
      return [
        state[slot],
        (value) => {
          state[slot] =
            typeof value === "function" ? value(state[slot]) : value;
        },
      ];
    },
    useRef: (initial) => {
      const slot = refIndex++;
      h.refs[slot] ||= { current: initial };
      return h.refs[slot];
    },
    useId: () => "test-id",
    useEffect: (fn) => {
      h.effects.push(fn);
    },
    useCallback: (fn) => {
      h.load = fn;
      return fn;
    },
    createPortal: (value) => value,
    X: () => null,
    StatusBadge: ({ status }) => React.createElement("span", null, status),
    EmptyState: h.EmptyState,
    ErrorState: h.ErrorState,
    Loading: h.Loading,
    ConfirmDialog: h.ConfirmDialog,
    Pagination: h.Pagination,
    ManualAccountForm: h.ManualAccountForm,
    useToast: () => ({
      success: (message) => h.toasts.push(["success", message]),
      error: (message) => h.toasts.push(["error", message]),
    }),
    api: (path, options) => {
      h.calls.push({ path, options });
      return new Promise((resolve, reject) => {
        h.pending.push({ resolve, reject });
      });
    },
  };
  h.pending = [];
  const Component = new Function(
    "React",
    ...Object.keys({ ...sharedClientImports, ...imports }),
    `${compiled.code}; return UserManagement;`,
  )(React, ...Object.values({ ...sharedClientImports, ...imports }));
  h.render = () => {
    stateIndex = 0;
    refIndex = 0;
    h.effects = [];
    return Component();
  };
  h.dialog = () =>
    elements(h.render(), (element) => element.type === h.ConfirmDialog)[0];
  h.resolve = (value = { users: [user], pagination: { page: 2, total: 41 } }) =>
    h.pending.shift().resolve(value);
  h.reject = (error) => h.pending.shift().reject(error);
  return h;
}

test("confirmation warning, empty body, version, synchronous guard and preserved list view", async () => {
 const h=await harness();elements(h.render(),e=>e.type==="button"&&e.props.children==="Reset Password")[0].props.onClick();
 assert.equal(h.calls.length,0);assert.equal(h.dialog().props.open,true);assert.equal(h.dialog().props.inputLabel,undefined);
 assert.equal(h.dialog().props.message,"This will reset the user's password to their institutional ID. The user may change it later from Account Settings.");
 const first=h.dialog().props.onConfirm(),second=h.dialog().props.onConfirm();assert.equal(h.calls.length,1);assert.equal(h.dialog().props.loading,true);
 assert.equal(h.calls[0].options.method,"POST");assert.equal(h.calls[0].options.body,undefined);assert.equal(h.calls[0].options.headers["If-Match"],JSON.stringify(user.version));
 h.dialog().props.onCancel();assert.equal(h.dialog().props.open,true);
 h.resolve({message:"PRIVATE_CREDENTIAL"});await new Promise(r=>setImmediate(r));assert.match(h.calls[1].path,/page=2/);assert.match(h.calls[1].path,/search=Jane/);
 h.resolve();await Promise.all([first,second]);assert.deepEqual(h.toasts,[["success","Password reset successfully."]]);assert.equal(h.dialog().props.open,false);
});
test("unsupported roles hide reset and uncertain outcomes refresh without retry or disclosure", async () => {
 for(const role of ["dean","admin","program_chair","custom"]) {const h=await harness();h.state[0]=[{...user,role}];assert.equal(elements(h.render(),e=>e.type==="button"&&e.props.children==="Reset Password").length,0);}
 for(const code of ["PASSWORD_RESET_UNCERTAIN","PASSWORD_RESET_CONFLICT","INVALID_INSTITUTIONAL_ID","PASSWORD_RESET_INELIGIBLE",null]) {
 const h=await harness();elements(h.render(),e=>e.type==="button"&&e.props.children==="Reset Password")[0].props.onClick();h.dialog().props.onCancel();assert.equal(h.calls.length,0);
 elements(h.render(),e=>e.type==="button"&&e.props.children==="Reset Password")[0].props.onClick();const pending=h.dialog().props.onConfirm();
 h.reject(Object.assign(new Error("PRIVATE_PASSWORD_HASH"),{code}));await new Promise(r=>setImmediate(r));h.resolve();await pending;
 assert.equal(h.calls.filter(c=>c.options?.method==="POST").length,1);assert.equal(h.toasts.some(([k])=>k==="success"),false);assert.doesNotMatch(JSON.stringify(h.toasts),/PRIVATE/);
 }
});
