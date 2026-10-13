import assert from "node:assert/strict";
import { test } from "node:test";
import { migrateAccountImport, institutionalIndex, hasIdentityIndexes, hasRetentionIndex } from "../src/services/accountImportMigrationService.js";
import User from "../src/models/User.js";

function harness(records = [{ _id: "a", role: "student", studentId: "0001", email: "a@example.test" },
  { _id: "b", role: "faculty", employeeId: "FAC-1", email: "b@example.test" }, { _id: "dean", role: "dean" }]) {
  const h = { records, writes: [], userIndexes: [{ name: "email_1", key: { email: 1 }, unique: true, sparse: true },
    { name: "username_1", key: { username: 1 }, unique: true, sparse: true }],
    importIndexes: [{ name: "expiresAt_1", key: { expiresAt: 1 }, expireAfterSeconds: 0 }],
    batches: [{ status: "validated", expiresAt: new Date(0) }, { status: "completed", purgeAt: new Date(0), rows: [{ institutional_id: "secret" }] }] };
  const same = (record, query) => Object.entries(query).every(([key, value]) => {
    if (value && typeof value === "object") {
      if ("$exists" in value) return Object.hasOwn(record, key) === value.$exists;
      if ("$ne" in value) return record[key] !== value.$ne;
    }
    return record[key] === value;
  });
  const apply = (record, update) => {
    Object.assign(record, update.$set || {});
    for (const field of Object.keys(update.$unset || {})) delete record[field];
  };
  const users = {
    find(_query, options) {
      assert.ok(!("password" in options.projection));
      return { async *[Symbol.asyncIterator]() { for (const record of records) yield structuredClone(record); } };
    },
    indexes: async () => h.userIndexes,
    updateOne: async (query, update) => {
      h.writes.push({ target: "user", query, update });
      if (h.changed) return { matchedCount: 0 };
      const record = records.find((row) => same(row, query));
      if (record) apply(record, update);
      return { matchedCount: record ? 1 : 0 };
    },
    createIndex: async (key, options) => { h.writes.push({ target: "user-index", key, options }); h.userIndexes.push({ key, ...options }); },
  };
  const imports = {
    indexes: async () => h.importIndexes,
    dropIndex: async (name) => { h.writes.push({ target: "drop-index", name }); h.importIndexes = h.importIndexes.filter((index) => index.name !== name); },
    updateMany: async (query, update) => { h.writes.push({ target: "imports", query, update }); for (const batch of h.batches) if (same(batch, query)) apply(batch, update); },
    createIndex: async (key, options) => { h.writes.push({ target: "import-index", key, options }); h.importIndexes.push({ key, ...options }); },
  };
  return Object.assign(h, { users, imports });
}

test("preflight defaults to read-only aggregate inspection with no sensitive output or startup ID index", async () => {
  const h = harness();
  const result = await migrateAccountImport(h);
  assert.equal(result.mode, "inspect"); assert.equal(result.applied, false); assert.equal(result.safeToApply, true);
  assert.equal(result.counts.users, 3); assert.equal(result.counts.canonicalBackfills, 2);
  assert.equal(h.writes.length, 0);
  assert.doesNotMatch(JSON.stringify(result), /0001|FAC-1|@|password|studentId|institutionalId/i);
  assert.ok(!User.schema.indexes().some(([keys]) => keys.institutionalId));
});

test("apply backfills only unambiguous IDs, replaces TTL, retains completed summaries, and reruns", async () => {
  const h = harness();
  const result = await migrateAccountImport({ ...h, apply: true });
  assert.equal(result.applied, true);
  assert.equal(h.records[0].institutionalId, "0001"); assert.equal(h.records[1].institutionalId, "FAC-1");
  assert.equal(h.records[2].institutionalId, undefined);
  assert.ok(hasIdentityIndexes(h.userIndexes)); assert.ok(hasRetentionIndex(h.importIndexes));
  assert.equal(h.batches[1].purgeAt, undefined); assert.equal(h.batches[1].rows, undefined);
  assert.ok(h.batches[0].purgeAt instanceof Date);
  const userWrites = h.writes.filter((write) => write.target === "user").length;
  const indexWrites = h.writes.filter((write) => write.target.endsWith("index")).length;
  const again = await migrateAccountImport({ ...h, apply: true });
  assert.equal(again.applied, true); assert.equal(again.counts.canonicalBackfills, 0);
  assert.equal(h.writes.filter((write) => write.target === "user").length, userWrites);
  assert.equal(h.writes.filter((write) => write.target.endsWith("index")).length, indexWrites);
});

test("preflight detects missing/empty/invalid/conflicting IDs and cross-field duplicates before writes", async () => {
  for (const records of [
    [{ _id: "a", role: "student" }],
    [{ _id: "a", role: "faculty", employeeId: " " }],
    [{ _id: "a", role: "student", studentId: 123 }],
    [{ _id: "a", role: "student", studentId: "A", employeeId: "B" }],
    [{ _id: "a", role: "student", studentId: "A", institutionalId: "B" }],
    [{ _id: "a", role: "student", studentId: " A " }, { _id: "b", role: "faculty", employeeId: "A" }],
    [{ _id: "a", role: "student", studentId: "A" }, { _id: "b", role: "student", studentId: "A" }],
    [{ _id: "a", role: "faculty", employeeId: "A" }, { _id: "b", role: "faculty", employeeId: "A" }],
    [{ _id: "a", role: "student", studentId: "A", email: " SAME@example.test " }, { _id: "b", role: "faculty", employeeId: "B", email: "same@example.test" }],
    [{ _id: "a", role: "student", studentId: "A", username: "SAME" }, { _id: "b", role: "faculty", employeeId: "B", username: "same" }],
  ]) {
    const h = harness(records);
    const result = await migrateAccountImport({ ...h, apply: true });
    assert.equal(result.safeToApply, false); assert.equal(result.applied, false); assert.equal(h.writes.length, 0);
    assert.doesNotMatch(JSON.stringify(result), /@|password|"records"|studentId|employeeId|institutionalId/i);
  }
});

test("case-sensitive IDs preserve distinct values; canonical trim and interrupted apply are recoverable", async () => {
  const h = harness([{ _id: "a", role: "student", studentId: "Abc", institutionalId: " Abc " },
    { _id: "b", role: "faculty", employeeId: "abc" }]);
  assert.equal((await migrateAccountImport({ ...h, apply: true })).applied, true);
  assert.equal(h.records[0].institutionalId, "Abc"); assert.equal(h.records[1].institutionalId, "abc");
  const interrupted = harness(); interrupted.changed = true;
  await assert.rejects(migrateAccountImport({ ...interrupted, apply: true }), /interrupted/);
  interrupted.changed = false;
  assert.equal((await migrateAccountImport({ ...interrupted, apply: true })).applied, true);
});

test("missing or unsuitable unique indexes refuse apply; prerequisite predicates reject unsafe indexes", async () => {
  const h = harness(); h.userIndexes = [];
  assert.equal((await migrateAccountImport({ ...h, apply: true })).safeToApply, false);
  assert.equal(h.writes.length, 0);
  const valid = [{ key: { email: 1 }, unique: true }, { key: { username: 1 }, unique: true }, institutionalIndex];
  assert.ok(hasIdentityIndexes(valid));
  assert.equal(hasIdentityIndexes(valid.map((index) => ({ ...index, collation: { locale: "en", strength: 2 } }))), false);
  assert.equal(hasIdentityIndexes([...valid.slice(0, 2), { ...institutionalIndex, partialFilterExpression: { institutionalId: { $exists: true } } }]), false);
  assert.equal(hasRetentionIndex([{ key: { expiresAt: 1 }, expireAfterSeconds: 0 }, { key: { purgeAt: 1 }, expireAfterSeconds: 0 }]), false);
});
