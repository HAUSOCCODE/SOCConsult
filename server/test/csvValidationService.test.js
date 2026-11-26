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
    `${header},ROLE\n${student},student`,
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

const externalHeader = "Campus Email,Surname,Export Note,Local ID,Given Name";
const columns = [["institutional_id", 3], ["first_name", 4], ["last_name", 1], ["official_email", 0]];
const externalStudent = 'fictional.student@student.hau.edu.ph,Jacinto,"Sample, ""draft""\r\nsecond line",000065,Lucía';
const externalFaculty = "fictional.faculty@hau.edu.ph,Aguilar,,FAC-009,Renée";

test("header discovery returns only source labels and canonical suggestions, without checking accounts", async () => {
  const result = await run(`\uFEFF${externalHeader}, First-Name \r\n${externalStudent},Other`, {
    findUsers: async () => assert.fail("Header discovery must not query users"),
  });
  assert.deepEqual(result, {
    mappingRequired: true,
    headers: ["Campus Email", "Surname", "Export Note", "Local ID", "Given Name", "First-Name"],
    suggestedColumns: { first_name: 5 },
  });
  const reordered = "ROLE,Official Email,Last Name,First Name,Institutional ID";
  assert.equal((await run(`${reordered}\rstudent,test@student.hau.edu.ph,Sample,Test,00007`)).canConfirm, true);
  const extra = await run(`${header},Notes\n${student},unused`);
  assert.equal(extra.mappingRequired, true);
  assert.deepEqual(extra.suggestedColumns, { institutional_id: 0, first_name: 1, last_name: 2, official_email: 3, role: 4 });
});

test("mapped batches preserve physical lines and leading zeros and ignore unused quoted fields", async () => {
  for (const [batchRole, record, expectedId, firstName, lastLine] of [
    ["student", externalStudent, "000065", "Lucía", 3],
    ["faculty", externalFaculty, "FAC-009", "Renée", 2],
  ]) {
    const result = await run(`\uFEFF${externalHeader}\r\n${record}`, { mapping: { columns, batchRole } });
    assert.equal(result.canConfirm, true);
    const [row] = result.rows;
    assert.deepEqual([row.role, row.institutional_id, row.first_name, row.middle_name], [batchRole, expectedId, firstName, ""]);
    assert.deepEqual([row.rowNumber, row.endLineNumber, row.dataRowNumber], [2, lastLine, 1]);
    assert.equal(Object.hasOwn(row, "Export Note"), false);
  }
});

test("mapped role values take precedence and invalid roles or mapped values cannot bypass row validation", async () => {
  const result = await run([
    `${externalHeader},Job Category,Initial`,
    `${externalFaculty}, FACULTY ,Q.`,
    `${externalStudent},student,`,
    "invalid@example.test,Invalid,,BAD-1,123,Dean,",
    "invalid2@example.test,Invalid,,BAD-2,,Staff,",
    "invalid3@example.test,Invalid,,BAD-3,Test,student,",
    "short,row",
    "blank@example.test,Sample,,BAD-5,Test,,",
  ].join("\n"), { mapping: { columns: [...columns, ["role", 5], ["middle_name", 6]], batchRole: "student" } });
  assert.deepEqual(result.rows.slice(0, 2).map(({ role, middle_name, valid }) => [role, middle_name, valid]),
    [["faculty", "Q.", true], ["student", "", true]]);
  for (const [row, codes] of result.rows.slice(2).map((row, i) => [row, [
    ["INVALID_ROLE", "INVALID_NAME"], ["INVALID_ROLE", "REQUIRED"], ["EMAIL_DOMAIN"],
    ["COLUMN_COUNT"], ["INVALID_ROLE", "REQUIRED"],
  ][i]])) {
    assert.equal(row.valid, false);
    for (const code of codes) assert.ok(row.errors.some((error) => error.code === code), code);
  }
  assert.equal(result.canConfirm, false);
});

test("invalid header and mapping inputs fail before account lookup", async () => {
  const findUsers = async () => assert.fail("Rejected input must not query users");
  for (const [headers, code] of [
    ["First Name,FIRST-NAME", "CSV_DUPLICATE_HEADERS"],
    ["Prénom,Pre\u0301nom", "CSV_DUPLICATE_HEADERS"],
    ["Name,", "CSV_INVALID_HEADERS"],
    ['"Two\nLines",Name', "CSV_INVALID_HEADERS"],
    ["\u200b,Name", "CSV_INVALID_HEADERS"],
  ]) {
    await assert.rejects(run(`${headers}\nA,B`, { findUsers }), { code });
  }
  for (const [mapping, code] of [
    [null, "CSV_INVALID_MAPPING"],
    [{ columns: Object.fromEntries(columns) }, "CSV_INVALID_MAPPING"],
    [{ columns, valid: true }, "CSV_INVALID_MAPPING"],
    [{ columns: [...columns, ["__proto__", 2]] }, "CSV_INVALID_MAPPING"],
    [{ columns: [...columns, ["middle_name", "2"]] }, "CSV_INVALID_MAPPING"],
    [{ columns: [...columns, ["middle_name", 5]] }, "CSV_INVALID_MAPPING"],
    [{ columns: [...columns, ["middle_name", -1]] }, "CSV_INVALID_MAPPING"],
    [{ columns: [...columns, ["middle_name", 2.5]] }, "CSV_INVALID_MAPPING"],
    [{ columns: [...columns, ["middle_name", 3]] }, "CSV_DUPLICATE_MAPPING"],
    [{ columns: [...columns, ["first_name", 2]] }, "CSV_DUPLICATE_MAPPING"],
    [{ columns: columns.slice(0, -1) }, "CSV_MISSING_MAPPING"],
    [{ columns }, "CSV_INVALID_BATCH_ROLE"],
    [{ columns, batchRole: "dean" }, "CSV_INVALID_BATCH_ROLE"],
  ]) {
    await assert.rejects(run(`${externalHeader}\n${externalStudent}`, { mapping, findUsers }), { code });
  }
  const safeHeader = await run(`${externalHeader},__proto__\n${externalFaculty},unused`, {
    mapping: { columns, batchRole: "faculty" },
  });
  assert.equal(safeHeader.canConfirm, true);
  assert.equal(Object.getPrototypeOf(safeHeader.rows[0]), Object.prototype);
});

test("mapped review distinguishes existing accounts, conflicting identity, repeated rows and new rows", async () => {
  const result = await run([
    externalHeader,
    "existing@student.hau.edu.ph,Sample,,0001,First",
    "other@student.hau.edu.ph,Sample,,0001,Second",
    "unique@student.hau.edu.ph,Sample,,0002,Third",
    "unique@student.hau.edu.ph,Sample,,0003,Fourth",
    "fresh@student.hau.edu.ph,Sample,,0004,Fifth",
  ].join("\n"), {
    mapping: { columns, batchRole: "student" },
    findUsers: async () => [
      { institutionalId: "0001", studentId: "0001", email: "existing@student.hau.edu.ph", username: "existing@student.hau.edu.ph" },
      { studentId: "0008", email: "other@student.hau.edu.ph" },
    ],
  });
  assert.match(result.rows[0].errors[0].message, /belong to the same account/);
  assert.equal(result.rows[1].errors.filter((error) => /conflicts with existing/.test(error.message)).length, 2);
  assert.equal(result.rows.slice(2, 4).every(({ errors }) => errors.some((e) => e.field === "official_email" && e.code === "DUPLICATE_IN_FILE")), true);
  assert.deepEqual(result.summary, { totalRows: 5, invalidRows: 4, validRows: 1, duplicateRows: 4 });
  assert.equal(result.canConfirm, false);
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
