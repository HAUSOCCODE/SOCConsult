import assert from "node:assert/strict";
import { test } from "node:test";
import { Readable } from "node:stream";
import { validateCsv } from "../src/services/csvValidationService.js";
import { csvUpload } from "../src/middleware/csvUpload.js";
import { getAccountImport } from "../src/controllers/accountImportController.js";

test("CSV structural failures carry stable codes without changing validation messages", async () => {
  for (const [content, code] of [[Buffer.alloc(0), "CSV_EMPTY"], [Buffer.alloc(1048577), "CSV_TOO_LARGE"], [Buffer.from("unknown\nvalue"), "CSV_INVALID"], [Buffer.from("institutional_id,first_name,last_name,official_email,role\n"), "CSV_EMPTY"]]) {
    await assert.rejects(validateCsv(content, {}), error => error.code === code && Boolean(error.message));
  }
});

test("CSV middleware identifies missing, unsupported and oversized uploads", async () => {
  for (const [filename, content, code] of [[null, "", "CSV_MISSING"], ["unsafe.exe", "data", "CSV_UNSUPPORTED"], ["large.csv", "x".repeat(1048577), "CSV_TOO_LARGE"]]) {
    const boundary = "DEA19-test";
    const body = filename ? `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: text/csv\r\n\r\n${content}\r\n--${boundary}--\r\n` : `--${boundary}--\r\n`;
    const req = Readable.from([Buffer.from(body)]);
    req.headers = { "content-type": `multipart/form-data; boundary=${boundary}`, "content-length": String(Buffer.byteLength(body)) }; req.method = "POST";
    const result = await new Promise((resolve, reject) => csvUpload(req, { status(status) { this.statusCode = status; return this; }, json(body) { resolve({ status: this.statusCode, body }); } }, () => reject(new Error("Unexpected accepted upload"))));
    assert.equal(result.body.code, code); assert.equal(result.status, code === "CSV_TOO_LARGE" ? 413 : 400);
  }
});

test("missing CSV previews expose an additive safe identifier", async () => {
  const res = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
  await getAccountImport({ params: { previewId: "invalid" } }, res);
  assert.equal(res.statusCode, 404); assert.equal(res.body.code, "PREVIEW_UNAVAILABLE");
});
