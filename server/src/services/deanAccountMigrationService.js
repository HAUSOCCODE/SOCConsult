// Uses raw collections so legacy roles can be converted after schema validation changes.
export class DeanInitializationError extends Error {}
export const storedManagementRoles = Object.freeze(["admin", "dean"]);

export async function migrateDeanAccount({ users, session }) {
  const options = { session };
  const [account, conflict] = await users.find(
    { role: { $in: storedManagementRoles } },
    { ...options, projection: { role: 1 }, limit: 2 },
  ).toArray();
  if (conflict)
    throw new DeanInitializationError("Management account conflict. Ask the institutional administrator to reconcile the stored Dean and legacy Admin accounts.");
  if (!account) return { status: "missing" };
  const converted = account.role === "admin";
  if (converted) {
    const result = await users.updateOne(
      { _id: account._id, role: "admin" },
      { $set: { role: "dean" } },
      options,
    );
    if (result.modifiedCount !== 1)
      throw new DeanInitializationError("Management account changed during migration. Check the stored roles and retry startup.");
  }
  // Repeat metadata updates even after conversion, allowing interrupted runs to recover.
  await users.updateMany({ approvalMethod: "admin" }, { $set: { approvalMethod: "dean" } }, options);
  // Preserve historical audit roles; legacy interpretation belongs to readers.
  return { status: converted ? "converted" : "already-dean" };
}
