import assert from "node:assert/strict";
import { test } from "node:test";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import app from "../src/app.js";
import { env } from "../src/config/env.js";
import User from "../src/models/User.js";
import Notification from "../src/models/Notification.js";
import AccountImport from "../src/models/AccountImport.js";
const csv =
  "institutional_id,first_name,last_name,official_email,role\n0001,Juan,Santos,j@student.hau.edu.ph,student";
test("authenticated upload, ownership, expiration, limits and no User writes", async () => {
  const originals = [];
  const patch = (object, key, value) => {
    originals.push([object, key, object[key]]);
    object[key] = value;
  };
  const owner = new mongoose.Types.ObjectId();
  const other = new mongoose.Types.ObjectId();
  let role = "dean",
    activeId = owner;
  const previews = [];
  const notifications = [];
  patch(Notification, "create", async records => { notifications.push(...records); return records; });
  patch(User, "findById", async () => ({
    _id: activeId,
    id: String(activeId),
    role,
    accountStatus: "Active",
    registrationStatus: "Approved",
  }));
  patch(User, "find", (query) => {
    assert.deepEqual(Object.keys(query.$or[0]), ["studentId"]);
    assert.deepEqual(Object.keys(query.$or[1]), ["employeeId"]);
    return {
      select(fields) {
        assert.equal(fields, "institutionalId studentId employeeId email username -_id");
        return this;
      },
      lean: async () => [],
    };
  });
  for (const method of [
    "create",
    "insertMany",
    "updateOne",
    "updateMany",
    "findOneAndUpdate",
    "deleteOne",
    "deleteMany",
    "bulkWrite",
  ])
    patch(User, method, () => assert.fail(`User write: ${method}`));
  patch(User.prototype, "save", () => assert.fail("User save"));
  patch(AccountImport, "create", async (data) => {
    const model = new AccountImport(data);
    assert.equal(model.validateSync(), undefined);
    assert.doesNotMatch(
      JSON.stringify(data),
      /password|token|originalname|buffer/i,
    );
    previews.push(data);
    return model;
  });
  patch(AccountImport, "findOne", (query) => ({
    select() {
      return this;
    },
    lean: async () =>
      previews.find(
        (p) =>
          p.previewId === query.previewId &&
          String(p.owner) === String(query.owner) &&
          p.expiresAt > query.$or[1].expiresAt.$gt,
      ) || null,
  }));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const base = `http://127.0.0.1:${server.address().port}/api/dean/account-imports`;
  const call = async (path, body, authenticated = true) => {
    const encoded = body
      ? new Request(base + path, { method: "POST", body })
      : null;
    const bytes = encoded ? await encoded.arrayBuffer() : null;
    const response = await fetch(base + path, {
      method: body ? "POST" : "GET",
      headers: {
        ...(encoded
          ? { "Content-Type": encoded.headers.get("Content-Type") }
          : {}),
        ...(authenticated
          ? {
              Authorization: `Bearer ${jwt.sign({ sub: String(activeId) }, env.jwtSecret)}`,
            }
          : {}),
      },
      ...(bytes ? { body: bytes } : {}),
    });
    return {
      status: response.status,
      data: await response.json(),
      headers: response.headers,
    };
  };
  const form = (content = csv, name = "test.csv", mime = "text/csv") => {
    const data = new FormData();
    data.append("file", new Blob([content], { type: mime }), name);
    return data;
  };
  try {
    assert.equal((await call("/validate", form(), false)).status, 401);
    for (role of ["student", "faculty"])
      assert.equal((await call("/validate", form())).status, 403);
    role = "dean";
    const valid = await call("/validate", form());
    assert.equal(valid.status, 200);
    assert.equal(valid.data.canConfirm, true);
    assert.equal(valid.headers.get("Cache-Control"), "no-store");
    assert.doesNotMatch(JSON.stringify(valid.data), /password|"owner"|"_id"/i);
    const path = `/${valid.data.previewId}`;
    assert.equal((await call(path)).status, 200);
    activeId = other;
    const unavailable = await call(path);
    assert.equal(unavailable.status, 404);
    activeId = owner;
    previews[0].expiresAt = new Date(0);
    assert.deepEqual((await call(path)).data, unavailable.data);
    assert.deepEqual((await call("/bad-id")).data, unavailable.data);
    assert.deepEqual(
      (await call("/00000000-0000-4000-8000-000000000000")).data,
      unavailable.data,
    );
    for (const data of [
      form(csv, "x.txt"),
      form(csv, "x.csv", "image/png"),
      form("\x00", "x.csv"),
      form(`${csv}\n\"bad`),
      new FormData(),
    ])
      assert.equal((await call("/validate", data)).status, 400);
    const extra = form();
    extra.append("owner", String(other));
    assert.equal((await call("/validate", extra)).status, 400);
    const multiple = form();
    multiple.append("file", new Blob([csv]), "second.csv");
    assert.equal((await call("/validate", multiple)).status, 400);
    assert.equal(
      (await call("/validate", form("a".repeat(1024 * 1024 + 1)))).status,
      413,
    );
    const invalid = await call(
      "/validate",
      form(csv.replace(",student", ",dean")),
    );
    assert.equal(invalid.status, 200);
    assert.equal(invalid.data.canConfirm, false);
    assert.ok(
      invalid.data.rows[0].errors.some(
        (error) => error.code === "INVALID_ROLE",
      ),
    );
    const limited = await call("/validate", form());
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get("Retry-After")) > 0);
    assert.equal(previews.length, 2);
    assert.equal(notifications.length, 2);
    assert.ok(notifications.every(n => n.type === "import_failed" && n.recipient === String(owner) && n.actionUrl === "/dean/import"));
    assert.doesNotMatch(JSON.stringify(notifications.map(({ title, message }) => ({ title, message }))), /0001|student.hau|bad|buffer|password/);
    assert.ok(
      AccountImport.schema
        .indexes()
        .some(
          ([fields, settings]) =>
            fields.purgeAt === 1 && settings.expireAfterSeconds === 0,
        ),
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    for (const [object, key, value] of originals.reverse()) object[key] = value;
  }
});
