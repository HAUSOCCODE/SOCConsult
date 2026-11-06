import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import User from "../src/models/User.js";
import { searchEligibleStudents } from "../src/services/facultyInitiatedConsultationService.js";

const source = path => readFile(new URL(`../../client/src/${path}`, import.meta.url), "utf8");

test("Student and Faculty navigation use the requested unified order without duplicate request entries", async () => {
  const [student, faculty, dean, app] = await Promise.all([
    source("layouts/StudentLayout.jsx"), source("layouts/FacultyLayout.jsx"),
    source("layouts/DeanLayout.jsx"), source("App.jsx"),
  ]);
  const labels = value => [...value.matchAll(/label: "([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(labels(student), ["Dashboard", "Find Faculty", "Availability", "Calendar", "Consultations / Requests", "Consultation History", "Notifications", "Account Settings"]);
  assert.deepEqual(labels(faculty), ["Dashboard", "Find Student", "Availability", "Calendar", "Consultations / Requests", "Consultation History", "Reports", "Notifications", "Account Settings"]);
  assert.deepEqual(labels(dean).slice(6, 15), ["Dashboard", "Find Student", "Availability", "Calendar", "Consultations / Requests", "Consultation History", "Reports", "Notifications", "Account Settings"]);
  assert.doesNotMatch(student, /My Availability|My Consultations/);
  assert.doesNotMatch(faculty, /label: "Consultation Requests"|label: "My Consultations"/);
  assert.match(app, /path="students" element=\{<FindStudent/);
  assert.match(app, /path="requests" element=\{<DeanRouteRedirect to="\/faculty\/consultations"/);
  assert.match(app, /to="\/dean\/faculty\/consultations"/);
});

test("Find Student reuses a bounded, eligible, privacy-minimized directory and preselects FAC-21 requests", async () => {
  const original = User.find, originalCount = User.countDocuments; let filter, selected, sorted, limited, skipped;
  User.find = value => {
    filter = value;
    const chain = { select(value) { selected = value; return chain; }, sort(value) { sorted = value; return chain; },
      skip(value) { skipped = value; return chain; }, limit(value) { limited = value; return chain; },
      async lean() { return [{ _id: "507f1f77bcf86cd799439011", name: "Eligible Student", program: "BSCS", yearLevel: "3", studentId: "masked-in-ui" }]; } };
    return chain;
  };
  User.countDocuments = value => { assert.equal(value, filter); return { maxTimeMS: async () => 13 }; };
  try {
    const result = await searchEligibleStudents({ faculty: "507f1f77bcf86cd799439012", input: { q: "Eligible", page: "2" } });
    assert.deepEqual({ role: filter.role, accountStatus: filter.accountStatus, registrationStatus: filter.registrationStatus },
      { role: "student", accountStatus: "Active", registrationStatus: "Approved" });
    assert.equal(selected, "name program yearLevel studentId institutionalId"); assert.deepEqual(sorted, { name: 1, _id: 1 });
    assert.equal(skipped, 12); assert.equal(limited, 12);
    assert.deepEqual(result.students.map(student => ({ id: student.id, name: student.name })), [{ id: "507f1f77bcf86cd799439011", name: "Eligible Student" }]);
    assert.deepEqual(result.pagination, { page: 2, limit: 12, total: 13, totalPages: 2 });
  } finally { User.find = original; User.countDocuments = originalCount; }
  const [page, modal, card] = await Promise.all([
    source("pages/Faculty/FindStudent.jsx"),
    source("components/appointments/FacultyConsultationRequestModal.jsx"),
    source("components/faculty/StudentDirectoryCard.jsx"),
  ]);
  assert.match(page, /Browse eligible Students and request consultations/); assert.match(card, /Request Consultation/);
  assert.match(page, /useEffect\(\(\) => \{ void load\(\)/); assert.match(page, /Loading Students\.\.\./);
  assert.match(page, /No eligible Students are currently available/); assert.match(page, /No Students match your search/);
  assert.match(page, /setAppliedQuery\(value\)/); assert.match(page, /Student directory pagination/);
  assert.match(page, /Search Student name, program, or year level/); assert.match(page, /StudentDirectoryCard/);
  assert.doesNotMatch(page, /email|password|private availability/i);
  assert.match(page, /initialStudent=\{selected\}/); assert.match(modal, /studentId: initialStudent\.id/);
});

test("Find Student supports an initial unfiltered page and rejects unsafe or unbounded directory queries", async () => {
  const originalFind = User.find, originalCount = User.countDocuments; let filter;
  User.find = value => { filter = value; const chain = { select() { return chain; }, sort() { return chain; }, skip() { return chain; }, limit() { return chain; }, async lean() { return []; } }; return chain; };
  User.countDocuments = value => { assert.equal(value, filter); return { maxTimeMS: async () => 0 }; };
  try {
    const result = await searchEligibleStudents({ faculty: "507f1f77bcf86cd799439012", input: { page: "1" } });
    assert.equal(filter.$or, undefined); assert.deepEqual(result.pagination, { page: 1, limit: 12, total: 0, totalPages: 0 });
    for (const input of [{ q: "x" }, { page: "0" }, { page: "10001" }, { page: ["1"] }, { ownerId: "507f1f77bcf86cd799439012" }])
      await assert.rejects(searchEligibleStudents({ faculty: "507f1f77bcf86cd799439012", input }), error => error.statusCode === 400);
  } finally { User.find = originalFind; User.countDocuments = originalCount; }
});

test("unified consultation views classify request direction without changing lifecycle statuses", async () => {
  const [student, faculty] = await Promise.all([
    source("components/appointments/StudentConsultationsView.jsx"),
    source("components/appointments/FacultyConsultationsView.jsx"),
  ]);
  for (const label of ["All", "Incoming Requests", "Sent Requests", "Upcoming Consultations", "Reschedule Proposals"]) {
    assert.match(student, new RegExp(label)); assert.match(faculty, new RegExp(label));
  }
  assert.match(student, /initiatedByRole === "faculty"/);
  assert.match(student, /status === "Confirmed"/);
  assert.match(student, /status === "Reschedule Proposed"/);
  assert.match(faculty, /<AppointmentRequests embedded/);
  assert.doesNotMatch(student + faculty, /status:\s*"Incoming|status:\s*"Sent/);
});

test("Find Student mirrors the responsive Find Faculty directory structure without exposing private data", async () => {
  const [page, studentCard, facultyCard] = await Promise.all([
    source("pages/Faculty/FindStudent.jsx"), source("components/faculty/StudentDirectoryCard.jsx"),
    source("components/student/FacultyCard.jsx"),
  ]);
  for (const contract of ["rounded-xl border border-maroon-100 bg-white p-4 shadow-sm", "field h-11 py-2 pl-11 sm:h-12", "grid-cols-[minmax(0,1fr)_auto]"])
    assert.match(page, new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  for (const contract of ["rounded-xl border bg-white p-4 shadow-sm", "sm:flex-row sm:items-center", "sm:w-48", "sm:border-l", "min-h-10 w-full"])
    assert.equal(studentCard.includes(contract), facultyCard.includes(contract), contract);
  assert.match(studentCard, /Request Consultation/); assert.match(studentCard, /UserAvatar/);
  assert.doesNotMatch(studentCard + page, /email|contactNumber|private availability|password/i);
});
