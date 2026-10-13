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
    ...Object.keys(imports),
    `${compiled.code}; return UserManagement;`,
  )(React, ...Object.values(imports));
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

test("render shows server-backed controls and all required account details without excluded actions or internal IDs", async () => {
  const h = await harness();
  const tree = h.render();
  const html = renderToString(tree);
  for (const text of [
    "Search accounts",
    "All users",
    "Students",
    "Faculty",
    "Active",
    "Inactive",
    "CSV-created",
    "Manually created",
    "Legacy",
    "Institutional ID",
    "Full name",
    "Official email",
    "Account source",
    "Account status",
    "Date created",
    "000456",
    "Jane Santos",
    "jane@hau.edu.ph",
    "View Details",
    "Deactivate",
    "Create User Manually",
  ])
    assert.ok(html.includes(text), text);
  assert.doesNotMatch(
    html,
    /internal-reference|Reset Password|Pending Registrations|Approved Registrations|Rejected Registrations|Approve|Reject|Delete|Edit Role|Permissions/i,
  );
  const pagination = elements(
    tree,
    (element) => element.type === h.Pagination,
  )[0];
  assert.equal(pagination.props.currentPage, 2);
  assert.equal(pagination.props.totalItems, 41);
  assert.equal(pagination.props.itemsPerPage, 20);
  assert.doesNotMatch(
    h.raw,
    /\.slice\(|registrations|reset-password|newPassword/,
  );
});

test("filter and page changes produce server requests, reset pages only for new filters, and ignore stale responses", async () => {
  const h = await harness();
  h.render();
  const older = h.load();
  const filter = elements(
    h.render(),
    (element) => element.props?.label === "Role",
  )[0];
  filter.props.onChange("student");
  assert.equal(h.state[4], 1);
  h.render();
  const newer = h.load();
  h.resolve({
    users: [{ ...user, name: "STALE" }],
    pagination: { page: 2, total: 41 },
  });
  await older;
  assert.equal(h.state[0][0].name, "Jane Santos");
  h.resolve({ users: [], pagination: { page: 1, total: 0 } });
  await newer;
  assert.deepEqual(h.state[0], []);
  const query = new URL(h.calls[1].path, "http://test.local").searchParams;
  assert.equal(query.get("role"), "student");
  assert.equal(query.get("page"), "1");
  assert.equal(query.get("search"), "Jane");
  assert.ok(
    elements(h.render(), (element) => element.type === h.EmptyState).length,
  );
});

test("search debounce normalizes input and resets the page", async () => {
  const h = await harness();
  h.state[2] = "  Santos   Jane  ";
  h.render();
  const original = globalThis.window;
  let callback,
    cleared = false;
  globalThis.window = {
    setTimeout(fn, delay) {
      assert.equal(delay, 300);
      callback = fn;
      return 1;
    },
    clearTimeout() {
      cleared = true;
    },
  };
  try {
    const cleanup = h.effects[1]();
    callback();
    cleanup();
    assert.equal(h.state[3].search, "Santos Jane");
    assert.equal(h.state[4], 1);
    assert.equal(cleared, true);
  } finally {
    globalThis.window = original;
  }
});

test("deactivation requires confirmation and reason; synchronous repeated submissions send one request", async () => {
  const h = await harness();
  const button = elements(
    h.render(),
    (element) =>
      element.type === "button" && element.props.children === "Deactivate",
  )[0];
  button.props.onClick();
  assert.equal(h.calls.length, 0);
  assert.equal(h.dialog().props.open, true);
  assert.equal(h.dialog().props.inputLabel, "Deactivation reason (required)");
  h.dialog().props.onInputChange("   ");
  await h.dialog().props.onConfirm();
  assert.equal(h.calls.length, 0);
  h.dialog().props.onInputChange("  Operational review  ");
  const first = h.dialog().props.onConfirm();
  const second = h.dialog().props.onConfirm();
  assert.equal(h.calls.length, 1);
  assert.equal(h.dialog().props.loading, true);
  h.dialog().props.onCancel();
  assert.ok(h.state[10]);
  assert.equal(h.calls[0].options.method, "PATCH");
  assert.deepEqual(JSON.parse(h.calls[0].options.body), {
    accountStatus: "Inactive",
    expectedStatus: "Active",
    version: user.version,
    reason: "Operational review",
  });
  h.resolve({ message: "Account deactivated successfully." });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.calls.length, 2);
  const query = new URL(h.calls[1].path, "http://test.local").searchParams;
  assert.equal(query.get("page"), "2");
  assert.equal(query.get("role"), "faculty");
  assert.equal(query.get("search"), "Jane");
  h.resolve();
  await Promise.all([first, second]);
  assert.equal(h.state[10], null);
  assert.equal(h.state[11], "");
  assert.equal(h.state[12], false);
  assert.equal(h.state[4], 2);
  assert.equal(h.toasts.filter(([kind]) => kind === "success").length, 1);
});

test("activation confirms without reason, invalidated pages clamp, and source is not an action eligibility gate", async () => {
  const h = await harness();
  h.state[0] = [
    { ...user, accountStatus: "Inactive", accountSource: undefined },
  ];
  elements(
    h.render(),
    (element) =>
      element.type === "button" && element.props.children === "Activate",
  )[0].props.onClick();
  assert.equal(h.dialog().props.inputLabel, undefined);
  const pending = h.dialog().props.onConfirm();
  assert.equal(JSON.parse(h.calls[0].options.body).accountStatus, "Active");
  assert.equal(JSON.parse(h.calls[0].options.body).reason, undefined);
  h.resolve({ message: "Account activated successfully." });
  await new Promise((resolve) => setImmediate(resolve));
  h.resolve({ users: [], pagination: { page: 1, total: 0 } });
  await pending;
  assert.equal(h.state[4], 1);
});

test("safe error/loading states, conflict refresh and uncertain commit never show false success", async () => {
  for (const code of [
    "STATUS_CONFLICT",
    "REGISTRATION_CONFLICT",
    "STATUS_CHANGE_UNCERTAIN",
  ]) {
    const h = await harness();
    h.state[10] = { ...user, accountStatus: "Inactive" };
    const pending = h.dialog().props.onConfirm();
    h.reject(
      Object.assign(new Error("PRIVATE_INTERNAL_DETAIL"), {
        status: code === "STATUS_CHANGE_UNCERTAIN" ? 503 : 409,
        code,
      }),
    );
    await new Promise((resolve) => setImmediate(resolve));
    h.resolve();
    await pending;
    assert.equal(h.state[10], null);
    assert.equal(h.state[12], false);
    assert.equal(
      h.toasts.some(([kind]) => kind === "success"),
      false,
    );
    assert.doesNotMatch(JSON.stringify(h.toasts), /PRIVATE/);
  }
  const h = await harness();
  h.render();
  const pending = h.load();
  assert.ok(
    elements(h.render(), (element) => element.type === h.Loading).length,
  );
  h.reject(new Error("PRIVATE_CONNECTION"));
  await pending;
  assert.ok(
    elements(h.render(), (element) => element.type === h.ErrorState).length,
  );
  assert.doesNotMatch(h.state[6], /PRIVATE/);
});

test("detail request is server-backed, and closing prevents a late response reopening the modal", async () => {
  const h = await harness();
  elements(
    h.render(),
    (element) =>
      element.type === "button" && element.props.children === "View Details",
  )[0].props.onClick();
  assert.equal(h.calls[0].path, `/dean/users/${user._id}`);
  assert.equal(h.state[9], true);
  const modal = elements(
    h.render(),
    (element) => element.props?.user === user && "loading" in element.props,
  )[0];
  modal.props.onClose();
  h.resolve({ user });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.state[8], null);
});

test("status success refreshes the latest search even when a pending debounce changes it during submission", async () => {
  const h = await harness();
  h.state[10] = { ...user, accountStatus: "Inactive" };
  const pending = h.dialog().props.onConfirm();
  h.state[3] = {
    search: "Santos",
    role: "all",
    status: "Active",
    source: "manual",
  };
  h.state[4] = 1;
  h.render();
  h.resolve({ message: "Account activated successfully." });
  await new Promise((resolve) => setImmediate(resolve));
  const query = new URL(h.calls[1].path, "http://test.local").searchParams;
  for (const [key, value] of Object.entries({ ...h.state[3], page: "1" }))
    assert.equal(query.get(key), value);
  h.resolve({ users: [user], pagination: { page: 1, total: 1 } });
  await pending;
  assert.equal(h.state[4], 1);
});
