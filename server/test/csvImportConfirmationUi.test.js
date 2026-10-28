import { sharedClientImports } from "./helpers/clientImports.js";
import { deanUiError } from "../../client/src/utils/deanUiErrors.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
const requireClient = createRequire(new URL("../../client/package.json", import.meta.url));
const React = requireClient("react");
const { renderToString } = requireClient("react-dom/server");
const { transform } = requireClient("esbuild");
async function component(path, imports) {
  imports = { deanUiError, ...imports };
  const raw = await readFile(new URL(`../../client/src/${path}.jsx`, import.meta.url), "utf8");
  const name = /export default function (\w+)/.exec(raw)[1];
  const body = raw.replace(/^import[\s\S]*?from\s+["'][^"']+["'];?/gm, "").replace("export default function", "function");
  const compiled = await transform(body, { loader: "jsx", jsx: "transform" });
  return new Function("React", ...Object.keys({ ...sharedClientImports, ...imports }), `${compiled.code}; return ${name};`)(React, ...Object.values({ ...sharedClientImports, ...imports }));
}
const result = { importId: "safe-import", totalRows: 2, successfulRows: 2, failedRows: 0, studentCount: 1,
  facultyCount: 1, status: "completed", importedAt: "2026-10-13T00:00:00.000Z", message: "Accounts created successfully." };
test("terminal result renders only safe fields and navigation, ignoring extra credential data", async () => {
  const Component = await component("components/accounts/CSVImportResult", {
    Link: ({ children, to, ...props }) => React.createElement("a", { ...props, href: to }, children),
  });
  const html = renderToString(React.createElement(Component, { result: { ...result,
    password: "PLAINTEXT-SECRET", hash: "$2b$12$opaque", institutionalId: "PRIVATE-ID", email: "private@example.test" }, onNewImport: () => {} }));
  for (const text of ["safe-import", "Total rows", "Successful rows", "Failed rows", "Students", "Faculty", "completed", "Import timestamp", "Start New Import"])
    assert.ok(html.includes(text), text);
  assert.match(html, /href="\/dean\/users"/);
  assert.doesNotMatch(html, /PLAINTEXT|opaque|PRIVATE-ID|private@example|password|export/i);
});

test("actual page confirmation blocks repeated clicks and recovers completed state with GET", async () => {
  for (const uncertain of [false, true]) {
    const preview = { previewId: "preview-id", status: "validated", canConfirm: true,
      expiresAt: new Date(Date.now() + 60000).toISOString(), summary: { totalRows: 2, invalidRows: 0 },
      rows: [{ role: "student" }, { role: "faculty" }] };
    const state = [null, preview, false, "", false, true];
    let index = 0, resolve, reject;
    const ref = { current: false };
    const calls = [];
    const ConfirmDialog = () => null;
    const Component = await component("pages/Dean/CsvImport", {
      useState: (initial) => { const slot = index++; if (!(slot in state)) state[slot] = initial; return [state[slot], (value) => { state[slot] = value; }]; },
      useRef: initial => initial === false ? ref : { current: initial }, useEffect: () => {},
      useSearchParams: () => [new URLSearchParams("preview=preview-id"), () => {}],
      api: (path, options) => {
        calls.push({ path, options });
        if (options?.method === "POST") return new Promise((yes, no) => { resolve = yes; reject = no; });
        return Promise.resolve(result);
      },
      Link: () => null, CSVUploadPanel: () => null, CSVValidationPreview: () => null,
      CSVImportResult: () => null, ConfirmDialog,
    });
    const tree = Component();
    const dialog = tree.props.children.find((element) => element?.type === ConfirmDialog);
    assert.match(dialog.props.message, /2 accounts: 1 Students and 1 Faculty/);
    assert.match(dialog.props.supportingText, /Official email is the login/);
    assert.match(dialog.props.supportingText, /institutional ID is their initial password/);
    assert.match(dialog.props.supportingText, /Passwords will not appear in results/);
    assert.match(dialog.props.supportingText, /change their password later/);
    const first = dialog.props.onConfirm();
    const duplicate = dialog.props.onConfirm();
    assert.equal(calls.length, 1); assert.equal(state[4], true);
    assert.equal(calls[0].options.body, undefined);
    if (uncertain) reject(new Error("Response lost")); else resolve(result);
    await Promise.all([first, duplicate]);
    assert.equal(calls.length, uncertain ? 2 : 1);
    if (uncertain) assert.equal(calls[1].options, undefined);
    assert.deepEqual(state[1], result); assert.equal(state[3], "");
    assert.equal(state[4], false); assert.equal(state[5], false); assert.equal(ref.current, false);
  }
});
