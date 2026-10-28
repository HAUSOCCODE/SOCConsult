import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../client/package.json', import.meta.url));
const React = require('react'), { transform } = require('esbuild');
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
async function load(path, name, imports) {
  let index = 0; const state = [], effects = [];
  const hooks = { useState(initial) { const i = index++; if (!(i in state)) state[i] = initial; return [state[i], value => state[i] = value]; }, useRef(initial) { const i = index++; return state[i] ??= { current: initial }; }, useEffect(fn) { effects.push(fn); }, createContext: () => ({ Provider: 'provider' }), useContext: () => ({}) };
  const raw = await readFile(new URL(`../../client/src/${path}`, import.meta.url), 'utf8');
  const body = raw.replace(/^import[\s\S]*?from\s+["'][^"']+["'];?/gm, '').replaceAll('export default function', 'function').replaceAll('export function', 'function').replaceAll('export const', 'const');
  const code = (await transform(body, { loader: 'jsx' })).code;
  const deps = { ...hooks, ...imports };
  const Component = new Function('React', ...Object.keys(deps), `${code}; return ${name};`)(React, ...Object.values(deps));
  return { render(props) { index = 0; effects.length = 0; return Component(props); }, effects };
}
test('Faculty form preserves exact password, prevents same-tick submits, and waits for session hydration', async () => {
  let loading = true, calls = 0, finish; const navigations = [];
  const h = await load('components/auth/AuthPageContent.jsx', 'AuthPageContent', { useParams: () => ({}), useNavigate: () => value => navigations.push(value), useAuth: () => ({ loading, login: async (role, credentials) => { calls++; assert.equal(role, 'faculty'); assert.equal(credentials.password, ' initial '); await new Promise(resolve => finish = resolve); return { role: 'faculty' }; } }), Link: 'link', Navigate: 'navigate', Brand: 'brand', ArrowLeft: 'icon', Eye: 'icon', EyeOff: 'icon' });
  const render = () => h.render({ role: 'faculty' });
  let tree = render(); const inputs = nodes(tree).filter(n => n.type === 'input');
  inputs[0].props.onChange({ target: { value: 'OFFICIAL@HAU.EDU.PH' } }); tree = render();
  nodes(tree).filter(n => n.type === 'input')[1].props.onChange({ target: { value: ' initial ' } });
  const submit = () => nodes(render()).find(n => n.type === 'form').props.onSubmit({ preventDefault() {} });
  await submit(); assert.equal(calls, 0); loading = false;
  const first = submit(); await submit(); assert.equal(calls, 1); finish(); await first; assert.deepEqual(navigations, ['/faculty/dashboard']);
});
test('Faculty recommendation persists across hydration and clears after password change and logout', async () => {
  const storage = new Map(); globalThis.sessionStorage = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) }; globalThis.localStorage = { removeItem() {} };
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  const user = { id: 'faculty-id', role: 'faculty' }; let loginCalls = 0;
  const api = async path => path === '/auth/login/faculty' ? (loginCalls++, { user, token: 'session', recommendPasswordChange: true }) : { user };
  try {
    const h = await load('context/AuthContext.jsx', 'AuthProvider', { api });
    await h.render({}).props.value.login('faculty', {});
    assert.equal(h.render({}).props.value.recommendPasswordChange, true);
    const refreshed = await load('context/AuthContext.jsx', 'AuthProvider', { api }); refreshed.render({}); refreshed.effects[0](); await new Promise(resolve => setImmediate(resolve));
    assert.equal(refreshed.render({}).props.value.recommendPasswordChange, true); assert.equal(loginCalls, 1);
    refreshed.render({}).props.value.clearPasswordRecommendation(); assert.equal(refreshed.render({}).props.value.recommendPasswordChange, false);
    await refreshed.render({}).props.value.login('faculty', {}); await refreshed.render({}).props.value.logout(); assert.equal(storage.size, 0); assert.equal(refreshed.render({}).props.value.user, null);
    const layout = await load('layouts/FacultyLayout.jsx', 'FacultyLayout', { useAuth: () => ({ user, recommendPasswordChange: true }), useLocation: () => ({}), Link: 'link', Navigate: 'navigate', RoleLayout: 'layout', legacyFacultyDestination() {}, Bell: 0, CalendarClock: 0, CalendarDays: 0, ClipboardList: 0, History: 0, LayoutDashboard: 0, UserRound: 0, FileBarChart: 0 });
    const tree = layout.render(); assert.equal(nodes(tree).find(n => n.type === 'link').props.to, '/faculty/account'); assert.ok(nodes(tree).some(n => n.type === 'layout'));
  } finally { delete globalThis.sessionStorage; delete globalThis.localStorage; delete globalThis.window; }
});
