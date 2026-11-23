import { sharedClientImports } from "./helpers/clientImports.js";
import { deanUiError } from "../../client/src/utils/deanUiErrors.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../client/package.json", import.meta.url));
const React = require("react"), { transform } = require("esbuild");
const nodes = tree => !tree || typeof tree !== "object" ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
test("Reports narrative panel keeps filters intact, guards duplicates, reviews expected version and regenerates", async () => {
  const raw = await readFile(new URL("../../client/src/components/dean/ReportNarrativePanel.jsx", import.meta.url), "utf8");
  const { code } = await transform(raw.replace(/^import.*$/gm, "").replace("export default function", "function"), { loader: "jsx" });
  let index = 0; const state = [], requests = [];
  const useState = value => { const slot = index++; if (!(slot in state)) state[slot] = value; return [state[slot], v => state[slot] = v]; };
  const useRef = value => { const slot = index++; if (!(slot in state)) state[slot] = { current: value }; return state[slot]; };
  const api = (path, options) => new Promise((resolve, reject) => requests.push({ path, options, resolve, reject }));
  const copied = [];
  let copyFailure = false;
  const navigator = { clipboard: { writeText: async text => { if (copyFailure) throw new Error(); copied.push(text); } } };
  const Panel = new Function(...Object.keys(sharedClientImports), "React", "useState", "useRef", "api", "useEffect", "deanUiError", "navigator", "Sparkles", code + "; return ReportNarrativePanel;")(...Object.values(sharedClientImports), React, useState, useRef, api, () => {}, deanUiError, navigator, require("lucide-react").Sparkles);
  const filters = { start: "2026-10-01", end: "2026-10-16", facultyId: "", status: "", mode: "", attendanceOutcome: "" };
  const original = { ...filters };
  const render = () => { index = 0; return Panel({ filters }); };
  const buttons = tree => nodes(tree).filter(n => n.type === "button");
  let tree = render();
  const first = buttons(tree)[0].props.onClick(); await buttons(tree)[0].props.onClick(); assert.equal(requests.length, 1);
  const loading = render();
  assert.equal(loading.props["aria-busy"], true);
  assert.match(JSON.stringify(loading), /Generating narrative from authorized report statistics/);
  assert.equal(buttons(loading)[0].props.disabled, true);
  assert.deepEqual(JSON.parse(requests[0].options.body), { start: filters.start, end: filters.end });
  requests[0].reject(new Error("AI unavailable")); await first;
  assert.match(JSON.stringify(render()), /AI summary is unavailable/); assert.deepEqual(filters, original);
  const generation = buttons(render())[0].props.onClick();
  const headings = ["Executive Summary", "Consultation Activity", "Attendance Analysis", "Key Observations", "Recommendations"];
  const snapshot = { totalConsultations: 9, statusCounts: { Completed: 9 }, attendanceOutcomeCounts: { Completed: 2, "Student No-show": 3, "Faculty No-show": 1, "Historical unverified Completed": 3 } };
  const summary = { id: "summary-id", filters: { start: filters.start, end: filters.end }, snapshot, narrative: headings.map(title => `${title}\nAuthorized report paragraph.`).join("\n\n"), reviewState: "unreviewed", version: 1, generatedAt: "now" };
  requests[1].resolve(summary); await generation;
  tree = render(); assert.match(JSON.stringify(tree), /Unreviewed/);
  assert.deepEqual(nodes(tree).filter(node => node.type === "h3").map(node => node.props.children), headings);
  const metrics = nodes(tree).filter(node => node.type === "dl").flatMap(node => nodes(node).filter(child => child.type === "dd").map(child => child.props.children));
  assert.deepEqual(metrics, [9, 2, 3, 1], "verified attendance comes from attendance outcomes, not Completed workflow status");
  const approval = buttons(tree)[1].props.onClick(); assert.equal(requests[2].path, "/dean/reports/ai-summaries/summary-id/review"); assert.deepEqual(JSON.parse(requests[2].options.body), { expectedVersion: 1 });
  requests[2].resolve({ ...summary, reviewState: "reviewed", reviewedAt: "later", version: 2 }); await approval;
  assert.equal(buttons(render()).length, 2);
  const failedRegeneration = buttons(render())[0].props.onClick();
  assert.equal(nodes(render()).filter(node => node.type === "article").length, 0, "approved draft is cleared immediately when regenerating");
  requests[3].reject(new Error()); await failedRegeneration;
  assert.doesNotMatch(JSON.stringify(render()), /later|Review completed|"Reviewed"/);
  const regeneration = buttons(render())[0].props.onClick(); requests[4].resolve({ ...summary, id: "new-summary" }); await regeneration;
  assert.match(JSON.stringify(render()), /Unreviewed/);
  const copy = () => buttons(render()).find(button => button.props.children === "Copy Narrative").props.onClick();
  await copy(); assert.deepEqual(copied, [summary.narrative]);
  assert.match(JSON.stringify(render()), /Narrative copied/);
  copyFailure = true; await copy(); assert.match(JSON.stringify(render()), /copy it manually/);
  const oldApproval = buttons(render()).find(button => button.props.children === "I have reviewed and approve this narrative").props.onClick;
  filters.mode = "Online";
  assert.equal(nodes(render()).filter(node => node.type === "article").length, 0);
  assert.match(JSON.stringify(render()), /previous draft and its approval do not apply/);
  const beforeStale = requests.length;
  await oldApproval(); assert.equal(requests.length, beforeStale, "stale review callbacks cannot approve another filter selection");
  filters.mode = ""; render();
  assert.equal(nodes(render()).filter(node => node.type === "article").length, 0, "returning to previous filters does not restore approval or draft");
  for (const [failure, message] of [
    [{ code: "AI_EMPTY_DATASET", status: 422 }, /No consultations match/],
    [{ code: "AI_INVALID_OUTPUT" }, /could not be validated/],
    [{ name: "AbortError" }, /generation timed out/],
    [{ status: 429 }, /Wait before trying again/],
  ]) {
    const before = requests.length;
    const attempt = buttons(render())[0].props.onClick();
    requests[before].reject(failure); await attempt;
    assert.match(JSON.stringify(render()), message);
    assert.equal(render().props["aria-busy"], false);
    assert.equal(requests.length, before + 1, "no automatic retries");
  }
  const malformed = buttons(render())[0].props.onClick(); requests.at(-1).resolve({}); await malformed;
  assert.match(JSON.stringify(render()), /could not be validated/);
  const improperlyApproved = buttons(render())[0].props.onClick();
  requests.at(-1).resolve({ ...summary, id: "unexpected-approved", reviewState: "reviewed", version: 2, reviewedAt: "old-approval" }); await improperlyApproved;
  assert.match(JSON.stringify(render()), /could not be validated/);
  assert.equal(nodes(render()).filter(node => node.type === "article").length, 0);
  const lateGeneration = buttons(render())[0].props.onClick();
  filters.mode = "Online"; render();
  requests.at(-1).resolve({ ...summary, id: "late-draft" }); await lateGeneration;
  assert.equal(nodes(render()).filter(node => node.type === "article").length, 0, "generation response for prior filters is ignored");
  const currentGeneration = buttons(render())[0].props.onClick();
  const currentSummary = { ...summary, id: "current-draft", filters: { ...summary.filters, mode: "Online" } };
  requests.at(-1).resolve(currentSummary); await currentGeneration;
  const pendingApproval = buttons(render()).find(button => button.props.children === "I have reviewed and approve this narrative").props.onClick();
  filters.status = "Completed"; render();
  requests.at(-1).resolve({ ...currentSummary, reviewState: "reviewed", reviewedAt: "late-approval", version: 2 }); await pendingApproval;
  assert.equal(nodes(render()).filter(node => node.type === "article").length, 0);
  assert.doesNotMatch(JSON.stringify(render()), /late-approval|"Reviewed"/);
  const css = await readFile(new URL("../../client/src/components/dean/ReportNarrativePanel.css", import.meta.url), "utf8");
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /animation: none/);
});


test("SOC Insights uses a bounded fast-response transition and discards drafts made stale during it", async () => {
  const raw = await readFile(new URL("../../client/src/components/dean/ReportNarrativePanel.jsx", import.meta.url), "utf8");
  const { code } = await transform(raw.replace(/^import.*$/gm, "").replace("export default function", "function"), { loader: "jsx" });
  let index = 0, now = 0, nextTimer = 0, stateWrites = 0;
  const state = [], requests = [], timers = new Map(), effects = [];
  const imports = {
    ...sharedClientImports, React, Sparkles: require("lucide-react").Sparkles, deanUiError,
    useState(initial) { const slot = index++; if (!(slot in state)) state[slot] = initial; return [state[slot], value => { stateWrites++; state[slot] = value; }]; },
    useRef(initial) { const slot = index++; if (!(slot in state)) state[slot] = { current: initial }; return state[slot]; },
    useEffect(fn) { effects.push(fn); },
    api: (path, options) => new Promise((resolve, reject) => requests.push({ path, options, resolve, reject })),
    performance: { now: () => now },
    setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  const Panel = new Function(...Object.keys(imports), code + "; return ReportNarrativePanel;")(...Object.values(imports));
  const filters = { start: "2026-11-01", end: "2026-11-23", mode: "" };
  const render = () => { index = 0; return Panel({ filters }); };
  const generateButton = () => nodes(render()).find(node => node.type === "button");
  const settle = () => new Promise(resolve => setImmediate(resolve));
  const summary = (id, selected = {}) => ({ id, filters: { start: filters.start, end: filters.end, ...selected },
    narrative: "Executive Summary\nA briefing based on the saved statistics.", reviewState: "unreviewed", version: 1, generatedAt: "2026-11-23T04:00:00Z" });
  const finishTransition = () => {
    const visual = [...timers.entries()].find(([, timer]) => timer.delay < 1000);
    assert.ok(visual, "a fast successful response has a short transition");
    timers.delete(visual[0]); visual[1].fn();
  };

  let tree = render();
  const cleanup = effects[0]();
  assert.equal(tree.props["aria-label"], "SOC Insights");
  assert.match(JSON.stringify(tree), /AI-assisted academic briefing/);
  let pending = generateButton().props.onClick();
  await generateButton().props.onClick();
  assert.equal(requests.length, 1);
  tree = render();
  assert.equal(tree.props["data-generating"], true);
  assert.ok(nodes(tree).some(node => node.props?.className === "narrative-skeleton" && node.props["aria-hidden"] === "true"));
  const progress = nodes(tree).find(node => node.props?.role === "status");
  assert.equal(progress.props["aria-live"], "polite");
  assert.doesNotMatch(JSON.stringify(progress), /[0-9]+%|Analyzing|Fetching|Stage/);

  now = 100;
  requests[0].resolve(summary("fast"));
  await settle();
  assert.equal([...timers.values()][0].delay, 500, "only the remainder of 600ms is used");
  assert.equal(generateButton().props.disabled, true);
  assert.equal(nodes(render()).filter(node => node.type === "article").length, 0);
  filters.mode = "Online"; render();
  finishTransition(); await pending;
  assert.equal(nodes(render()).filter(node => node.type === "article").length, 0, "filters changing during transition invalidate the response");

  pending = generateButton().props.onClick();
  now += 1200;
  requests[1].resolve(summary("slow", { mode: "Online" }));
  await pending;
  assert.equal(timers.size, 0, "normal and slow responses have no artificial delay");
  tree = render();
  assert.match(JSON.stringify(tree), /Draft ready for Dean review/);
  assert.ok(nodes(tree).some(node => node.type === "article"));
  const approve = nodes(tree).find(node => node.props?.children === "I have reviewed and approve this narrative");
  pending = approve.props.onClick();
  requests[2].resolve({ ...summary("slow", { mode: "Online" }), reviewState: "reviewed", version: 2, reviewedAt: "2026-11-23T04:01:00Z" });
  await pending;
  assert.equal(timers.size, 0, "approval is never delayed for generation visuals");
  assert.match(JSON.stringify(render()), /Review completed/);

  pending = generateButton().props.onClick();
  requests[3].reject(new Error("offline"));
  await pending;
  assert.equal(timers.size, 0, "failures appear immediately");
  assert.equal(generateButton().props.children, "Try again");
  pending = generateButton().props.onClick();
  requests[4].reject({ code: "AI_EMPTY_DATASET" });
  await pending;
  assert.match(JSON.stringify(render()), /No report data for this selection/);
  assert.equal(generateButton().props.disabled, false);

  pending = generateButton().props.onClick();
  requests[5].resolve(summary("unmounted", { mode: "Online" }));
  await settle();
  cleanup();
  const before = stateWrites;
  finishTransition(); await pending;
  assert.equal(stateWrites, before, "unmounting during transition prevents state updates");

  const css = await readFile(new URL("../../client/src/components/dean/ReportNarrativePanel.css", import.meta.url), "utf8");
  assert.match(css, /@keyframes insights-shimmer/);
  assert.match(css, /@keyframes insights-reveal/);
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*animation: none !important; transition: none !important/);
  assert.doesNotMatch(css, /gradient|backdrop-filter/);
});
