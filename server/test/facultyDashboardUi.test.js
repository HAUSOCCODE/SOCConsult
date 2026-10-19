import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
const require=createRequire(new URL("../../client/package.json",import.meta.url));
const React=require("react"),{renderToStaticMarkup}=require("react-dom/server"),{transform}=require("esbuild");
const settle=()=>new Promise(r=>setImmediate(r));
const data={asOf:"2026-10-19T00:00:00Z",pendingCount:0,upcomingCount:0,attendanceRequiredCount:0,nextConsultation:null,todayTotal:0,todayConsultations:[],recentRequests:[],recentNotifications:[]};
async function harness(){
 const raw=await readFile(new URL("../../client/src/pages/Faculty/FacultyDashboard.jsx",import.meta.url),"utf8");
 const compiled=await transform(raw.replace(/^import.*$/gm,"").replace("export default function","function"),{loader:"jsx"});
 const state=[],effects=[],pending=[],listeners={};let slot=0;
 const imports={useState:initial=>{const i=slot++;if(!(i in state))state[i]=initial;return[state[i],v=>state[i]=typeof v==="function"?v(state[i]):v];},useEffect:fn=>effects.push(fn),useAuth:()=>({user:{id:"faculty",name:"Faculty"}}),Link:({to,children,...p})=>React.createElement("a",{...p,href:to},children),Loading:()=>React.createElement("p",null,"Loading dashboard"),ErrorState:({message,onRetry})=>React.createElement("button",{onClick:onRetry},message),EmptyState:({title})=>React.createElement("p",null,title),StatusBadge:({status})=>React.createElement("span",null,status),formatPersonName:()=>"Faculty",formatManilaDateTime:v=>v,api:(path,options)=>new Promise((resolve,reject)=>pending.push({path,options,resolve,reject})),window:{addEventListener:(k,v)=>listeners[k]=v,removeEventListener:k=>delete listeners[k]},setInterval:()=>1,clearInterval:()=>{}};
 const Component=new Function("React",...Object.keys(imports),`${compiled.code};return FacultyDashboard;`)(React,...Object.values(imports));
 return{state,effects,pending,listeners,render:(props)=>{slot=0;effects.length=0;return Component(props || {});},html:tree=>renderToStaticMarkup(tree)};
}
function elements(t){if(!t||typeof t!=="object")return[];if(Array.isArray(t))return t.flatMap(elements);return[t,...elements(t.props?.children)];}
test("Faculty and Dean dashboard renders empty states, counts, safe workspace links and in-progress boundaries",async()=>{
 for(const routeBase of ["/faculty","/dean/faculty"]){const h=await harness();assert.match(h.html(h.render({routeBase})),/Loading dashboard/);const cleanup=h.effects[0]();h.pending[0].resolve(data);await settle();let html=h.html(h.render({routeBase}));for(const text of ["No Pending requests","No consultations today","No personal notifications","No upcoming Confirmed consultation","Attendance responses required","Asia/Manila"])assert.ok(html.includes(text));assert.ok(html.includes(`href="${routeBase}/availability"`));assert.ok(html.includes(`href="${routeBase}/requests"`));assert.ok(html.includes(routeBase==="/faculty"?'/faculty/notifications':'/dean/notifications?workspace=faculty'));assert.doesNotMatch(html,/Action Items|Rankings|AI Assistant/);
 h.listeners["notifications:updated"]();h.pending[1].resolve({...data,todayTotal:11,todayConsultations:[{_id:"x",subject:"Boundary",studentName:"Student",status:"Confirmed",startAt:data.asOf,endAt:"2026-10-19T01:00:00Z"}]});await settle();html=h.html(h.render({routeBase}));assert.match(html,/In progress/);assert.match(html,/Showing 1 of 11/);cleanup();}
});
test("retry hides raw errors and overlapping or cleaned-up responses cannot replace newer data",async()=>{
 const h=await harness();h.render();let cleanup=h.effects[0]();h.pending[0].reject(Error("PRIVATE"));await settle();let tree=h.render();assert.match(h.html(tree),/Unable to load/);assert.doesNotMatch(h.html(tree),/PRIVATE/);elements(tree).find(e=>e.props?.onRetry).props.onRetry();cleanup();h.render();cleanup=h.effects[0]();h.listeners["notifications:updated"]();assert.equal(h.pending[1].options.signal.aborted,true);h.pending[2].resolve({...data,pendingCount:9});await settle();h.pending[1].resolve({...data,pendingCount:99});await settle();assert.equal(h.state[0].data.pendingCount,9);assert.equal(h.pending[2].options.cache,"no-store");cleanup();assert.equal(h.pending[2].options.signal.aborted,true);assert.equal(h.listeners["notifications:updated"],undefined);
});
