import Appointment from "../models/Appointment.js";
import { safeDocuments, safeStudentHistoryRecord } from "./studentConsultationHistoryService.js";

const snapshot = value => value ? {
  startAt: value.startAt, endAt: value.endAt, mode: value.mode,
  location: value.mode === "Face-to-Face" ? value.location : undefined,
  meetingPlatform: value.meetingPlatform,
} : undefined;
const safeLink = value => {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? value : undefined;
  } catch { return undefined; }
};

export async function studentAppointmentDetails({ student, id }) {
  const notFound = () => { throw Object.assign(new Error("Consultation not found or unavailable."), { statusCode: 404 }); };
  if (typeof id !== "string" || !/^[a-f\d]{24}$/i.test(id)) notFound();
  const row = await Appointment.findOne({ _id: id, student })
    .select("faculty subject reason startAt endAt estimatedDurationMinutes consultationMode location meetingPlatform +meetingLink status createdAt responseNote cancellationReason expirationReason supportingDocument.name supportingDocument.mimeType supportingDocument.size supportingDocuments statusHistory scheduleHistory initiatedByRole requestedConsultationDate requestedConsultationTime availableTimeSlots proposedStartAt proposedEndAt proposedConsultationMode proposedLocation proposedMeetingPlatform proposalNote +attendance availability")
    .populate("faculty", "name firstName middleName lastName position specialization office")
    .populate("availability", "mode meetingPlatform +meetingLink")
    .maxTimeMS(10000).lean();
  if (!row) notFound();
  const [hydrated] = await safeDocuments([row]);
  const appointment = safeStudentHistoryRecord(hydrated);
  Object.assign(appointment, {
    initiatedByRole: row.initiatedByRole,
    proposedStartAt: row.proposedStartAt, proposedEndAt: row.proposedEndAt,
    proposedConsultationMode: row.proposedConsultationMode,
    proposedLocation: row.proposedConsultationMode === "Face-to-Face" ? row.proposedLocation : undefined,
    proposedMeetingPlatform: row.proposedMeetingPlatform, proposalNote: row.proposalNote,
    scheduleHistory: (row.scheduleHistory || []).map(entry => ({
      previous: snapshot(entry.previous), next: snapshot(entry.next), reason: entry.reason,
      initiatedByRole: entry.initiatedByRole, createdAt: entry.createdAt, response: entry.response,
    })),
  });
  if (row.consultationMode === "Online") {
    appointment.location = undefined;
    appointment.meetingPlatform ||= row.availability?.meetingPlatform;
    if (["Confirmed", "Completed"].includes(row.status))
      appointment.meetingLink = safeLink(row.meetingLink || row.availability?.meetingLink);
  }
  return { appointment };
}
