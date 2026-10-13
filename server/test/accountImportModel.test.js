import assert from "node:assert/strict";
import { test } from "node:test";
import AccountImport from "../src/models/AccountImport.js";
test("preview schema restricts stored fields and declares expiration index", () => {
  const keys = Object.keys(AccountImport.schema.paths);
  for (const forbidden of [
    "password",
    "token",
    "buffer",
    "originalname",
    "body",
  ])
    assert.ok(!keys.includes(forbidden));
  assert.ok(
    AccountImport.schema
      .indexes()
      .some(
        ([keys, options]) =>
          keys.expiresAt === 1 && options.expireAfterSeconds === 0,
      ),
  );
  assert.ok(
    new AccountImport({ previewId: "x", expiresAt: new Date() }).validateSync()
      .errors.owner,
  );
});
