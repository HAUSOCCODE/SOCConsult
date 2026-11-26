// Run with a local mongod executable path. This script creates its own loopback
// replica set and never consumes a configured MongoDB URI.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";

const binary = process.argv[2];
assert.ok(binary, "Provide a local mongod executable path.");
const portProbe = createServer();
portProbe.listen(0, "127.0.0.1");
await once(portProbe, "listening");
const { port } = portProbe.address();
await new Promise((resolveClose, reject) => portProbe.close(error => error ? reject(error) : resolveClose()));
const directory = await mkdtemp(resolve(tmpdir(), "socconsult-pei05-replica-"));
const data = resolve(directory, "data");
const logFile = resolve(directory, "mongod.log");
await mkdir(data);
const uri = `mongodb://127.0.0.1:${port}/socconsult_pei05?directConnection=true`;
const mongo = spawn(resolve(binary), [
  "--dbpath", data, "--replSet", "pei05", "--bind_ip", "127.0.0.1", "--port", String(port),
  "--logpath", logFile,
], { windowsHide: true, stdio: "ignore" });
const done = once(mongo, "close");
done.catch(() => {});
const driver = new mongoose.mongo.MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
const serverRoot = fileURLToPath(new URL("../", import.meta.url));
const run = promisify(execFile);
const password = "ReplicaFixturePassword1";
const coldStart = (username, initialPassword) => run(process.execPath, [
  "--input-type=module", "-e", `
    import "./src/app.js";
    import { connectDatabase } from "./src/config/database.js";
    import mongoose from "mongoose";
    await connectDatabase();
    await mongoose.disconnect();
  `,
], {
  cwd: serverRoot,
  timeout: 45000,
  windowsHide: true,
  env: {
    ...process.env, NODE_ENV: "test", MONGODB_URI: uri, JWT_SECRET: "isolated-replica-fixture",
    CLIENT_URL: "http://127.0.0.1:5173", CLOUDINARY_CLOUD_NAME: "isolated", CLOUDINARY_API_KEY: "isolated",
    CLOUDINARY_API_SECRET: "isolated", DEAN_BOOTSTRAP_ENABLED: username ? "true" : "",
    DEAN_USERNAME: username ?? "", DEAN_PASSWORD: initialPassword ?? "", ADMIN_USERNAME: "", ADMIN_PASSWORD: "",
  },
});
const response = () => ({
  statusCode: 200,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

try {
  let listening = false;
  for (let attempt = 0; attempt < 80 && !listening; attempt++) {
    if (mongo.exitCode !== null || !mongo.pid) throw new Error("Disposable mongod exited early.");
    const log = await readFile(logFile, "utf8").catch(() => "");
    listening = log.includes('"msg":"Waiting for connections"');
    if (!listening) await delay(250);
  }
  assert.ok(listening, "Disposable mongod opened its loopback listener.");
  await driver.connect();
  const admin = driver.db("admin");
  const launchOptions = await admin.command({ getCmdLineOpts: 1 });
  assert.equal(resolve(launchOptions.parsed.storage.dbPath), data);
  await admin.command({ replSetInitiate: { _id: "pei05", members: [{ _id: 0, host: `127.0.0.1:${port}` }] } });
  let primary = false;
  for (let attempt = 0; attempt < 80 && !primary; attempt++) {
    primary = (await admin.command({ hello: 1 })).isWritablePrimary;
    if (!primary) await delay(250);
  }
  assert.ok(primary, "Disposable MongoDB node became primary.");
  await Promise.all([coldStart("first.fixture", password), coldStart("second.fixture", password)]);

  const database = driver.db();
  const users = database.collection("users");
  const [dean, ...otherUsers] = await users.find({}).toArray();
  assert.ok(dean);
  assert.deepEqual(otherUsers, []);
  assert.equal(dean.role, "dean");
  assert.equal(await database.collection("installationState").countDocuments({ _id: "dean-initialized" }), 1);
  assert.ok(await bcrypt.compare(password, dean.password));
  const appointment = await database.collection("appointments").insertOne({ faculty: dean._id });
  await users.insertOne({ role: "faculty", username: "reserved.fixture" });

  process.env.NODE_ENV = "test";
  process.env.JWT_SECRET = "isolated-replica-fixture";
  const { changeDeanUsername, login } = await import("../src/controllers/authController.js");
  const { default: User } = await import("../src/models/User.js");
  const { default: AuditLog } = await import("../src/models/AuditLog.js");
  await mongoose.connect(uri);
  await AuditLog.init();
  const authenticated = await User.findById(dean._id);
  const update = async (username, user = authenticated) => {
    const res = response();
    await changeDeanUsername({ user, body: { username, currentPassword: password } }, res);
    return res;
  };
  assert.equal((await update("reserved.fixture")).body.code, "USERNAME_TAKEN");
  const originalAudit = AuditLog.create;
  AuditLog.create = async () => { throw new Error("simulated audit write failure"); };
  try {
    assert.equal((await update("rollback.fixture")).body.code, "USERNAME_CHANGE_UNAVAILABLE");
  } finally {
    AuditLog.create = originalAudit;
  }
  assert.equal((await users.findOne({ _id: dean._id })).username, dean.username);

  const results = await Promise.all([update("personal.fixture"), update("alternate.fixture")]);
  assert.deepEqual(results.map(result => result.statusCode).sort(), [200, 409]);
  const current = results.find(result => result.statusCode === 200).body.user;
  await coldStart();
  await coldStart("stale.fixture", "DifferentFixture1");
  const persisted = await users.findOne({ _id: dean._id });
  assert.equal(persisted.username, current.username);
  assert.equal(persisted.password, dean.password);
  assert.equal(String((await database.collection("appointments").findOne({ _id: appointment.insertedId })).faculty), current.id);
  assert.equal(await database.collection("auditlogs").countDocuments({ action: "username_changed" }), 1);
  for (const [username, status] of [[dean.username, 401], [current.username, 200]]) {
    const res = response();
    await login({ params: { role: "dean" }, body: { username, password } }, res);
    assert.equal(res.statusCode, status);
    if (status === 200) assert.equal(res.body.user.id, String(dean._id));
  }
  await users.updateOne({ _id: dean._id }, { $set: { role: "admin", approvalMethod: "admin" } });
  const historicalAudit = await database.collection("auditlogs").insertOne({ actorUser: dean._id, actorRole: "admin", action: "login" });
  await coldStart();
  const migrated = await users.findOne({ _id: dean._id });
  assert.equal(migrated.role, "dean");
  assert.equal(migrated.approvalMethod, "dean");
  assert.equal(migrated.username, current.username);
  assert.equal(migrated.password, dean.password);
  assert.equal((await database.collection("auditlogs").findOne({ _id: historicalAudit.insertedId })).actorRole, "admin");
  await users.deleteMany({}); // This database belongs exclusively to the disposable replica set.
  await assert.rejects(coldStart("second.bootstrap", password), /institution-authorized recovery/);
  assert.equal(await users.countDocuments({}), 0);
  console.log("PASS: MongoDB replica-set bootstrap contention, restart, username uniqueness and contention, audit rollback, preserved ownership, legacy migration, and recovery guard.");
} catch (error) {
  const log = await readFile(logFile, "utf8").catch(() => "");
  if (log) console.error(log.split("\n").filter(line => /"s":"[EF]"|Waiting for connections/.test(line)).slice(-6).join("\n"));
  throw error;
} finally {
  await mongoose.disconnect();
  await driver.close();
  mongo.kill();
  await done.catch(() => {});
  assert.equal(dirname(directory), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith("socconsult-pei05-replica-"));
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
