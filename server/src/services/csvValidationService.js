import { parse } from "csv-parse";
import {
  CSV_ACCOUNT_COLUMNS,
  CSV_ACCOUNT_REQUIRED_FIELDS,
  CSV_ACCOUNT_ALLOWED_ROLES,
  normalizeCsvAccountHeader,
  normalizeCsvAccountValue,
} from "../config/csvAccountFields.js";
import { accountImportConfig } from "../config/accountImport.js";
import { validatePersonName, formatFullName } from "./personNameService.js";

export class CsvValidationError extends Error {
  constructor(message, code = "CSV_INVALID") { super(message); this.code = code; }
}
const fail = (message, code) => {
  throw new CsvValidationError(message, code);
};

export async function validateCsv(
  buffer,
  options,
) {
  const { config = accountImportConfig, mapping } = options;
  if (!buffer.length) fail("CSV file is empty.", "CSV_EMPTY");
  if (buffer.length > config.maxBytes)
    fail("CSV file exceeds the upload size limit.", "CSV_TOO_LARGE");
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    fail("CSV must contain readable UTF-8 text.");
  }
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(text))
    fail("Binary or control content is not supported.");
  const parser = parse(text, {
    bom: true,
    cast: false,
    raw: true,
    relax_column_count: true,
    max_record_size: config.maxRecordSize,
  });
  let headers, selection;
  let startLine = 1;
  const rows = [];
  try {
    for await (const { record, raw } of parser) {
      // The parser's lines counter counts CRLF within quoted fields twice.
      const recordText = raw.replace(/(?:\r\n|\r|\n)$/, "");
      const endLine = startLine + (recordText.match(/\r\n|\r|\n/g)?.length ?? 0);
      if (!headers) {
        headers = record;
        selection = selectColumns(headers, mapping);
        startLine = endLine + 1;
        continue;
      }
      if (rows.length >= config.maxRows)
        fail(`CSV exceeds the data row limit. Prepare separate CSV files of up to ${config.maxRows} accounts each.`, "CSV_ROW_LIMIT");
      const row = {
        rowNumber: startLine,
        endLineNumber: endLine,
        dataRowNumber: rows.length + 1,
        errors: [],
      };
      if (!selection.mappingRequired)
        for (const field of CSV_ACCOUNT_COLUMNS) {
          const index = selection.columns[field];
          row[field] = index === undefined
            ? (field === "role" ? selection.batchRole : "")
            : (record[index] ?? "");
        }
      if (record.length !== headers.length)
        row.errors.push({ field: "row", code: "COLUMN_COUNT", message: "Row must have the same number of fields as the header." });
      rows.push(row);
      startLine = endLine + 1;
    }
  } catch (error) {
    if (error instanceof CsvValidationError) throw error;
    fail("CSV is malformed or exceeds the record size limit.");
  }
  if (!rows.length) fail("CSV must contain at least one data row.", "CSV_EMPTY");
  if (selection.mappingRequired) return selection;
  return validateAccountRows(rows, { ...options, describeCsvConflicts: true });
}

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function selectColumns(sourceHeaders, mapping) {
  const headers = sourceHeaders.map((header) => header.trim());
  const normalized = headers.map((header) => normalizeCsvAccountHeader(header.normalize("NFC")));
  if (sourceHeaders.some((header, index) =>
    !/[^_]/.test(normalized[index]) || /[\r\n]/.test(header) || /[\p{Cc}\p{Cf}]/u.test(headers[index])))
    fail("Give every source column a readable, nonempty header on the first row.", "CSV_INVALID_HEADERS");
  if (new Set(normalized).size !== headers.length)
    fail("Rename duplicate source headers so each column has a unique name.", "CSV_DUPLICATE_HEADERS");

  if (mapping === undefined) {
    const columns = Object.fromEntries(CSV_ACCOUNT_COLUMNS
      .map((field) => [field, normalized.indexOf(field)])
      .filter(([, index]) => index >= 0));
    if (Object.keys(columns).length === headers.length &&
        CSV_ACCOUNT_REQUIRED_FIELDS.every((field) => Object.hasOwn(columns, field)))
      return { columns };
    return { mappingRequired: true, headers, suggestedColumns: columns };
  }

  if (!isObject(mapping) || !Object.hasOwn(mapping, "columns") || !Array.isArray(mapping.columns) ||
      Object.keys(mapping).some((key) => !["columns", "batchRole"].includes(key)))
    fail("Send a mapping of account fields to source columns.", "CSV_INVALID_MAPPING");
  const columns = Object.create(null);
  const used = new Set();
  for (const entry of mapping.columns) {
    if (!Array.isArray(entry) || entry.length !== 2)
      fail("Send a mapping of account fields to source columns.", "CSV_INVALID_MAPPING");
    const [field, index] = entry;
    if (!CSV_ACCOUNT_COLUMNS.includes(field) || !Number.isSafeInteger(index) || index < 0 || index >= headers.length)
      fail("Choose a source column from this CSV for each mapped field.", "CSV_INVALID_MAPPING");
    if (used.has(index) || Object.hasOwn(columns, field))
      fail("Use each account field and source column only once.", "CSV_DUPLICATE_MAPPING");
    columns[field] = index;
    used.add(index);
  }
  if (CSV_ACCOUNT_REQUIRED_FIELDS.some((field) => field !== "role" && !Object.hasOwn(columns, field)))
    fail("Map the institutional ID, first name, last name, and official email.", "CSV_MISSING_MAPPING");
  const batchRole = Object.hasOwn(mapping, "batchRole") ? mapping.batchRole : undefined;
  if ((batchRole !== undefined || !Object.hasOwn(columns, "role")) &&
      !CSV_ACCOUNT_ALLOWED_ROLES.includes(batchRole))
    fail("Map a role column or select Student or Faculty as the batch account type.", "CSV_INVALID_BATCH_ROLE");
  return { columns, batchRole };
}

// Reuses exactly the upload rules at confirmation, without trusting stored valid/summary.
export async function validateAccountRows(input, {
  findUsers, studentDomain, facultyDomain, config = accountImportConfig, describeCsvConflicts = false,
}) {
  if (!Array.isArray(input) || !input.length || input.length > config.maxRows)
    fail("Preview must contain between 1 and 200 accounts.");
  const rows = input.map((value, index) => {
    const row = {
      rowNumber: value.rowNumber,
      endLineNumber: value.endLineNumber,
      dataRowNumber: index + 1,
      errors: [],
    };
    for (const field of CSV_ACCOUNT_COLUMNS) {
      if (typeof value[field] !== "string") fail("Preview contains invalid account data.");
      row[field] = normalizeCsvAccountValue(field, value[field]);
    }
    // A structural upload error cannot be repaired by discarding extra columns.
    if (value.errors?.some((error) => error.code === "COLUMN_COUNT"))
      row.errors.push({ field: "row", code: "COLUMN_COUNT", message: "Row must have the same number of fields as the header." });
    const add = (field, code, message) => row.errors.push({ field, code, message });
    for (const field of CSV_ACCOUNT_REQUIRED_FIELDS)
      if (!row[field]) add(field, "REQUIRED", `${field} is required.`);
    if (Buffer.byteLength(row.institutional_id, "utf8") > 72)
      add("institutional_id", "ID_LENGTH", "Institutional ID must be 72 UTF-8 bytes or fewer.");
    for (const field of CSV_ACCOUNT_COLUMNS)
      if (/[\x00-\x1f\x7f-\x9f]/.test(row[field]))
        add(field, "CONTROL_CONTENT", "Control content is not supported.");
    const names = validatePersonName({
      firstName: row.first_name,
      middleName: row.middle_name,
      lastName: row.last_name,
    });
    for (const [key, message] of Object.entries(names.errors)) {
      const field = {
        firstName: "first_name",
        middleName: "middle_name",
        lastName: "last_name",
      }[key];
      if (row[field]) add(field, "INVALID_NAME", message);
    }
    if (names.valid && !row.errors.some((error) => error.code === "CONTROL_CONTENT")) {
      row.first_name = names.values.firstName;
      row.middle_name = names.values.middleName;
      row.last_name = names.values.lastName;
    }
    row.fullName = formatFullName(names.values);
    if (row.fullName.length > 100)
      add(
        "name",
        "NAME_LENGTH",
        "Full name must be 100 characters or fewer.",
      );
    if (!CSV_ACCOUNT_ALLOWED_ROLES.includes(row.role))
      add("role", "INVALID_ROLE", "Role must be student or faculty.");
    const email = row.official_email;
    const [local, emailDomain] = email.split("@");
    const validDomainLabels =
      emailDomain &&
      emailDomain
        .split(".")
        .every((label) =>
          /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label),
        );
    if (
      email &&
      (local.length > 64 ||
        !validDomainLabels ||
        email.length > 254 ||
        !/^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/.test(
          email,
        ) ||
        email.startsWith(".") ||
        email.includes("..") ||
        email.includes(".@"))
    )
      add(
        "official_email",
        "INVALID_EMAIL",
        "Enter a valid official email address.",
      );
    const domain =
      row.role === "student"
        ? studentDomain
        : row.role === "faculty"
          ? facultyDomain
          : null;
    if (email && domain && email.slice(email.lastIndexOf("@") + 1) !== domain)
      add(
        "official_email",
        "EMAIL_DOMAIN",
        "Use the official email domain for this role.",
      );
    return row;
  });
  const ids = [...new Set(rows.map((r) => r.institutional_id).filter(Boolean))];
  const emails = [
    ...new Set(rows.map((r) => r.official_email).filter(Boolean)),
  ];
  const users = await findUsers(ids, emails);
  const usedIds = new Map();
  const usedEmails = new Map();
  for (const user of users) {
    indexIdentity(usedIds, [user.institutionalId, user.studentId, user.employeeId], user);
    indexIdentity(usedEmails, [user.email, user.username], user);
  }
  for (const row of rows) {
    const idMatches = usedIds.get(row.institutional_id);
    const emailMatches = usedEmails.get(row.official_email);
    if (describeCsvConflicts && idMatches?.size === 1 && emailMatches?.size === 1 &&
        emailMatches.has(idMatches.values().next().value)) {
      row.errors.push({
        field: "row", code: "EXISTING_ACCOUNT",
        message: "The institutional ID and official email already belong to the same account.",
      });
    } else {
      for (const [field, matches, label] of [
        ["institutional_id", idMatches, "Institutional ID"],
        ["official_email", emailMatches, "Official email"],
      ]) {
        if (matches) row.errors.push({
          field, code: "EXISTING_ACCOUNT",
          message: describeCsvConflicts
            ? `${label} conflicts with existing account information. Verify this row's ID and email.`
            : `${field} is already used by an account.`,
        });
      }
    }
  }
  for (const field of ["institutional_id", "official_email"]) {
    const counts = new Map();
    for (const row of rows)
      if (row[field]) counts.set(row[field], (counts.get(row[field]) || 0) + 1);
    for (const row of rows) {
      if (row[field] && counts.get(row[field]) > 1)
        row.errors.push({
          field,
          code: "DUPLICATE_IN_FILE",
          message: `${field} is repeated in this file.`,
        });
    }
  }
  for (const row of rows) row.valid = row.errors.length === 0;
  const validRows = rows.filter((r) => r.valid).length;
  const summary = {
    totalRows: rows.length,
    validRows,
    invalidRows: rows.length - validRows,
    duplicateRows: rows.filter((r) =>
      r.errors.some((e) =>
        ["DUPLICATE_IN_FILE", "EXISTING_ACCOUNT"].includes(e.code),
      ),
    ).length,
  };
  return { rows, summary, canConfirm: summary.invalidRows === 0 };
}

function indexIdentity(index, identities, user) {
  for (const identity of identities.filter(Boolean)) {
    if (!index.has(identity)) index.set(identity, new Set());
    index.get(identity).add(user);
  }
}
