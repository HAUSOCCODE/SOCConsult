import User from "../models/User.js";

// Every scheduling writer must acquire this inside its transaction before reading
// schedules. $inc initializes missing legacy fields; no backfill is necessary.
export async function lockProviderSchedules(providerIds, session) {
  if (!session) throw new Error("Scheduling requires a transaction.");
  const ids = [...new Set(providerIds.map(id => String(id?._id || id)))].sort();
  for (const id of ids) {
    const result = await User.updateOne({ _id: id },
      { $inc: { schedulingRevision: 1 } }, { session, timestamps: false });
    if (!result.matchedCount) throw Object.assign(new Error("Consultation provider not found."), { statusCode: 404 });
  }
}
