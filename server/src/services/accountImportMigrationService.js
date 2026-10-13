// Raw collections only; this module never connects or loads environment files.
export const institutionalIndex = {
  key: { institutionalId: 1 },
  name: "institutionalId_unique_nonempty",
  unique: true,
  partialFilterExpression: { institutionalId: { $type: "string", $gt: "" } },
};
const singleIndex = (index, field) => index.key?.[field] === 1 && Object.keys(index.key).length === 1;
const binaryIndex = (index) => !index.collation || index.collation.locale === "simple";
export function hasIdentityIndexes(indexes) {
  return ["email", "username"].every((field) => indexes.some((index) =>
    singleIndex(index, field) && index.unique === true && !index.partialFilterExpression && binaryIndex(index),
  )) && indexes.some((index) => singleIndex(index, "institutionalId") && index.unique === true && binaryIndex(index) &&
    index.partialFilterExpression?.institutionalId?.$type === "string" &&
    index.partialFilterExpression?.institutionalId?.$gt === "" &&
    Object.keys(index.partialFilterExpression).length === 1 &&
    Object.keys(index.partialFilterExpression.institutionalId).length === 2);
}
export function hasRetentionIndex(indexes) {
  return !indexes.some((index) => singleIndex(index, "expiresAt") && index.expireAfterSeconds != null) &&
    indexes.some((index) => singleIndex(index, "purgeAt") && index.expireAfterSeconds === 0 && !index.partialFilterExpression);
}
const clean = (value) => typeof value === "string" ? value.trim() : "";
const asString = (field) => ({ $convert: { input: `$${field}`, to: "string", onError: "", onNull: "" } });
const trimmed = (field) => ({ $trim: { input: asString(field) } });
// Indexes alone are insufficient if older users have not been backfilled.
export const identityAnomalyQuery = {
  $expr: { $or: [
    ...["institutionalId", "studentId", "employeeId"].map((field) => ({
      $not: [{ $in: [{ $type: `$${field}` }, ["string", "missing", "null"]] }],
    })),
    { $and: [ { $in: ["$role", ["student", "faculty"]] }, { $eq: [trimmed("institutionalId"), ""] } ] },
    { $ne: [asString("institutionalId"), trimmed("institutionalId")] },
    ...["studentId", "employeeId"].map((field) => ({ $and: [
      { $ne: [trimmed(field), ""] }, { $ne: [trimmed(field), asString("institutionalId")] },
    ] })),
    { $and: [ { $eq: ["$role", "student"] }, { $eq: [trimmed("studentId"), ""] } ] },
    { $and: [ { $eq: ["$role", "faculty"] }, { $eq: [trimmed("employeeId"), ""] } ] },
  ] },
};
export async function assertImportPrerequisites({ users, imports, db }) {
  const userIndexes = await users.indexes();
  const importIndexes = await imports.indexes();
  if (!hasIdentityIndexes(userIndexes) || !hasRetentionIndex(importIndexes) ||
      await users.findOne(identityAnomalyQuery, { projection: { _id: 1 } }))
    throw Object.assign(new Error("Import prerequisites unavailable."), { code: "SERVICE_UNAVAILABLE" });
  const topology = await db.admin().command({ hello: 1 });
  if (!topology.setName && topology.msg !== "isdbgrid")
    throw Object.assign(new Error("Transactions unavailable."), { code: "SERVICE_UNAVAILABLE" });
}

export async function migrateAccountImport({ users, imports, apply = false, now = new Date() }) {
  const counts = { users: 0, missingIds: 0, emptyIdFields: 0, invalidIdTypes: 0, conflictingIdRecords: 0,
    duplicateIds: 0, duplicateEmails: 0, duplicateUsernames: 0, canonicalBackfills: 0 };
  const ids = new Map(), emails = new Map(), usernames = new Map(), backfills = [];
  const add = (map, value, id) => {
    if (!value) return;
    if (!map.has(value)) map.set(value, new Set());
    map.get(value).add(String(id));
  };
  const cursor = users.find({}, { projection: { institutionalId: 1, studentId: 1, employeeId: 1, email: 1, username: 1, role: 1 } });
  for await (const user of cursor) {
    counts.users++;
    const fields = ["institutionalId", "studentId", "employeeId"];
    for (const field of fields) {
      if (user[field] != null && typeof user[field] !== "string") counts.invalidIdTypes++;
      if (typeof user[field] === "string" && !clean(user[field])) counts.emptyIdFields++;
    }
    const values = new Set(fields.map((field) => clean(user[field])).filter(Boolean));
    const roleField = user.role === "student" ? "studentId" : user.role === "faculty" ? "employeeId" : null;
    if (roleField && !clean(user[roleField])) counts.missingIds++;
    if (values.size > 1) counts.conflictingIdRecords++;
    for (const value of values) add(ids, value, user._id);
    add(emails, clean(user.email).toLowerCase(), user._id);
    add(usernames, clean(user.username).toLowerCase(), user._id);
    if (values.size === 1) {
      const value = [...values][0];
      if (user.institutionalId !== value) backfills.push({ user, value });
    }
  }
  counts.duplicateIds = [...ids.values()].filter((owners) => owners.size > 1).length;
  counts.duplicateEmails = [...emails.values()].filter((owners) => owners.size > 1).length;
  counts.duplicateUsernames = [...usernames.values()].filter((owners) => owners.size > 1).length;
  counts.canonicalBackfills = backfills.length;
  const indexes = await users.indexes();
  const existingUnique = ["email", "username"].every((field) => indexes.some((index) =>
    singleIndex(index, field) && index.unique === true && !index.partialFilterExpression && binaryIndex(index)));
  const safe = existingUnique && !["missingIds", "invalidIdTypes", "conflictingIdRecords", "duplicateIds", "duplicateEmails", "duplicateUsernames"]
    .some((field) => counts[field] > 0);
  const result = { mode: apply ? "apply" : "inspect", counts, existingUniqueIndexes: existingUnique,
    identityIndexReady: hasIdentityIndexes(indexes), retentionIndexReady: hasRetentionIndex(await imports.indexes()), safeToApply: safe };
  if (!apply || !safe) return { ...result, applied: false };
  // Apply only under a write-maintenance window. Compare originals to refuse changed data.
  for (const { user, value } of backfills) {
    const filter = { _id: user._id };
    for (const field of ["institutionalId", "studentId", "employeeId"])
      filter[field] = Object.hasOwn(user, field) ? user[field] : { $exists: false };
    const write = await users.updateOne(filter, { $set: { institutionalId: value } });
    if (write.matchedCount !== 1) throw new Error("Migration interrupted; rerun preflight under maintenance.");
  }
  if (!hasIdentityIndexes(await users.indexes()))
    await users.createIndex(institutionalIndex.key, { name: institutionalIndex.name, unique: true,
      partialFilterExpression: institutionalIndex.partialFilterExpression, collation: { locale: "simple" } });
  // TTL replacement uses the same maintenance framework. Completed summaries never expire.
  const importIndexes = await imports.indexes();
  for (const index of importIndexes)
    if (singleIndex(index, "expiresAt") && index.expireAfterSeconds != null) await imports.dropIndex(index.name);
  await imports.updateMany({ status: { $ne: "completed" }, purgeAt: { $exists: false } },
    { $set: { purgeAt: new Date(now.getTime() + 24 * 60 * 60 * 1000) } });
  await imports.updateMany({ status: "completed" }, { $unset: { purgeAt: 1, rows: 1 } });
  if (!hasRetentionIndex(await imports.indexes()))
    await imports.createIndex({ purgeAt: 1 }, { name: "purgeAt_1", expireAfterSeconds: 0 });
  if (!hasIdentityIndexes(await users.indexes()) || !hasRetentionIndex(await imports.indexes()))
    throw new Error("Migration prerequisites unavailable.");
  return { ...result, identityIndexReady: true, retentionIndexReady: true, applied: true };
}
