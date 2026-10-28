import assert from "node:assert/strict";
import { test } from "node:test";
import jwt from "jsonwebtoken";
import app from "../src/app.js";
import { env } from "../src/config/env.js";
import Appointment from "../src/models/Appointment.js";
import Notification from "../src/models/Notification.js";
import User from "../src/models/User.js";
import { readFacultyDashboard } from "../src/services/facultyDashboardService.js";
import { attendanceEnrollment } from "../src/config/attendance.js";
import { publicNotification, facultyNotificationDestination } from "../src/services/notificationService.js";

const ids = { faculty: "507f1f77bcf86cd799439011", dean: "507f1f77bcf86cd799439012", student: "507f1f77bcf86cd799439013" };
const now = new Date("2026-10-19T16:00:00Z"); // Manila midnight, October 20.
const value = (row, key) => key.split(".").reduce((r, k) => r?.[k], row);
function expression(e, row) {
  if (typeof e === "string" && e.startsWith("$")) return value(row, e.slice(1));
  if (!e || typeof e !== "object" || e instanceof Date) return e;
  if (e.$and) return e.$and.every(x => expression(x, row));
  if (e.$eq) { const [a,b] = e.$eq.map(x => expression(x,row)); return String(a) === String(b); }
  if (e.$gt) { const [a,b] = e.$gt.map(x => expression(x,row)); return a > b; }
  if (e.$add) { const [a,b] = e.$add.map(x => expression(x,row)); return new Date(+a + b); }
  if (e.$in) return e.$in[1].includes(expression(e.$in[0],row));
  if (e.$ifNull) return row.category || (row.type === "registration" ? "Management" : /attendance/i.test(row.title) ? "Attendance" : "Consultation");
  throw Error("Unsupported expression");
}
function matches(row, filter) {
  return Object.entries(filter).every(([key, expected]) => {
    if (key === "$expr") return expression(expected,row);
    const actual = value(row,key);
    if (expected && typeof expected === "object" && !(expected instanceof Date) && !expected._bsontype) return Object.entries(expected).every(([op, x]) => {
      if (op === "$in") return x.includes(actual);
      if (op === "$nin") return !x.includes(actual);
      if (op === "$type") return actual instanceof Date;
      if (op === "$gt") return actual > x;
      if (op === "$gte") return actual >= x;
      if (op === "$lt") return actual < x;
      if (op === "$lte") return actual <= x;
      throw Error(op);
    });
    return String(actual) === String(expected);
  });
}
function harness(owner) {
  const restores = [], calls = [], responses = [];
  const patch = (o,k,v) => { const old=o[k]; o[k]=v; restores.push(()=>o[k]=old); };
  const rows = [];
  const add = (status,start,end,extra={}) => { const row={ _id:String(rows.length).padStart(24,"0"), faculty:owner, student:{name:"Student",email:"PRIVATE"}, subject:"Consultation",status,startAt:start,endAt:end,createdAt:new Date(+now+rows.length), meetingLink:"PRIVATE",reason:"PRIVATE",supportingDocuments:["PRIVATE"],...extra }; rows.push(row); return row; };
  const notices=[];
  const query = (items,kind) => {
    let sort={}, limit=Infinity;
    const q={ select(p) { calls.push(["select",kind,p]); return q; },populate(p) { assert.equal(p.select,"name firstName middleName lastName");return q; },sort(s){sort=s;return q;},limit(n){limit=n;calls.push(["limit",kind,n]);return q;},maxTimeMS(n){assert.equal(n,10000);return q;},lean(){return q;},then(resolve,reject){return Promise.resolve().then(()=>[...items].sort((a,b)=>{for(const [k,d] of Object.entries(sort)){if(a[k]<b[k])return -d;if(a[k]>b[k])return d;}return 0;}).slice(0,limit)).then(resolve,reject);} }; return q;
  };
  patch(Appointment,"find",filter=>{assert.equal(filter.faculty,owner); calls.push(["find",filter]);return query(rows.filter(r=>matches(r,filter)),"appointment");});
  patch(Appointment,"countDocuments",filter=>{assert.equal(filter.faculty,owner);return {maxTimeMS:()=>Promise.resolve(rows.filter(r=>matches(r,filter)).length)};});
  patch(Appointment,"aggregate",pipeline=>({option(options){assert.equal(options.maxTimeMS,10000);assert.equal(String(pipeline[0].$match.faculty),owner);assert.deepEqual(pipeline[1].$lookup.pipeline.at(-2),{$project:{_id:1}});const eligible=rows.filter(r=>matches(r,pipeline[0].$match)&&!responses.includes(r._id));return Promise.resolve([{count:eligible.length}]);}}));
  patch(Notification,"find",filter=>{assert.equal(filter.recipient,owner);return query(notices.filter(r=>matches(r,filter)),"notification");});
  for(const model of [Appointment,Notification]) for(const method of ["create","updateOne","updateMany","findOneAndUpdate","deleteMany"]) patch(model,method,()=>{throw Error("GET mutation");});
  patch(User,"findById",async id=>({id,_id:id,role:Object.keys(ids).find(k=>ids[k]===id),accountStatus:"Active",registrationStatus:"Approved"}));
  return {rows,add,notices,responses,calls,restore:()=>restores.reverse().forEach(f=>f())};
}

test("Faculty and Dean exact boundaries, enrollment/response eligibility, safe bounded summaries and personal notifications",async()=>{
  for(const role of ["faculty","dean"]){
    const h=harness(ids[role]);
    try {
      h.add("Pending",null,null);h.add("Pending",new Date(+now-1000),now);
      for(let i=0;i<5;i++)h.add("Pending",null,null);
      h.add("Reschedule Proposed",new Date(+now+1000),new Date(+now+2000));
      h.add("Confirmed",now,new Date(+now+1000)); // in progress, not upcoming
      const next=h.add("Confirmed",new Date(+now+1),new Date(+now+2000));
      h.add("Confirmed",new Date(+now+1),new Date(+now+2000));
      const ended=new Date(+now-3600000), start=new Date(+ended-3600000);
      const eligible=h.add("Confirmed",start,ended,{attendance:attendanceEnrollment(ended)});
      h.add("Awaiting Attendance Update",start,ended,{attendance:attendanceEnrollment(ended)});
      // Opens inclusively at endAt; the cached responded flag is not authoritative.
      h.add("Confirmed",new Date(+now-1000),now,{attendance:{...attendanceEnrollment(now),facultyResponded:true}});
      const responded=h.add("Awaiting Attendance Update",start,ended,{attendance:attendanceEnrollment(ended)});h.responses.push(responded._id);
      h.add("Confirmed",start,ended); // legacy, not enrolled
      h.add("Confirmed",start,ended,{attendance:{...attendanceEnrollment(ended),policyVersion:"other"}});
      const deadlineEnd=new Date(+now-48*3600000);
      h.add("Awaiting Attendance Update",new Date(+deadlineEnd-1000),deadlineEnd,{attendance:attendanceEnrollment(deadlineEnd)});
      h.add("Confirmed",start,ended,{attendance:{...attendanceEnrollment(ended),attendanceOpensAt:now}});
      h.add("Confirmed",null,ended,{attendance:attendanceEnrollment(ended)});
      h.add("Confirmed",now,new Date(+now+1000),{faculty:ids.student});
      for(let i=0;i<12;i++)h.add(i%2?"Completed":"Attendance Review",new Date(+now+100+i),new Date(+now+2000));
      h.add("Completed",new Date(+now+86400000),new Date(+now+86401000));
      for(let i=0;i<8;i++)h.notices.push({_id:String(i),recipient:ids[role],type:"appointment",category:"Consultation",title:"Personal",message:"Update",actionUrl:"/faculty/appointments",createdAt:new Date(i)});
      for(const [category,actionUrl,type] of [["Attendance","/dean/attendance-review/abc","attendance_review_created"],["Management","/dean/users","account_created"],["Report","/dean/reports","ai_summary_failed"],["Consultation",undefined,"appointment"],["Consultation","https://evil.test","appointment"]]) h.notices.push({_id:type,recipient:ids[role],category,actionUrl,type,createdAt:now});
      h.notices.push({_id:"other",recipient:ids.student,category:"Consultation",type:"appointment",actionUrl:"/faculty/appointments",createdAt:now});
      const before=JSON.stringify(h.rows);
      const data=await readFacultyDashboard({id:ids[role],role},now);
      assert.equal(data.pendingCount,7);assert.equal(data.upcomingCount,2);assert.equal(data.attendanceRequiredCount,3);
      assert.equal(data.nextConsultation._id,next._id);assert.equal(data.todayTotal,15);assert.equal(data.todayConsultations.length,10);
      assert.equal(data.recentRequests.length,5);assert.equal(data.recentNotifications.length,5);
      assert.equal(data.recentNotifications[0]._id,"7");assert.ok(data.recentNotifications.every(n=>n.actionUrl===(role==="dean"?"/dean/faculty/consultations":"/faculty/consultations")));
      assert.doesNotMatch(JSON.stringify(data),/PRIVATE|meetingLink|supportingDocuments|email|ownResponse|reason/);
      assert.equal(JSON.stringify(h.rows),before);assert.equal(h.rows.find(r=>r._id===eligible._id).status,"Confirmed");
      assert.ok(h.calls.some(c=>c[0]==="limit"&&c[2]===10));assert.ok(h.calls.filter(c=>c[0]==="select"&&c[1]==="appointment").every(c=>c[2]==="student subject status startAt endAt consultationMode createdAt"));
    } finally {h.restore();}
  }
});

test("authenticated dashboard denies unsupported roles and client ownership parameters; no-store on success and denial",async()=>{
 const h=harness(ids.faculty);
 const server=await new Promise(resolve=>{const s=app.listen(0,"127.0.0.1",()=>resolve(s));});
 const request=(role,suffix="")=>fetch(`http://127.0.0.1:${server.address().port}/api/dashboard/faculty${suffix}`,{headers:{Connection:"close",...(role?{Authorization:`Bearer ${jwt.sign({sub:ids[role]},env.jwtSecret)}`}:{})}});
 try{
   for(const [role,suffix,status] of [[null,"",401],["student","",403],["faculty","?facultyId="+ids.dean,400],["dean","?owner="+ids.faculty,400],["faculty","",200]]){
    const res=await request(role,suffix);assert.equal(res.status,status);assert.equal(res.headers.get("cache-control"),"no-store");
   }
 }finally{await new Promise(r=>server.close(r));h.restore();}
});

test("Faculty and Dean dashboard links match notification-center event destinations and retain appointment references", async () => {
  for (const role of ["faculty", "dean"]) {
    const h = harness(ids[role]);
    const base = role === "dean" ? "/dean/faculty" : "/faculty";
    const user = { id: ids[role], role };
    const appointment = "507f1f77bcf86cd799439099";
    try {
      for (const [type, destination] of [["faculty_request_submitted", "requests"],
        ["faculty_proposal_declined", "requests"], ["faculty_finalized", "history"],
        ["faculty_attendance_review", "history"], ["faculty_upcoming_reminder", "consultations"]]) {
        const notice = { _id: type, recipient: user.id, type, category: "Consultation", relatedEntityId: appointment,
          actionUrl: role === "dean" ? "/dean/faculty/consultations" : "/faculty/appointments", createdAt: now };
        h.notices.push(notice);
        const expected = `${base}/${destination}?appointment=${appointment}`;
        assert.equal(publicNotification(notice, user).actionUrl, expected);
        assert.equal(facultyNotificationDestination({ ...notice, actionUrl: expected }, user), expected);
      }
      const result = await readFacultyDashboard(user, now);
      for (const notice of result.recentNotifications) {
        const source = h.notices.find(row => row._id === notice._id);
        assert.equal(notice.actionUrl, publicNotification(source, user).actionUrl);
        assert.ok(notice.actionUrl.startsWith(base + "/"));
        assert.ok(notice.actionUrl.endsWith(`?appointment=${appointment}`));
      }
      assert.equal(result.recentNotifications.length, 5);
      for (const path of ["/dean/users", "/dean/consultations", "/dean/attendance-review", "https://evil.test", `${base}/history?appointment=bad`])
        assert.equal(facultyNotificationDestination({ type: "faculty_finalized", actionUrl: path, relatedEntityId: appointment }, user), undefined);
      assert.equal(facultyNotificationDestination({ type: "faculty_finalized", actionUrl: base + "/history", relatedEntityId: "bad" }, user), undefined);
    } finally { h.restore(); }
  }
});
