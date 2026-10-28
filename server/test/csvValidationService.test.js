import assert from "node:assert/strict";
import { test } from "node:test";
import { validateCsv } from "../src/services/csvValidationService.js";
import { accountImportConfig } from "../src/config/accountImport.js";
const header = "institutional_id,first_name,last_name,official_email,role";
const student = "000123,Juan,Santos,juan@student.hau.edu.ph,student";
const options = {
  studentDomain: "student.hau.edu.ph",
  facultyDomain: "hau.edu.ph",
  findUsers: async () => [],
};
const run = (text, extra = {}) =>
  validateCsv(Buffer.from(text), { ...options, ...extra });

test("valid optional columns, leading zeros, normalization and roles", async () => {
  const result = await run(
    `\uFEFF Institutional-ID , First Name , Last Name , Official Email , ROLE\r\n${student}\r\nFAC-001,Maria,Reyes,MARIA@HAU.EDU.PH, FACULTY `,
  );
  assert.equal(result.canConfirm, true);
  assert.equal(result.rows[0].institutional_id, "000123");
  assert.equal(result.rows[0].middle_name, "");
  assert.equal(result.rows[1].official_email, "maria@hau.edu.ph");
  assert.deepEqual(result.summary, {
    totalRows: 2,
    validRows: 2,
    invalidRows: 0,
    duplicateRows: 0,
  });
  assert.equal(
    (await run(`${header},middle_name\n${student},`)).canConfirm,
    true,
  );
});
test("structural failures, binary, encoding, malformed quotes and limits", async () => {
  for (const text of [
    "",
    header,
    `first_name\nJuan`,
    `${header},ROLE\n${student},student`,
    `${header},unknown\n${student},x`,
    `${header}\n\"unterminated`,
    `${header}\n\x00`,
  ])
    await assert.rejects(run(text));
  await assert.rejects(validateCsv(Buffer.from([255, 254]), options));
  await assert.rejects(
    run(`${header}\n${student}`, {
      config: { ...accountImportConfig, maxBytes: 10 },
    }),
  );
  await assert.rejects(
    run(`${header}\n${student}\n${student}`, {
      config: { ...accountImportConfig, maxRows: 1 },
    }),
  );
  await assert.rejects(
    run(`${header}\n${student}`, {
      config: { ...accountImportConfig, maxRecordSize: 5 },
    }),
  );
});
test("quoted commas, escaped quotes and multiline fields parse without skipping invalid rows", async () => {
  const result = await run(
    `${header}\n0001,"Juan, Jr.",Santos,j@ student.hau.edu.ph,dean\n0002,"Ju\"\"an\nOther",Santos,x@student.hau.edu.ph,student\nshort,row`,
  );
  assert.equal(result.rows.length, 3);
  assert.equal(result.rows[0].first_name, "Juan, Jr.");
  assert.equal(result.rows[1].first_name, 'Ju"an\nOther');
  assert.equal(result.rows[1].rowNumber, 3);
  assert.equal(result.rows[1].endLineNumber, 4);
  assert.equal(result.rows[2].rowNumber, 5);
  assert.ok(result.rows.every((r) => !r.valid));
});
test("all duplicate/conflict rows counted once across both identifiers and email", async () => {
  const result = await run(
    `${header}\n${student}\n${student}\nFAC-001,Maria,Reyes,m@hau.edu.ph,faculty`,
    {
      findUsers: async (ids, emails) => {
        assert.deepEqual(ids, ["000123", "FAC-001"]);
        assert.deepEqual(emails, ["juan@student.hau.edu.ph", "m@hau.edu.ph"]);
        return [
          { employeeId: "000123", studentId: "FAC-001", email: "m@hau.edu.ph" },
        ];
      },
    },
  );
  assert.deepEqual(result.summary, {
    totalRows: 3,
    validRows: 0,
    invalidRows: 3,
    duplicateRows: 3,
  });
  assert.ok(result.rows[0].errors.length >= 3);
  assert.equal(result.canConfirm, false);
});
test("required fields, invalid emails, domains, names and forbidden roles", async () => {
  for (const row of [
    ",,,,,",
    "x,123,Santos,invalid,student",
    "x,Juan,Santos,x@hau.edu.ph,student",
    "x,Juan,Santos,x@student.hau.edu.ph,dean",
    "x,Juan,Santos,x@student.hau.edu.ph,staff",
  ]) {
    const result = await run(`${header}\n${row}`);
    assert.equal(result.canConfirm, false);
    assert.ok(result.rows[0].errors.length);
  }
});

test("200-account ceiling and bcrypt UTF-8 boundary", async () => {
  const records = Array.from({ length: 200 }, (_, i) => `${i},Juan,Santos,j${i}@student.hau.edu.ph,student`);
  assert.equal((await run(`${header}\n${records.join("\n")}`)).summary.validRows, 200);
  await assert.rejects(run(`${header}\n${records.join("\n")}\n${student}`), /data row limit/);
  for (const id of ["x".repeat(72), "界".repeat(24)])
    assert.equal((await run(`${header}\n${id},Juan,Santos,j@student.hau.edu.ph,student`)).canConfirm, true);
  for (const id of ["x".repeat(73), "界".repeat(25)])
    assert.ok((await run(`${header}\n${id},Juan,Santos,j@student.hau.edu.ph,student`)).rows[0].errors.some((e) => e.code === "ID_LENGTH"));
});
