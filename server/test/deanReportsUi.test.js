import { deanUiError } from "../../client/src/utils/deanUiErrors.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
const requireClient = createRequire(
  new URL("../../client/package.json", import.meta.url),
);
const React = requireClient("react"),
  { transform } = requireClient("esbuild");
const source = (path) =>
  readFile(new URL(`../../client/src/${path}`, import.meta.url), "utf8");
const elements = (tree) =>
  !tree || typeof tree !== "object"
    ? []
    : Array.isArray(tree)
      ? tree.flatMap(elements)
      : [tree, ...elements(tree.props?.children)];
async function harness() {
  const raw = await source("pages/Dean/ReportsAnalytics.jsx");
  const code = await transform(
    raw
      .replace(/^import.*$/gm, "")
      .replace("export default function", "function"),
    { loader: "jsx" },
  );
  let index = 0;
  const state = [],
    effects = [],
    requests = [],
    downloads = [],
    urls = [],
    anchors = [];
  const api = (path) =>
    new Promise((resolve, reject) => requests.push({ path, resolve, reject }));
  api.download = (path, options) =>
    new Promise((resolve, reject) =>
      downloads.push({ path, options, resolve, reject }),
    );
  const imports = {
    deanUiError,
    useState: (initial) => {
      const slot = index++;
      if (!(slot in state))
        state[slot] = typeof initial === "function" ? initial() : initial;
      return [
        state[slot],
        (value) =>
          (state[slot] =
            typeof value === "function" ? value(state[slot]) : value),
      ];
    },
    useRef: (initial) => {
      const slot = index++;
      if (!(slot in state)) state[slot] = { current: initial };
      return state[slot];
    },
    useEffect: (fn) => effects.push(fn),
    ReportNarrativePanel: () => null,
    api,
    APPOINTMENT_STATUSES: ["Pending", "Completed"],
    URL: {
      createObjectURL: () => {
        urls.push("created");
        return "blob:test";
      },
      revokeObjectURL: () => urls.push("revoked"),
    },
    document: {
      body: { appendChild: () => {} },
      createElement: () => {
        const anchor = {
          click() {
            anchors.push(this.download);
          },
          remove() {},
        };
        return anchor;
      },
    },
    setTimeout: (fn) => {
      fn();
      return 1;
    },
    clearTimeout: () => {},
  };
  const Page = new Function(
    "React",
    ...Object.keys(imports),
    `${code.code}; return ReportsAnalytics;`,
  )(React, ...Object.values(imports));
  return {
    state,
    effects,
    requests,
    downloads,
    urls,
    anchors,
    raw,
    render() {
      index = 0;
      effects.length = 0;
      return Page();
    },
  };
}
const find = (tree, type) =>
  elements(tree).filter((node) => node.type === type);
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("reports UI isolates PDF from optional AI panel, submits filters and guards duplicate clicks", async () => {
  const h = await harness();
  let tree = h.render();
  const buttons = find(tree, "button");
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].props.children, "Generate PDF Report");
  h.effects[1]();
  assert.equal(h.requests.length, 1);
  assert.match(h.requests[0].path, /role=faculty/);
  h.requests[0].resolve({
    options: [{ userId: "provider", name: "Faculty" }],
    hasMore: true,
  });
  await settle();
  tree = h.render();
  assert.match(JSON.stringify(tree), /Refine the search/);
  const selects = find(tree, "select");
  selects[0].props.onChange({ target: { value: "provider" } });
  selects[1].props.onChange({ target: { value: "Completed" } });
  selects[2].props.onChange({ target: { value: "Completed" } });
  selects[3].props.onChange({ target: { value: "Online" } });
  tree = h.render();
  const submit = find(tree, "form")[0].props.onSubmit;
  const first = submit({ preventDefault() {} });
  await submit({ preventDefault() {} });
  assert.equal(h.downloads.length, 1);
  assert.equal(h.downloads[0].path, "/dean/reports/pdf");
  const body = JSON.parse(h.downloads[0].options.body);
  assert.equal(body.facultyId, "provider");
  assert.equal(body.status, "Completed");
  assert.equal(body.attendanceOutcome, "Completed");
  assert.equal(body.mode, "Online");
  tree = h.render();
  assert.equal(find(tree, "button")[0].props.disabled, true);
  assert.match(JSON.stringify(tree), /Generating PDF/);
  h.downloads[0].resolve({
    blob: new Blob(["pdf"], { type: "application/pdf" }),
    total: 0,
  });
  await first;
  tree = h.render();
  assert.match(JSON.stringify(tree), /No consultations match/);
  assert.equal(find(tree, "button")[0].props.disabled, false);
  assert.equal(h.anchors.length, 1);
  assert.deepEqual(h.urls, ["created", "revoked"]);
  assert.doesNotMatch(
    h.raw,
    /ai-summary|user-registrations|\/dean\/appointments|\.reduce\(|\.length\s*\//,
  );
});

test("reports UI shows validation, request errors, download success and faculty errors", async () => {
  const h = await harness();
  let tree = h.render();
  const dates = find(tree, "input").filter(
    (node) => node.props.type === "date",
  );
  dates[0].props.onChange({ target: { value: "2026-10-16" } });
  dates[1].props.onChange({ target: { value: "2026-10-01" } });
  tree = h.render();
  await find(tree, "form")[0].props.onSubmit({ preventDefault() {} });
  assert.equal(h.downloads.length, 0);
  assert.match(JSON.stringify(h.render()), /at most 366/);
  find(h.render(), "input")[1].props.onChange({
    target: { value: "2026-10-16" },
  });
  tree = h.render();
  let pending = find(tree, "form")[0].props.onSubmit({ preventDefault() {} });
  h.downloads[0].reject(new Error("Report unavailable"));
  await pending;
  assert.match(JSON.stringify(h.render()), /Unable to generate the PDF/);
  tree = h.render();
  pending = find(tree, "form")[0].props.onSubmit({ preventDefault() {} });
  h.downloads[1].resolve({
    blob: new Blob(["pdf"], { type: "application/pdf" }),
    total: 5,
  });
  await pending;
  assert.match(JSON.stringify(h.render()), /PDF generated successfully; download started/);
  h.effects[1]();
  h.requests[0].reject(new Error("Unavailable"));
  await settle();
  assert.match(JSON.stringify(h.render()), /Faculty options unavailable/);
});

test("download helper reads authoritative report total from server header", async () => {
  const raw = await source("api/apiClient.js");
  const requests = [];
  const api = new Function(
    "fetch",
    "sessionStorage",
    `${raw.replace(/^const API_URL = .*$/m, 'const API_URL = "http://isolated.test/api";').replace("export async function", "async function")}; return api;`,
  )(
    async (url, options) => {
      requests.push({ url, options });
      return new Response(new Blob(["pdf"], { type: "application/pdf" }), {
        headers: {
          "X-Report-Total": "0",
          "Content-Disposition": 'attachment; filename="report.pdf"',
        },
      });
    },
    { getItem: () => "test-only-token" },
  );
  const report = await api.download("/dean/reports/pdf", {
    method: "POST",
    body: "{}",
  });
  assert.equal(report.total, 0);
  assert.equal(report.filename, "report.pdf");
  assert.equal(
    requests[0].options.headers.Authorization,
    "Bearer test-only-token",
  );
});
