import assert from "node:assert/strict";
import { test } from "node:test";
import { transitionAppointment } from "../src/services/appointmentTransitionService.js";
import { appointmentHttp } from "./helpers/appointmentHttp.js";
import { appointmentHarness, fixture, addSlot, clone, newId } from "./helpers/appointmentHarness.js";
import { env } from "../src/config/env.js";
import { setEmailTransportFactoryForTests, resetEmailTransportFactoryForTests } from "../src/services/emailService.js";
const schedule = { startAt: new Date("2099-02-01T02:00:00Z"), endAt: new Date("2099-02-01T02:30:00Z"), mode: "Face-to-Face", location: "Room 1" };
const faculty = r => ({ id: r.faculty, role: "faculty" });

test("FAC-06 repeated propose/decline cycles notify per committed version, retry once, and email only after commit", async () => {
  const h = appointmentHarness(), previous = { ...env }; let deliveries = 0;
  try {
    Object.assign(env, { smtpHost: "isolated.test", smtpUser: "test", smtpPass: "test", emailFrom: "test@example.test" });
    setEmailTransportFactoryForTests(() => ({ sendMail: async () => { deliveries++; assert.ok(h.state.audits.length > 0); throw new Error("private SMTP failure"); } }));
    const r = fixture(); h.state.appointments.push(r); addSlot(h,r);
    h.state.users.push({ _id: r.student, email: "student@example.test", role: "student" });
    h.fail("notifications");
    await assert.rejects(transitionAppointment({id:r._id, actor:faculty(r), action:"propose", reason:"Schedule change", schedule}));
    assert.equal(deliveries,0); assert.equal(h.state.audits.length,0); h.fail(null);
    for (let cycle = 0; cycle < 2; cycle++) {
      h.retry();
      const proposed = await transitionAppointment({ id:r._id, actor:faculty(r), action:"propose", reason:"<b>Schedule change</b>", schedule, expectedVersion: cycle*2 });
      assert.equal(h.state.holds.length, 0); assert.equal(h.state.slots[0].reservationToken,r.reservationToken);
      assert.equal(proposed.startAt.getTime(),r.startAt.getTime());
      await transitionAppointment({ id:r._id, actor:{id:r.student,role:"student"}, action:"reject_proposal", expectedProposalAt:proposed.proposedAt, expectedVersion:cycle*2+1 });
    }
    assert.equal(h.state.notifications.length,6); assert.equal(deliveries,4);
    const keys=h.state.notifications.filter(n=>n.recipient===r.student).map(n=>n.deduplicationKey);
    assert.equal(new Set(keys).size,4); assert.ok(keys.every(k=>/:v[1-4]$/.test(k)));
    assert.equal(h.state.appointments[0].status,"Pending");
    assert.doesNotMatch(JSON.stringify(h.state.audits),/Schedule change/);
    await transitionAppointment({id:r._id,actor:faculty(r),action:"confirm",expectedVersion:4});
    assert.equal(h.state.slots[0].reservationToken,r.reservationToken); assert.equal(h.state.holds.length,30);
    assert.equal(deliveries,5);
  } finally { h.restore(); Object.assign(env, previous); resetEmailTransportFactoryForTests(); }
});

for (const role of ["faculty","dean"]) test(`FAC-06 ${role} decisions enforce ownership, reasons, conflicts, stale versions and rejection finality`,async()=>{
  const h=await appointmentHttp();
  try {
    const r=fixture({faculty:h.users[role].id,student:h.users.student.id});h.state.appointments.push(r);addSlot(h,r);
    const path=`/appointments/${r._id}/status`;
    assert.equal((await h.request(path,"student","PUT",{status:"Confirmed"})).status,403);
    assert.equal((await h.request(path,"otherFaculty","PUT",{status:"Confirmed"})).status,404);
    for(const reason of ["", "<b></b>", "x".repeat(501)]) assert.equal((await h.request(path,role,"PUT",{status:"Rejected",reason,expectedVersion:0})).status,400);
    const proposalPath=`/faculty/appointments/${r._id}/reschedule`;
    const body={consultationDate:"2099-02-01",startTime:"10:00",duration:30,mode:"Face-to-Face",location:"Room 1",reason:"Change schedule",expectedVersion:0};
    assert.equal((await h.request(proposalPath,role,"PATCH",{...body,consultationDate:"2020-01-01"})).status,400);
    assert.equal((await h.request(proposalPath,role,"PATCH",{...body,expectedVersion:9})).status,409);
    const conflict=fixture({student:r.student,faculty:newId(),startAt:schedule.startAt,endAt:schedule.endAt}); h.state.appointments.push(conflict);
    assert.equal((await h.request(proposalPath,role,"PATCH",body)).status,409);h.state.appointments.pop();
    const result=await h.request(path,role,"PUT",{status:"Rejected",reason:"<b>Unavailable</b>",expectedVersion:0});assert.equal(result.status,200);
    assert.equal(h.state.appointments[0].responseNote,"Unavailable");assert.equal(h.state.slots[0].reservationToken,undefined);
    assert.equal((await h.request(path,role,"PUT",{status:"Confirmed",expectedVersion:1})).status,409);
  } finally {await h.close();}
});

test("FAC-06 rejection preserves foreign reservation tokens and rolls back all writes on notification failure",async()=>{
 const h=appointmentHarness();try{
  const r=fixture();h.state.appointments.push(r);addSlot(h,r);h.state.slots[0].reservationToken="foreign";
  const foreign={appointment:newId(),faculty:newId(),student:newId(),minute:1,expiresAt:schedule.endAt};h.state.holds.push(foreign);
  const before=clone(h.state);h.fail("notifications");await assert.rejects(transitionAppointment({id:r._id,actor:faculty(r),action:"reject",reason:"Unavailable"}));assert.deepEqual(h.state,before);
  h.fail(null);await transitionAppointment({id:r._id,actor:faculty(r),action:"reject",reason:"Unavailable"});assert.equal(h.state.slots[0].reservationToken,"foreign");assert.deepEqual(h.state.holds,[foreign]);
 }finally{h.restore();}
});
