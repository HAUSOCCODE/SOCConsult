import assert from "node:assert/strict";
import { test } from "node:test";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import User from "../src/models/User.js";
import { ensureDean } from "../src/services/deanInitializationService.js";

const bootstrap = { deanBootstrapEnabled: true, deanUsername: " Initial.Dean ", deanPassword: "TemporaryTest1" };

// Simulates transaction rollback and a losing marker insert. MongoDB locking
// and the actual transaction retry behavior require a replica-set test.
function harness(t, accounts = [], initialized = false) {
  const state = { accounts, initialized, inserts: 0 };
  const users = User.collection;
  const patch = (target, method, fn) => t.mock.method(target, method, fn);
  patch(users, "createIndex", async (keys, options) => {
    assert.deepEqual(keys, { username: 1 });
    assert.deepEqual(options, { unique: true, sparse: true });
  });
  patch(mongoose.connection, "createCollection", async name => assert.equal(name, "installationState"));
  patch(mongoose.connection, "collection", name => {
    assert.equal(name, "installationState");
    return {
      findOne: async (_, { session }) => session.draft.initialized ? { _id: "dean-initialized" } : null,
      insertOne: async (marker, { session }) => {
        assert.deepEqual(marker, { _id: "dean-initialized" });
        session.draft.initialized = true;
      },
    };
  });
  const previousDb = mongoose.connection.db;
  mongoose.connection.db = {
    listCollections: () => ({ toArray: async () => [{ name: "appointments", type: "collection" }] }),
    collection: () => ({ findOne: async () => state.appointment ?? null }),
  };
  t.after(() => { mongoose.connection.db = previousDb; });
  patch(users, "find", (filter, { session, limit }) => ({
    toArray: async () => session.draft.accounts.filter(row => filter.role.$in.includes(row.role)).slice(0, limit),
  }));
  patch(users, "findOne", (_, { session }) => Promise.resolve(session.draft.accounts[0]));
  patch(users, "updateOne", async (filter, { $set }, { session }) => {
    const account = session.draft.accounts.find(row => row._id === filter._id && row.role === filter.role);
    if (account) Object.assign(account, $set);
    return { modifiedCount: Number(Boolean(account)) };
  });
  patch(users, "updateMany", async (filter, { $set }, { session }) => {
    for (const account of session.draft.accounts)
      if (account.approvalMethod === filter.approvalMethod) Object.assign(account, $set);
  });
  patch(User, "create", async ([account], { session }) => {
    if (state.failInsert) throw new Error("sensitive driver error");
    if (state.beforeInsert) await state.beforeInsert();
    session.draft.accounts.push({ ...account, _id: "bootstrap-id" });
    session.draft.inserts++;
  });
  patch(mongoose, "startSession", async () => ({
    async withTransaction(work, options) {
      assert.equal(options.readConcern.level, "snapshot");
      assert.equal(options.writeConcern.w, "majority");
      const base = state.initialized;
      this.draft = structuredClone({ initialized: base, accounts: state.accounts, inserts: state.inserts });
      const result = await work();
      if (!base && state.initialized) throw Object.assign(new Error("duplicate marker"), { code: 11000 });
      Object.assign(state, this.draft);
      return result;
    },
    async endSession() {},
  }));
  return state;
}

test("authorized first startup creates one approved Dean and persists a marker and bcrypt hash", async t => {
  const state = harness(t);
  assert.equal((await ensureDean(bootstrap)).status, "created");
  const [dean] = state.accounts;
  assert.equal(dean.username, "initial.dean");
  assert.equal(dean.role, "dean");
  assert.equal(dean.registrationStatus, "Approved");
  assert.equal(dean.accountStatus, "Active");
  assert.ok(dean.bootstrapCredentialsIssuedAt instanceof Date);
  assert.equal(bcrypt.getRounds(dean.password), 12);
  assert.ok(await bcrypt.compare(bootstrap.deanPassword, dean.password));
  assert.equal(state.initialized, true);
  const before = structuredClone(state.accounts);
  await ensureDean(bootstrap);
  await ensureDean({ ...bootstrap, deanUsername: "new.env", deanPassword: "DifferentTest1" });
  await ensureDean({});
  assert.deepEqual(state.accounts, before);
  assert.equal(state.inserts, 1);
});

test("bootstrap needs explicit authorization, both credentials and a policy-compliant password", async t => {
  const state = harness(t);
  await assert.rejects(ensureDean({ ...bootstrap, deanBootstrapEnabled: false }), /authorize bootstrap/);
  for (const config of [{ deanUsername: undefined }, { deanPassword: undefined }, { deanPassword: "weak" }, { deanUsername: "a@@b.edu" }])
    await assert.rejects(ensureDean({ ...bootstrap, ...config }), /valid initial username and a password/);
  assert.deepEqual(state.accounts, []);
  assert.equal(state.initialized, false);
});

test("existing Dean identity, credentials and inactive status survive startup with absent or stale configuration", async t => {
  const original = { _id: "dean-id", name: "Fictional Dean", username: "initial.dean", role: "dean", accountStatus: "Inactive", password: "existing-hash", email: "sample@example.edu" };
  const state = harness(t, [original]);
  await ensureDean(bootstrap);
  state.accounts[0].username = "personal.dean";
  await ensureDean(bootstrap);
  await ensureDean({});
  assert.deepEqual(state.accounts, [{ ...original, username: "personal.dean" }]);
  assert.equal(state.initialized, true);
  assert.equal(state.inserts, 0);
});

test("missing Dean in initialized or populated data requires institutional recovery", async t => {
  const state = harness(t, [{ _id: "faculty", role: "faculty", username: "initial.dean" }]);
  await assert.rejects(ensureDean(bootstrap), /institution-authorized recovery/);
  assert.deepEqual(state.accounts, [{ _id: "faculty", role: "faculty", username: "initial.dean" }]);
  state.accounts = [];
  state.appointment = { _id: "historical" };
  await assert.rejects(ensureDean(bootstrap), /institution-authorized recovery/);
  delete state.appointment;
  state.initialized = true;
  await assert.rejects(ensureDean(bootstrap), /institution-authorized recovery/);
  assert.equal(state.inserts, 0);
});

test("conflicting management roles stop initialization while a sole Admin migrates in place", async t => {
  const admin = { _id: "legacy", role: "admin", username: "old-work-account", password: "legacy-hash" };
  const dean = { _id: "other", role: "dean", username: "initial.dean" };
  const state = harness(t, [admin, dean]);
  await assert.rejects(ensureDean(bootstrap), /Management account conflict/);
  assert.deepEqual(state.accounts, [admin, dean]);
  assert.equal(state.initialized, false);
  state.accounts.pop();
  assert.equal((await ensureDean({})).status, "converted");
  assert.deepEqual(state.accounts, [{ ...admin, role: "dean" }]);
  assert.equal(state.initialized, true);
  assert.equal(state.inserts, 0);
});

test("account insertion failure rolls back the marker and sanitizes the driver error", async t => {
  const state = harness(t);
  state.failInsert = true;
  await assert.rejects(ensureDean(bootstrap), error => {
    assert.match(error.message, /Check MongoDB transaction support/);
    assert.doesNotMatch(error.message, /sensitive|TemporaryTest1/);
    return true;
  });
  assert.deepEqual(state.accounts, []);
  assert.equal(state.initialized, false);
  state.failInsert = false;
  assert.equal((await ensureDean(bootstrap)).status, "created");
});

test("competing startups with different bootstrap names converge after a marker collision", async t => {
  const state = harness(t);
  let arrived = 0;
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  state.beforeInsert = () => {
    if (++arrived === 2) release();
    return waiting;
  };
  const results = await Promise.all([
    ensureDean(bootstrap),
    ensureDean({ ...bootstrap, deanUsername: "second.dean" }),
  ]);
  assert.deepEqual(results.map(result => result.status).sort(), ["already-dean", "created"]);
  assert.equal(state.accounts.length, 1);
  assert.equal(state.initialized, true);
  assert.equal(state.inserts, 1);
});
