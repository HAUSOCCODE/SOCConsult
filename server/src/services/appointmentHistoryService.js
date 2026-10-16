import mongoose from "mongoose";

export const safeReason = (value = "") => {
  if (typeof value !== "string") throw Object.assign(new Error("Reason must be text."), { statusCode: 400 });
  const clean = value.replace(/<[^>]*>/g, "").replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/https?:\/\/\S+/gi, "[link removed]")
    .replace(/\b(?:bearer\s+\S+|(?:password|secret|token|api[_ -]?key)\s*[:=]\s*\S+)/gi, "[redacted]")
    .trim();
  if (clean.length > 500) throw Object.assign(new Error("Reason must be 500 characters or fewer."), { statusCode: 400 });
  return clean;
};

export function statusHistoryEntry({ from, to, actor, action, reason, now }) {
  return {
    _id: new mongoose.Types.ObjectId(), previousStatus: from, newStatus: to,
    changedBy: actor.id || undefined,
    changedByRole: actor.role === "system" ? "System" : actor.role[0].toUpperCase() + actor.role.slice(1),
    actorType: actor.role === "system" ? "system" : "user",
    changedAt: now, source: action, reason: safeReason(reason),
  };
}

export function scheduleSnapshot(appointment, proposed = false) {
  const startAt = new Date(proposed ? appointment.proposedStartAt : appointment.startAt);
  const endAt = new Date(proposed ? appointment.proposedEndAt : appointment.endAt);
  if (!Number.isFinite(startAt.getTime()) || !Number.isFinite(endAt.getTime()) || endAt <= startAt)
    return null;
  const parts = (date) => Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date).map(({ type, value }) => [type, value]));
  const start = parts(startAt), end = parts(endAt);
  return {
    consultationDate: `${start.year}-${start.month}-${start.day}`, startAt, endAt,
    startTime: `${start.hour}:${start.minute}`, endTime: `${end.hour}:${end.minute}`,
    durationMinutes: Math.round((endAt - startAt) / 60000),
    mode: proposed ? appointment.proposedConsultationMode : appointment.consultationMode,
    location: proposed ? appointment.proposedLocation : appointment.location,
    meetingPlatform: proposed ? appointment.proposedMeetingPlatform : appointment.meetingPlatform,
  };
}
