import User from "../models/User.js";

// Scheduling writers share account revisions and acquire them in ID order.
// $inc initializes missing legacy fields without a backfill.
export async function lockProviderSchedules(participantIds, session) {
  if (!session) throw new Error("Scheduling requires a transaction.");
  const ids = [...new Set(participantIds.map(id => String(id?._id || id)))].sort();
  for (const id of ids) {
    const result = await User.updateOne({ _id: id },
      { $inc: { schedulingRevision: 1 } }, { session, timestamps: false });
    if (!result.matchedCount) throw Object.assign(new Error("Consultation participant not found."), { statusCode: 404 });
  }
}
