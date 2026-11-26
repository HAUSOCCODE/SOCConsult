import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(new URL("../../client/package.json", import.meta.url));
const React = require("react");
const { transform } = require("esbuild");

function elements(node) {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement(node)) return [];
  return [node, ...elements(node.props.children)];
}

test("cached Faculty schedules render after a different provider's request fails", async () => {
  const raw = await readFile(new URL("../../client/src/pages/Student/FindFaculty.jsx", import.meta.url), "utf8");
  const { code } = await transform(raw.replace(/^import[\s\S]*?;\r?$/gm, "")
    .replace("export default function", "function"), { loader: "jsx" });
  const providers = [{ _id: "a", name: "Provider A" }, { _id: "b", name: "Provider B" }];
  const state = [], refs = [], effects = [], requests = [];
  let stateIndex = 0, refIndex = 0;
  const imports = {
    React,
    useState(initial) {
      const index = stateIndex++;
      if (!(index in state)) state[index] = initial;
      return [state[index], value => { state[index] = value; }];
    },
    useRef(initial) {
      const index = refIndex++;
      return refs[index] ??= { current: initial };
    },
    useEffect: effect => effects.push(effect),
    useMemo: compute => compute(),
    useToast() {}, useNavigate() {}, useDialogFocus() {},
    createPortal: node => node,
    document: { body: {} },
    window: { addEventListener() {}, removeEventListener() {} },
    Info: "span", Search: "span", X: "span", CalendarDays: "span",
    ProfileImagePreview: "div", FacultyCard: "article", ErrorState: "aside",
    formatPersonName: name => name,
    isRecoverableStudentError: () => true,
    safeStudentError: (_, message) => message,
    async api(path) {
      requests.push(path);
      if (path === "/availability/faculty") return { faculty: providers };
      if (path.endsWith("/b")) throw new Error("Schedule request failed");
      return { hasActiveStudentAvailability: true, schedules: [{
        _id: "slot-a", startAt: "2026-12-01T01:00:00Z", endAt: "2026-12-01T01:30:00Z",
        mode: "Online", meetingPlatform: "Provider A meeting platform", bookable: true,
      }] };
    },
  };
  const Component = new Function(...Object.keys(imports), `${code}; return FindFaculty;`)(...Object.values(imports));
  const render = () => { stateIndex = 0; refIndex = 0; return elements(Component()); };
  const settle = () => new Promise(resolve => setImmediate(resolve));
  const select = id => render().find(node => node.props.provider?._id === id).props.onViewAvailability(providers.find(provider => provider._id === id));
  const close = () => render().find(node => node.props["aria-label"] === "Close faculty availability").props.onClick();
  const hasSlot = () => render().some(node => node.props.children === "Select Schedule");

  render();
  const cleanup = effects[0]();
  try {
    await settle();
    select("a");
    await settle();
    assert.equal(hasSlot(), true);
    close();
    select("b");
    await settle();
    assert.ok(render().some(node => node.props.message === "Unable to load available schedules. Please try again."));
    close();
    select("a");
    assert.deepEqual(requests, ["/availability/faculty", "/availability/faculty/a", "/availability/faculty/b"]);
    assert.equal(hasSlot(), true, "Provider A's cached slot should be selectable");
  } finally {
    cleanup();
  }
});
