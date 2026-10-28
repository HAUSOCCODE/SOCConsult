// Uses raw collections so legacy roles can be converted after schema validation changes.
export async function migrateDeanAccount({ users, username }) {
  const account = await users.findOne({ username });
  const management = await users.find({ role: { $in: ["admin", "dean"] } }).toArray();
  if (management.some((user) => !account || String(user._id) !== String(account._id))) {
    throw new Error("Management account conflict. Resolve the account selection manually; no accounts were changed.");
  }
  if (!account) return { status: "missing" };
  if (!["admin", "dean"].includes(account.role)) {
    throw new Error("Configured username belongs to another role. No accounts were changed.");
  }
  const converted = account.role === "admin";
  if (converted) {
    const result = await users.updateOne(
      { _id: account._id, role: "admin" },
      { $set: { role: "dean" } },
    );
    if (result.modifiedCount !== 1) throw new Error("Account changed during migration. Retry after checking management accounts.");
  }
  // Repeat metadata updates even after conversion, allowing interrupted runs to recover.
  await users.updateMany({ approvalMethod: "admin" }, { $set: { approvalMethod: "dean" } });
  // Preserve historical audit roles; legacy interpretation belongs to readers.
  return { status: converted ? "converted" : "already-dean" };
}
