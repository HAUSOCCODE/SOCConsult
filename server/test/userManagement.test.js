import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import app from "../src/app.js";
import { env } from "../src/config/env.js";
import User from "../src/models/User.js";
import Notification from "../src/models/Notification.js";
import AuditLog from "../src/models/AuditLog.js";
import Appointment from "../src/models/Appointment.js";
import { authenticate } from "../src/middleware/auth.js";
import {
  listManagedUsers,
  readManagedUser,
  changeManagedUserStatus,
  parseUserQuery,
} from "../src/services/userManagementService.js";

const id = () => new mongoose.Types.ObjectId().toString();
const actor = id();
const account = (extra = {}) => ({
  _id: id(),
  name: "Juan Santos",
  email: "juan@student.hau.edu.ph",
  role: "student",
  institutionalId: "000123",
  accountSource: "csv",
  accountStatus: "Active",
  registrationStatus: "Approved",
  createdAt: new Date("2026-10-01T00:00:00Z"),
  updatedAt: new Date("2026-10-01T00:00:00Z"),
  password: "SECRET_HASH",
  token: "SECRET_TOKEN",
  passwordResetToken: "SECRET_RESET",
  contactNumber: "PRIVATE_CONTACT",
  ...extra,
});
function matches(user, filter) {
  return Object.entries(filter).every(([key, value]) => {
    if (key === "$or") return value.some((part) => matches(user, part));
    if (value && typeof value === "object" && !(value instanceof Date)) {
      if ("$in" in value) return value.$in.includes(user[key]);
      if ("$exists" in value) return Object.hasOwn(user, key) === value.$exists;
      if ("$regex" in value)
        return new RegExp(value.$regex, value.$options).test(user[key] || "");
    }
    return value instanceof Date
      ? user[key]?.getTime() === value.getTime()
      : String(user[key]) === String(value);
  });
}
function harness(initial = [account()]) {
  const restores = [];
  const patch = (object, key, value) => {
    const old = object[key];
    object[key] = value;
    restores.push(() => {
      object[key] = old;
    });
  };
  const h = {
    users: structuredClone(initial),
    audits: [],
    reads: [],
    writes: [],
    role: "dean",
    ended: 0,
    deletions: 0,
  };
  const session = {
    async withTransaction(work, options) {
      // Model the driver's retry/serialization of contending transactions without a DB.
      let release;
      if (h.serializeTransactions) {
        const previous = h.transactionTail || Promise.resolve();
        h.transactionTail = new Promise((resolve) => {
          release = resolve;
        });
        await previous;
      }
      assert.equal(options.readConcern.level, "snapshot");
      assert.equal(options.writeConcern.w, "majority");
      const before = structuredClone({ users: h.users, audits: h.audits, notifications: h.notifications });
      try {
        if (h.unsupported) throw new Error("private topology detail");
        await work();
        if (h.retry) {
          h.users = structuredClone(before.users);
          h.audits = structuredClone(before.audits); h.notifications = structuredClone(before.notifications);
          await work();
        }
        if (h.uncertain)
          throw {
            hasErrorLabel: (label) =>
              label === "UnknownTransactionCommitResult",
          };
      } catch (error) {
        if (!h.uncertain) {
          h.users = before.users;
          h.audits = before.audits; h.notifications = before.notifications;
        }
        throw error;
      } finally {
        release?.();
      }
    },
    async endSession() {
      h.ended++;
    },
  };
  patch(mongoose, "startSession", async () => {
    if (h.sessionFailure) throw new Error("private connection detail");
    return session;
  });
  const chain = (filter, one = false) => {
    const query = {
      select(value) {
        h.reads.push({ filter, projection: value });
        return this;
      },
      session(value) {
        assert.equal(value, session);
        return this;
      },
      sort(value) {
        this.order = value;
        return this;
      },
      skip(value) {
        this.offset = value;
        return this;
      },
      limit(value) {
        this.size = value;
        return this;
      },
      async lean() {
        if (h.readFailure) throw new Error("private read detail");
        let rows = h.users.filter((user) => matches(user, filter));
        if (one) return rows[0] ? structuredClone(rows[0]) : null;
        h.listOptions = {
          order: this.order,
          offset: this.offset,
          size: this.size,
        };
        rows.sort(
          (a, b) =>
            b.createdAt - a.createdAt ||
            String(b._id).localeCompare(String(a._id)),
        );
        return structuredClone(
          rows.slice(this.offset, this.offset + this.size),
        );
      },
    };
    return query;
  };
  patch(User, "countDocuments", async (filter) => {
    h.countFilter = filter;
    return h.users.filter((user) => matches(user, filter)).length;
  });
  patch(User, "find", (filter) => chain(filter));
  patch(User, "findOne", (filter) => chain(filter, true));
  patch(User, "findById", async (reference) =>
    String(reference) === actor
      ? {
          id: actor,
          _id: actor,
          role: h.role,
          accountStatus: "Active",
          registrationStatus: "Approved",
        }
      : h.users.find((user) => String(user._id) === String(reference)),
  );
  patch(User, "findOneAndUpdate", (filter, update, options) => ({
    select() {
      return this;
    },
    async lean() {
      assert.equal(options.session, session);
      assert.equal(options.runValidators, true);
      assert.equal(options.timestamps, false);
      assert.deepEqual(Object.keys(update), ["$set"]);
      h.writes.push({ filter, update });
      if (h.writeFailure) throw new Error("private write detail");
      if (h.race) return null;
      const user = h.users.find((entry) => matches(entry, filter));
      if (!user) return null;
      Object.assign(user, update.$set);
      return structuredClone(user);
    },
  }));
  h.notifications = [];
  patch(Notification, "create", async (records, options) => {
    assert.equal(options.session, session);
    if (h.notificationFailure) throw new Error("private notification detail");
    h.notifications.push(...records); return records;
  });
  patch(Notification, "updateOne", async (filter, update) => {
    if (h.notificationFailure) throw new Error("private notification detail");
    if (!h.notifications.some(n => n.deduplicationKey === filter.deduplicationKey)) h.notifications.push(update.$setOnInsert);
    return { modifiedCount: 1 };
  });
  patch(AuditLog, "create", async (records, options) => {
    assert.equal(options.session, session);
    if (h.auditFailure) throw new Error("private audit detail");
    for (const record of records)
      assert.equal(new AuditLog(record).validateSync(), undefined);
    h.audits.push(...records);
    return records;
  });
  for (const model of [User, Appointment])
    for (const key of [
      "deleteOne",
      "deleteMany",
      "findOneAndDelete",
      "findByIdAndDelete",
    ])
      patch(model, key, () => {
        h.deletions++;
        throw new Error("Deletion forbidden");
      });
  h.patch = patch;
  h.restore = () => restores.reverse().forEach((restore) => restore());
  return h;
}
const requestBody = (
  user,
  status = user.accountStatus === "Active" ? "Inactive" : "Active",
) => ({
  accountStatus: status,
  expectedStatus: user.accountStatus,
  version: user.updatedAt ? user.updatedAt.toISOString() : null,
  ...(status === "Inactive" && { reason: "  Operational review  " }),
});
const safe = (value) =>
  assert.doesNotMatch(
    JSON.stringify(value),
    /SECRET|PRIVATE|password|token|contactNumber|registrationStatus|approvedBy|reason/i,
  );

test("managed list includes every Student/Faculty source, excludes unsupported roles, and uses safe fields", async () => {
  const users = [
    "csv",
    "manual",
    "self_registration",
    "older_source",
    undefined,
  ].flatMap((source) =>
    ["student", "faculty"].map((role) =>
      account({ role, accountSource: source }),
    ),
  );
  users.push(
    ...["dean", "admin", "program_chair", "other"].map((role) =>
      account({ role }),
    ),
  );
  const h = harness(users);
  try {
    const result = await listManagedUsers({});
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.users.length, 10);
    assert.equal(result.body.pagination.total, 10);
    assert.equal(
      result.body.users.filter((user) => user.accountSource === "legacy")
        .length,
      6,
    );
    assert.ok(
      result.body.users.every((user) =>
        ["student", "faculty"].includes(user.role),
      ),
    );
    assert.ok(
      result.body.users.every((user) => user.institutionalId === "000123"),
    );
    safe(result.body);
    assert.doesNotMatch(
      h.reads[0].projection,
      /password|token|contact|profilePicture/,
    );
    for (const user of users.slice(0, 10)) {
      const detail = await readManagedUser(user._id);
      assert.equal(detail.statusCode, 200);
      safe(detail.body);
    }
    for (const user of users.slice(10))
      assert.equal((await readManagedUser(user._id)).statusCode, 404);
    assert.equal((await readManagedUser("invalid")).statusCode, 400);
  } finally {
    h.restore();
  }
});

test("server search handles names, leading-zero IDs, emails and literal regex characters with combined filters", async () => {
  const h = harness([
    account({ name: "Juan Santos", accountSource: "manual" }),
    account({
      name: "Jane Smith",
      role: "faculty",
      institutionalId: undefined,
      employeeId: "000456",
      email: "jane+office@hau.edu.ph",
      accountSource: "csv",
      accountStatus: "Inactive",
    }),
    account({
      name: "Legacy Person",
      accountSource: undefined,
      institutionalId: undefined,
      studentId: "000789",
    }),
  ]);
  try {
    for (const [search, count] of [
      ["  JUAN   Santos  ", 1],
      ["000456", 1],
      ["000789", 1],
      ["JANE+office@HAU.edu.ph", 1],
      [".*", 0],
      ["[", 0],
      ["000", 3],
    ]) {
      const result = await listManagedUsers({ search });
      assert.equal(result.statusCode, 200);
      assert.equal(result.body.pagination.total, count, search);
    }
    for (const [query, count] of [
      [{ role: "faculty" }, 1],
      [{ status: "Active" }, 2],
      [{ source: "csv" }, 1],
      [{ source: "manual" }, 1],
      [
        { role: "faculty", status: "Inactive", source: "csv", search: "jane" },
        1,
      ],
      [{ role: "student", source: "csv" }, 0],
      [{ source: "all" }, 3],
    ])
      assert.equal(
        (await listManagedUsers(query)).body.pagination.total,
        count,
      );
    assert.equal(
      (await readManagedUser(h.users[2]._id)).body.user.institutionalId,
      "000789",
    );
  } finally {
    h.restore();
  }
});

test("pagination validates bounds, uses database skip/limit and deterministic sorting, clamps invalidated pages", async () => {
  const h = harness(Array.from({ length: 45 }, () => account()));
  try {
    const first = await listManagedUsers({ limit: "20", page: "1" });
    const second = await listManagedUsers({ limit: "20", page: "2" });
    assert.deepEqual(h.listOptions, {
      order: { createdAt: -1, _id: -1 },
      offset: 20,
      size: 20,
    });
    assert.equal(second.body.users.length, 20);
    assert.deepEqual(second.body.pagination, {
      page: 2,
      limit: 20,
      total: 45,
      totalPages: 3,
    });
    assert.equal(
      first.body.users.some((a) =>
        second.body.users.some((b) => a._id === b._id),
      ),
      false,
    );
    assert.deepEqual(
      first.body.users,
      (await listManagedUsers({ page: "1" })).body.users,
    );
    assert.equal(
      (await listManagedUsers({ page: "999" })).body.pagination.page,
      3,
    );
    h.users = [];
    assert.deepEqual((await listManagedUsers({ page: "2" })).body.pagination, {
      page: 1,
      limit: 20,
      total: 0,
      totalPages: 0,
    });
    for (const query of [
      { page: "0" },
      { page: "-1" },
      { page: "1.5" },
      { page: "1000001" },
      { page: "1e2" },
      { page: ["1"] },
      { limit: "101" },
      { limit: "0" },
      { limit: {} },
      { role: "dean" },
      { status: "Pending" },
      { source: "legacy" },
      { search: {} },
      { search: "x".repeat(201) },
      { search: "\u0000" },
    ]) {
      assert.equal(parseUserQuery(query), null);
      assert.equal((await listManagedUsers(query)).statusCode, 400);
    }
    assert.equal(parseUserQuery({ limit: "100" }).limit, 100);
  } finally {
    h.restore();
  }
});

test("eligible activation/deactivation across all sources is atomic, preserves metadata and linked records, and audits only safe data", async () => {
  for (const role of ["student", "faculty"])
    for (const source of [
      "csv",
      "manual",
      "self_registration",
      undefined,
      "old",
    ])
      for (const status of ["Active", "Inactive"]) {
        const original = account({
          role,
          accountSource: source,
          accountStatus: status,
          approvedBy: actor,
          approvedAt: new Date("2025-01-01"),
          rejectionReason: "historical",
        });
        const h = harness([original]);
        try {
          const body = requestBody(original);
          body.reason = " \nMaintenance\u0000 <review>  ";
          const result = await changeManagedUserStatus(
            original._id,
            body,
            actor,
          );
          assert.equal(result.statusCode, 200);
          safe(result.body);
          assert.equal(h.users.length, 1);
          assert.equal(h.deletions, 0);
          assert.equal(h.audits.length, 1);
          assert.equal(h.ended, 1);
          assert.equal(h.users[0].accountStatus, body.accountStatus);
          assert.equal(h.users[0].registrationStatus, "Approved");
          assert.equal(h.users[0].approvedBy, original.approvedBy);
          assert.equal(h.users[0].rejectionReason, "historical");
          assert.equal(h.users[0].password, original.password);
          assert.ok(h.users[0].updatedAt > original.updatedAt);
          const audit = h.audits[0];
          assert.equal(String(audit.subjectUser), original._id);
          assert.equal(String(audit.actorUser), actor);
          assert.equal(
            audit.action,
            body.accountStatus === "Active"
              ? "account_activated"
              : "account_deactivated",
          );
          assert.deepEqual(audit.changes, {
            before: { status },
            after: { status: body.accountStatus },
          });
          assert.equal(audit.metadata.role, role);
          assert.equal(
            audit.metadata.reason,
            status === "Active" ? "Maintenance review" : undefined,
          );
          assert.doesNotMatch(
            JSON.stringify(audit),
            /SECRET|PRIVATE|Juan|Santos|@|institutionalId|password|token/,
          );
          assert.deepEqual(Object.keys(h.writes[0].update.$set).sort(), [
            "accountStatus",
            "updatedAt",
          ]);
        } finally {
          h.restore();
        }
      }
});

test("legacy registration matrix: missing state is normalized for activation; incompatible states conflict without approval", async () => {
  for (const status of ["Active", "Inactive"])
    for (const registration of [
      "Approved",
      "Pending",
      "Rejected",
      "Unknown",
      null,
      undefined,
    ]) {
      const original = account({
        accountStatus: status,
        accountSource: undefined,
        registrationStatus: registration,
      });
      if (registration === undefined) delete original.registrationStatus;
      const h = harness([original]);
      try {
        assert.equal((await listManagedUsers({})).body.users.length, 1);
        const result = await changeManagedUserStatus(
          original._id,
          requestBody(original),
          actor,
        );
        const incompatible =
          status === "Inactive" &&
          registration != null &&
          registration !== "Approved";
        assert.equal(
          result.statusCode,
          incompatible ? 409 : 200,
          `${status}/${registration}`,
        );
        if (incompatible) {
          assert.equal(result.body.code, "REGISTRATION_CONFLICT");
          assert.equal(h.audits.length, 0);
          assert.equal(h.writes.length, 0);
        } else {
          assert.equal(
            h.users[0].registrationStatus,
            status === "Inactive" ? "Approved" : registration,
          );
          if (status === "Inactive") {
            let next = false;
            await authenticate(
              {
                headers: {
                  authorization: `Bearer ${jwt.sign({ sub: original._id }, env.jwtSecret)}`,
                },
              },
              {
                status() {
                  throw new Error("Normalized active account rejected");
                },
              },
              () => {
                next = true;
              },
            );
            assert.equal(next, true);
          }
        }
      } finally {
        h.restore();
      }
    }
});

test("validation, unsupported roles and self-targets never change data or write success audits", async () => {
  const original = account();
  const h = harness([original]);
  try {
    for (const reason of [
      undefined,
      null,
      "",
      " \n\t ",
      {},
      "\u0000<> ",
      "x".repeat(501),
    ]) {
      assert.equal(
        (
          await changeManagedUserStatus(
            original._id,
            { ...requestBody(original), reason },
            actor,
          )
        ).statusCode,
        400,
      );
    }
    assert.equal(
      (
        await changeManagedUserStatus(
          original._id,
          { ...requestBody(original), reason: "x".repeat(500) },
          actor,
        )
      ).statusCode,
      200,
    );
    for (const body of [
      undefined,
      [],
      {},
      { ...requestBody(original), accountStatus: "Deleted" },
      { ...requestBody(original), expectedStatus: "Inactive" },
      { ...requestBody(original), role: "dean" },
      { ...requestBody(original), version: "invalid" },
      { ...requestBody(original), version: undefined },
    ])
      assert.equal(
        (await changeManagedUserStatus(original._id, body, actor)).statusCode,
        400,
      );
    assert.equal(
      (await changeManagedUserStatus(actor, requestBody(original), actor))
        .statusCode,
      403,
    );
    assert.equal(
      (await changeManagedUserStatus("bad", requestBody(original), actor))
        .statusCode,
      400,
    );
    for (const role of ["dean", "admin", "program_chair", "unknown"]) {
      const target = account({ role });
      h.users = [target];
      assert.equal(
        (await changeManagedUserStatus(target._id, requestBody(target), actor))
          .statusCode,
        404,
      );
      assert.equal(h.users[0].accountStatus, "Active");
    }
    assert.equal(h.audits.length, 1);
  } finally {
    h.restore();
  }
});

test("repeated, raced and stale actions conflict; transaction retries do not duplicate audits", async () => {
  const original = account();
  const h = harness([original]);
  try {
    h.retry = true;
    assert.equal(
      (
        await changeManagedUserStatus(
          original._id,
          requestBody(original),
          actor,
        )
      ).statusCode,
      200,
    );
    assert.equal(h.audits.length, 1);
    assert.equal(
      (
        await changeManagedUserStatus(
          original._id,
          requestBody(original),
          actor,
        )
      ).statusCode,
      409,
    );
    assert.equal(h.audits.length, 1);
    const deactivated = structuredClone(h.users[0]);
    h.retry = false;
    assert.equal(
      (
        await changeManagedUserStatus(
          original._id,
          requestBody(deactivated),
          actor,
        )
      ).statusCode,
      200,
    );
    // Status cycled back, but the old version must still be rejected.
    assert.equal(
      (
        await changeManagedUserStatus(
          original._id,
          requestBody(original),
          actor,
        )
      ).statusCode,
      409,
    );
    assert.equal(h.audits.length, 2);
    const current = structuredClone(h.users[0]);
    h.race = true;
    assert.equal(
      (await changeManagedUserStatus(original._id, requestBody(current), actor))
        .statusCode,
      409,
    );
    assert.equal(h.audits.length, 2);
    assert.equal(h.users[0].accountStatus, "Active");
  } finally {
    h.restore();
  }
});

test("audit/write/transaction failures roll back with safe errors; uncertain commit requires refresh", async () => {
  for (const flag of [
    "auditFailure",
    "writeFailure",
    "unsupported",
    "sessionFailure",
    "readFailure",
  ]) {
    const original = account();
    const h = harness([original]);
    try {
      h[flag] = true;
      const result = await changeManagedUserStatus(
        original._id,
        requestBody(original),
        actor,
      );
      assert.equal(result.statusCode, 503);
      safe(result.body);
      assert.equal(h.audits.length, 0);
      assert.equal(h.users[0].accountStatus, "Active");
      if (flag !== "sessionFailure") assert.equal(h.ended, 1);
    } finally {
      h.restore();
    }
  }
  const original = account();
  const h = harness([original]);
  try {
    h.uncertain = true;
    const result = await changeManagedUserStatus(
      original._id,
      requestBody(original),
      actor,
    );
    assert.equal(result.statusCode, 503);
    assert.equal(result.body.code, "STATUS_CHANGE_UNCERTAIN");
    safe(result.body);
  } finally {
    h.restore();
  }
});

test("HTTP routes enforce authentication and Dean role, remove four registration endpoints, preserve reset route and safe malformed-body handling", async () => {
  const original = account();
  const h = harness([original]);
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const base = `http://127.0.0.1:${server.address().port}/api/dean`;
  const call = (path, method = "GET", body, authenticated = true) =>
    fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        Connection: "close",
        ...(authenticated && {
          Authorization: `Bearer ${jwt.sign({ sub: actor }, env.jwtSecret)}`,
        }),
      },
      ...(body !== undefined && {
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    });
  try {
    const endpoints = [
      ["/users", "GET"],
      [`/users/${original._id}`, "GET"],
      [`/users/${original._id}/status`, "PATCH"],
    ];
    for (const [path, method] of endpoints)
      assert.equal((await call(path, method, undefined, false)).status, 401);
    for (const role of ["student", "faculty"]) {
      h.role = role;
      for (const [path, method] of endpoints)
        assert.equal((await call(path, method)).status, 403);
    }
    h.role = "dean";
    const list = await call("/users");
    assert.equal(list.status, 200);
    assert.equal(list.headers.get("Cache-Control"), "no-store");
    safe(await list.json());
    assert.equal((await call(`/users/${original._id}`)).status, 200);
    assert.equal(
      (
        await call(
          `/users/${original._id}/status`,
          "PATCH",
          requestBody(original),
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await call(
          `/users/${original._id}/status`,
          "PATCH",
          requestBody(original),
        )
      ).status,
      409,
    );
    const malformed = await call(
      `/users/${original._id}/status`,
      "PATCH",
      '{"reason":"PRIVATE_REASON"',
    );
    assert.equal(malformed.status, 400);
    assert.doesNotMatch(
      JSON.stringify(await malformed.json()),
      /PRIVATE_REASON/,
    );
    for (const [path, method] of [
      ["/registrations", "GET"],
      [`/registrations/${original._id}`, "GET"],
      [`/registrations/${original._id}/approve`, "PUT"],
      [`/registrations/${original._id}/reject`, "PUT"],
    ])
      assert.equal((await call(path, method)).status, 404);
    assert.equal(
      (await call(`/users/${original._id}/status`, "PUT", {})).status,
      404,
    );
    assert.equal(
      (await call(`/users/${original._id}/reset-password`, "PUT", {})).status,
      404,
    );
    // Reason is retrievable only through the existing Dean-authorized audit routes.
    assert.doesNotMatch(
      JSON.stringify((await readManagedUser(original._id)).body),
      /reason|Operational/,
    );
    for (const role of ["student", "faculty"]) {
      h.role = role;
      assert.equal(
        (await call(`/audit-users/${original._id}/logs`)).status,
        403,
      );
    }
    assert.equal(
      (await call(`/audit-users/${original._id}/logs`, "GET", undefined, false))
        .status,
      401,
    );
    const controller = await readFile(
      new URL("../src/controllers/deanController.js", import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(
      controller,
      /export async function (?:getRegistrations|getRegistration\(|approveRegistration|rejectRegistration)/,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    h.restore();
  }
});

test("simultaneous status submissions yield one successful transition and one conflict with one audit", async () => {
  const original = account();
  const h = harness([original]);
  h.serializeTransactions = true;
  try {
    const results = await Promise.all([
      changeManagedUserStatus(original._id, requestBody(original), actor),
      changeManagedUserStatus(original._id, requestBody(original), actor),
    ]);
    assert.deepEqual(
      results.map((result) => result.statusCode).sort(),
      [200, 409],
    );
    assert.equal(h.users[0].accountStatus, "Inactive");
    assert.equal(h.audits.length, 1);
    assert.equal(h.ended, 2);
  } finally {
    h.restore();
  }
});

test("legacy missing/null timestamps support a single fenced activation and whitespace names remain searchable", async () => {
  for (const version of [undefined, null]) {
    const original = account({
      accountStatus: "Inactive",
      updatedAt: version,
      registrationStatus: null,
      name: "Juan   Santos",
      accountSource: "old",
    });
    if (version === undefined) delete original.updatedAt;
    const h = harness([original]);
    try {
      assert.equal(
        (await listManagedUsers({ search: "Juan Santos" })).body.users.length,
        1,
      );
      assert.equal(
        (
          await changeManagedUserStatus(
            original._id,
            requestBody(original),
            actor,
          )
        ).statusCode,
        200,
      );
      assert.equal(h.users[0].registrationStatus, "Approved");
      assert.equal(
        (
          await changeManagedUserStatus(
            original._id,
            requestBody(original),
            actor,
          )
        ).statusCode,
        409,
      );
      assert.equal(h.audits.length, 1);
      assert.equal(h.audits[0].metadata.newRegistrationStatus, "Approved");
    } finally {
      h.restore();
    }
  }
});


test("account status notifications preserve distinct reactivation cycles and rollback on delivery failure", async () => {
  const h = harness();
  try {
    for (const status of ["Inactive", "Active", "Inactive"]) {
      const current = h.users[0];
      const result = await changeManagedUserStatus(current._id, { accountStatus: status, expectedStatus: current.accountStatus, version: current.updatedAt.toISOString(), reason: "PRIVATE_REASON" }, actor);
      assert.equal(result.statusCode, 200);
    }
    assert.equal(h.notifications.length, 3);
    assert.equal(new Set(h.notifications.map(n => n.deduplicationKey)).size, 3);
    assert.ok(h.notifications.every(n => n.recipient === actor && n.category === "Management"));
    assert.doesNotMatch(JSON.stringify(h.notifications), /PRIVATE|SECRET|000123/);
    h.notificationFailure = true;
    const current = h.users[0];
    const failed = await changeManagedUserStatus(current._id, { accountStatus: "Active", expectedStatus: current.accountStatus, version: current.updatedAt.toISOString() }, actor);
    assert.equal(failed.statusCode, 503);
    assert.equal(h.users[0].accountStatus, "Inactive");
    assert.equal(h.notifications.length, 3);
  } finally { h.restore(); }
});
