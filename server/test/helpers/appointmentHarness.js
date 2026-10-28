import AttendanceResponse from "../../src/models/AttendanceResponse.js";
import AttendanceReview from "../../src/models/AttendanceReview.js";
import mongoose from "mongoose";
import Appointment from "../../src/models/Appointment.js";
import Availability from "../../src/models/Availability.js";
import OneTimeScheduleHold from "../../src/models/OneTimeScheduleHold.js";
import AuditLog from "../../src/models/AuditLog.js";
import Notification from "../../src/models/Notification.js";
import User from "../../src/models/User.js";

export const newId = () => String(new mongoose.Types.ObjectId());
export const clone = (value) => value instanceof Date ? new Date(value) : value?._bsontype === "ObjectId" ? String(value)
  : Array.isArray(value) ? value.map(clone) : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) : value;
const same = (a, b) => a instanceof Date || b instanceof Date ? new Date(a).getTime() === new Date(b).getTime() : String(a) === String(b);
const matches = (record, query) => Object.entries(query).every(([key, value]) => {
  if (key === "$or") return value.some((item) => matches(record, item));
  const actual = key.split(".").reduce((value, part) => value?.[part], record);
  if (value && typeof value === "object" && !(value instanceof Date) && !value._bsontype) {
    return Object.entries(value).every(([op, expected]) => {
      if (op === "$exists") return (actual !== undefined) === expected;
      if (op === "$type") return actual instanceof Date;
      if (op === "$ne") return !same(actual, expected);
      if (op === "$in") return expected.some((item) => same(actual, item));
      if (op === "$lt") return actual < expected;
      if (op === "$lte") return actual <= expected;
      if (op === "$gt") return actual > expected;
      if (op === "$gte") return actual >= expected;
      throw new Error(`Unsupported mock operator ${op}`);
    });
  }
  return same(actual, value);
});
const query = (work) => {
  let sort, limit;
  const result = { then: (resolve, reject) => Promise.resolve().then(work).then((value) => {
    if (!Array.isArray(value)) return value;
    if (sort) value.sort((a, b) => {
      for (const [key, order] of Object.entries(sort)) {
        if (a[key] < b[key]) return -order;
        if (a[key] > b[key]) return order;
      }
      return 0;
    });
    return limit == null ? value : value.slice(0, limit);
  }).then(resolve, reject) };
  for (const method of ["select", "session", "populate", "lean", "maxTimeMS"]) result[method] = () => result;
  result.sort = (value) => { sort = value; return result; };
  result.limit = (value) => { limit = value; return result; };
  return result;
};
const update = (record, changes) => {
  Object.assign(record, clone(changes.$set || {}));
  for (const key of Object.keys(changes.$unset || {})) delete record[key];
  for (const [key, value] of Object.entries(changes.$inc || {})) record[key] = (record[key] || 0) + value;
  for (const [key, value] of Object.entries(changes.$push || {})) (record[key] ||= []).push(clone(value));
};

export function appointmentHarness() {
  const restores = [];
  const lockCalls = [];
  const state = { appointments: [], slots: [], holds: [], audits: [], notifications: [], users: [], responses: [], reviews: [] };
  let failAt, retryOnce = false, queue = Promise.resolve();
  const patch = (object, key, value) => { const old = object[key]; object[key] = value; restores.push(() => { object[key] = old; }); };
  const failure = (name) => { if (failAt === name) throw new Error(`Injected ${name} failure`); };
  patch(mongoose, "startSession", async () => ({
    withTransaction: async (work) => {
      const preceding = queue; let done;
      queue = new Promise((resolve) => { done = resolve; }); await preceding;
      const before = clone(state);
      try {
        const result = await work();
        if (retryOnce) { retryOnce = false; Object.assign(state, clone(before)); return await work(); }
        return result;
      } catch (error) { Object.assign(state, before); throw error; } finally { done(); }
    }, endSession: async () => {},
  }));
  for (const [model, key] of [[Appointment, "appointments"], [Availability, "slots"], [OneTimeScheduleHold, "holds"], [User, "users"], [AttendanceResponse, "responses"], [AttendanceReview, "reviews"]]) {
    patch(model, "findOne", (filter) => query(() => clone(state[key].find((record) => matches(record, filter)) || null)));
    patch(model, "findById", (id) => query(() => clone(state[key].find((record) => same(record._id, id)) || null)));
    patch(model, "exists", (filter) => query(() => clone(state[key].find((record) => matches(record, filter)) || null)));
    patch(model, "find", (filter = {}) => query(() => clone(state[key].filter((record) => matches(record, filter)))));
    patch(model, "init", async () => model);
    patch(model, "findOneAndUpdate", (filter, changes) => query(() => {
      failure(key); const record = state[key].find((item) => matches(item, filter));
      if (!record) return null;
      update(record, changes); if (key === "appointments") record.updatedAt = new Date();
      return clone(record);
    }));
    patch(model, "updateOne", async (filter, changes, options) => {
      if (key === "users" && changes.$inc?.schedulingRevision) {
        if (!options?.session) throw new Error("Missing lock transaction");
        lockCalls.push(String(filter._id));
      }
      failure(key);
      // Transition-only fixtures imply an existing provider; HTTP fixtures seed actual users.
      if (key === "users" && !state.users.some(row => matches(row, filter)) &&
        [...state.appointments, ...state.slots].some(row => same(row.faculty, filter._id)))
        state.users.push({ _id: String(filter._id), role: "faculty", accountStatus: "Active" });
      const record = state[key].find((item) => matches(item, filter));
      if (!record) return { matchedCount: 0, modifiedCount: 0 };
      update(record, changes); return { matchedCount: 1, modifiedCount: 1 };
    });
    patch(model, "findOneAndDelete", (filter) => query(() => {
      failure(key);
      const index = state[key].findIndex(record => matches(record, filter));
      return index < 0 ? null : clone(state[key].splice(index, 1)[0]);
    }));
    patch(model, "deleteMany", async (filter) => { failure(key); state[key] = state[key].filter((record) => !matches(record, filter)); });
  }
  patch(Availability, "create", async records => records.map(record => {
    failure("slots");
    const model = new Availability(record); const error = model.validateSync(); if (error) throw error;
    const stored = clone({ ...model.toObject(), id: model.id, __v: 0 }); state.slots.push(stored); return clone(stored);
  }));
  patch(AttendanceResponse.collection, "indexes", async () => [{ key: { appointment: 1, participant: 1 }, unique: true }, { key: { appointment: 1, participantRole: 1 }, unique: true }]);
  patch(AttendanceReview.collection, "indexes", async () => [{ key: { appointment: 1 }, unique: true, partialFilterExpression: { isFinal: true } }]);
  patch(AttendanceReview, "create", async records => {
    failure("reviews");
    for (const record of records) {
      if (record.isFinal && state.reviews.some(old => same(old.appointment, record.appointment) && old.isFinal)) throw Object.assign(new Error("Duplicate final review"), { code: 11000 });
      const model = new AttendanceReview(record); await model.validate();
      state.reviews.push(clone({ ...record, _id: String(model._id) }));
    }
    return clone(state.reviews.slice(-records.length));
  });
  patch(AttendanceResponse, "create", async records => {
    failure("responses");
    for (const r of records) {
      if (state.responses.some(old => same(old.appointment, r.appointment) && (same(old.participant, r.participant) || old.participantRole === r.participantRole))) throw Object.assign(new Error("Duplicate response"), { code: 11000 });
      const error = new AttendanceResponse(r).validateSync(); if (error) throw error;
      state.responses.push(clone(r));
    } return clone(records);
  });
  patch(Appointment, "create", async (records) => {
    failure("appointments");
    return records.map((record) => {
      const error = new Appointment(record).validateSync(); if (error) throw error;
      const stored = clone({ ...record, _id: record._id || newId(), updatedAt: new Date() }); state.appointments.push(stored); return clone(stored);
    });
  });
  patch(OneTimeScheduleHold, "insertMany", async (records) => {
    failure("holds");
    for (const record of records) {
      if (state.holds.some((hold) => hold.minute === record.minute &&
        (same(hold.faculty, record.faculty) || same(hold.student, record.student)))) throw Object.assign(new Error("Duplicate hold"), { code: 11000 });
      state.holds.push(clone(record));
    }
  });
  patch(OneTimeScheduleHold, "bulkWrite", async (operations) => {
    failure("holds");
    for (const { updateOne: operation } of operations) {
      const owned = state.holds.find((hold) => matches(hold, operation.filter));
      if (owned) { update(owned, operation.update); continue; }
      const record = clone({ ...operation.filter, ...operation.update.$set });
      if (state.holds.some((hold) => hold.minute === record.minute &&
        (same(hold.faculty, record.faculty) || same(hold.student, record.student))))
        throw Object.assign(new Error("Duplicate hold"), { code: 11000 });
      state.holds.push(record);
    }
  });
  for (const [model, key] of [[AuditLog, "audits"], [Notification, "notifications"]]) patch(model, "create", async (records) => {
    failure(key); for (const record of records) { await new model(record).validate(); }
    if (key === "notifications") for (const record of records) {
      if (record.deduplicationKey && state.notifications.some(old => same(old.recipient, record.recipient) && old.deduplicationKey === record.deduplicationKey)) throw Object.assign(new Error("Duplicate notification"), { code: 11000 });
    }
    state[key].push(...clone(records)); return clone(records);
  });
  return { state, lockCalls, fail: (name) => { failAt = name; }, retry: () => { retryOnce = true; }, restore: () => restores.reverse().forEach((restore) => restore()) };
}

export function fixture(overrides = {}) {
  return { _id: newId(), student: newId(), faculty: newId(), availability: newId(), __v: 0,
    status: "Pending", startAt: new Date("2099-01-01T02:00:00Z"), endAt: new Date("2099-01-01T02:30:00Z"),
    bookingMethod: "published_slot", subject: "Project consultation", reason: "Discuss scope", consultationMode: "Online",
    meetingPlatform: "Teams", reservationToken: "owned-reservation", updatedAt: new Date("2026-01-01"),
    statusHistory: [], scheduleHistory: [], ...overrides };
}
export function addSlot(harness, record) {
  harness.state.slots.push({ _id: record.availability, faculty: record.faculty, startAt: record.startAt,
    endAt: record.endAt, mode: record.consultationMode, location: record.location, meetingPlatform: record.meetingPlatform,
    meetingLink: "https://example.invalid/private", isActive: true, reservationToken: record.reservationToken });
}
