import { CalendarPlus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { StatusBadge } from "../UI";
import SupportingDocumentViewer from "./SupportingDocumentViewer";
import OnlineMeetingDetails from "./OnlineMeetingDetails";
import {
  canStudentCancelAppointment,
  getAppointmentDisplayStatus,
} from "../../utils/appointmentStatus";
import { formatPersonName } from "../../utils/formatPersonName";
import { api } from "../../api/apiClient";
import StudentAttendanceResponseForm from "../attendance/StudentAttendanceResponseForm";
import AttendanceResponseSummary from "../attendance/AttendanceResponseSummary";
import { safeStudentError } from "../../utils/studentUiErrors";

const ATTENDANCE_STATUSES = new Set([
  "Awaiting Attendance Update",
  "Attendance Review",
  "Completed",
  "Expired",
]);

const safeDate = (value, options) => {
  if (!value) return "Not scheduled yet";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString("en-PH", { timeZone: "Asia/Manila", ...options })
    : "Not provided";
};
const clock = (value) =>
  safeDate(value, { hour: "numeric", minute: "2-digit" });
const manilaFilename = (value) => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "SOCConsult-Consultation.ics";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(date)
      .filter(({ type }) => type !== "literal")
      .map(({ type, value: part }) => [type, part]),
  );
  return `SOCConsult-Consultation-${parts.year}-${parts.month}-${parts.day}.ics`;
};
export default function StudentAppointmentDetailsModal({
  appointment,
  onClose,
  onRespondToProposal,
  onCancelConsultation,
  onAttendanceUpdated,
  readOnly = false,
  historyMode = false,
}) {
  const displayStatus = getAppointmentDisplayStatus(appointment);
  const [downloadingCalendar, setDownloadingCalendar] = useState(false);
  const [calendarMessage, setCalendarMessage] = useState("");
  const [attendance, setAttendance] = useState(null);
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [attendanceError, setAttendanceError] = useState("");
  const appointmentId = appointment?._id || appointment?.id;
  const canDownloadCalendar =
    !historyMode && appointment?.status === "Confirmed" && Boolean(appointmentId);
  const shouldLoadAttendance =
    Boolean(appointmentId) && ATTENDANCE_STATUSES.has(appointment?.status);
  const appointmentEnd = new Date(appointment?.endAt);
  const consultationEnded =
    Number.isFinite(appointmentEnd.getTime()) && Date.now() >= appointmentEnd.getTime();
  const loadAttendance = async () => {
    if (!shouldLoadAttendance) return null;
    setAttendanceLoading(true);
    setAttendanceError("");
    try {
      const data = await api(`/appointments/${appointmentId}/attendance`);
      setAttendance(data.attendance || null);
      return data.attendance || null;
    } catch (error) {
      setAttendanceError(safeStudentError(error, "Unable to load attendance information. Please try again."));
      return null;
    } finally {
      setAttendanceLoading(false);
    }
  };
  const submitAttendance = async (input) => {
    try {
      await api(`/appointments/${appointmentId}/attendance-responses`, {
        method: "POST",
        body: JSON.stringify(input),
      });
    } catch (error) {
      if (error.status === 409) {
        const current = await loadAttendance();
        if (current?.ownResponse) {
          await onAttendanceUpdated?.();
          return;
        }
      }
      throw error;
    }
    setAttendance((current) => ({
      ...(current || {}),
      status: current?.status || appointment.status,
      eligible: false,
      waiting: true,
      ownResponse: {
        outcome: input.outcome,
        reason: input.reason,
        submittedAt: new Date().toISOString(),
      },
    }));
    const refreshed = await loadAttendance();
    if (!refreshed)
      setAttendanceError("Your response was submitted, but the latest attendance status could not be refreshed.");
    await onAttendanceUpdated?.();
  };
  const downloadCalendar = async () => {
    if (!canDownloadCalendar || downloadingCalendar) return;
    setDownloadingCalendar(true);
    setCalendarMessage("");
    try {
      const { blob, filename } = await api.download(
        `/appointments/${appointmentId}/calendar.ics`,
      );
      const objectUrl = URL.createObjectURL(blob);
      try {
        const anchor = document.createElement("a");
        anchor.href = objectUrl;
        anchor.download = filename || manilaFilename(appointment.startAt);
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
      setCalendarMessage("Calendar file downloaded.");
    } catch (error) {
      setCalendarMessage(safeStudentError(error, "Unable to download the calendar file."));
    } finally {
      setDownloadingCalendar(false);
    }
  };
  useEffect(() => {
    const previous = document.body.style.overflow;
    const escape = (event) => event.key === "Escape" && onClose();
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", escape);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", escape);
    };
  }, [onClose]);
  useEffect(() => {
    setAttendance(null);
    setAttendanceError("");
    if (shouldLoadAttendance) void loadAttendance();
  }, [appointmentId, appointment?.status]);

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex h-[100dvh] w-full min-w-0 items-center justify-center bg-black/50 p-3 sm:p-4"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="student-appointment-title"
        onMouseDown={(event) => event.stopPropagation()}
        className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white shadow-2xl"
      >
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4 sm:px-6">
          <div>
            <h2
              id="student-appointment-title"
              className="text-xl font-bold text-maroon-900"
            >
              {historyMode ? "Historical Consultation Details" : "Consultation Details"}
            </h2>
            <p className="mt-1 font-semibold text-slate-700">
              {appointment.subject || "Consultation"}
            </p>
            <div className="mt-2">
              <StatusBadge appointment status={displayStatus} />
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            autoFocus
            aria-label="Close appointment details"
            className="rounded-lg p-1 text-slate-500 hover:bg-slate-100"
          >
            <X />
          </button>
        </header>

        <div className="space-y-6 px-5 py-5 sm:px-6">
          <div className="grid min-w-0 gap-6 md:grid-cols-2">
            <Section title="Consultation Information">
              <Detail label="Subject or Course" value={appointment.subject} />
              <Detail
                label="Consultation Concern"
                value={appointment.reason}
                wide
              />
              <Detail label="Status" value={displayStatus} />
              <Detail label="Final attendance outcome" value={appointment.attendanceSummary?.finalOutcome || "Unresolved / not verified"} />
              <Detail
                label="Date Submitted"
                value={safeDate(appointment.createdAt)}
              />
            </Section>
            <Section title="Faculty Information">
              <Detail
                label="Faculty Name"
                value={formatPersonName(appointment.faculty?.name)}
              />
              <Detail
                label="Position / Designation"
                value={appointment.faculty?.position || "Position not provided"}
              />
              <Detail
                label="Specialization"
                value={appointment.faculty?.specialization}
              />
              <Detail label="Office" value={appointment.faculty?.office} />
            </Section>
          </div>

          <Section title="Schedule">
            <Detail
              label="Consultation Date"
              value={safeDate(appointment.startAt, {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            />
            <Detail
              label="Consultation Time"
              value={
                appointment.startAt
                  ? `${clock(appointment.startAt)} – ${clock(appointment.endAt)}`
                  : "Not scheduled yet"
              }
            />
            <Detail
              label="Consultation Mode"
              value={appointment.consultationMode}
            />
            {appointment.consultationMode === "Face-to-Face" && (
              <Detail label="Location" value={appointment.location} />
            )}
          </Section>

          {shouldLoadAttendance && attendanceLoading && !attendance && (
            <p className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700" role="status">Loading attendance information...</p>
          )}
          {shouldLoadAttendance && attendanceError && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">
              <p className="break-words">{attendanceError}</p>
              {!attendance?.ownResponse && <button type="button" onClick={loadAttendance} className="mt-3 font-bold underline">Try again</button>}
            </div>
          )}
          {!readOnly && appointment.status === "Awaiting Attendance Update" && consultationEnded && attendance && !attendance.ownResponse && attendance.eligible && (
            <StudentAttendanceResponseForm onSubmit={submitAttendance} />
          )}
          {appointment.status === "Awaiting Attendance Update" && attendance && !attendance.ownResponse && !attendance.eligible && !attendanceLoading && (
            <p className="rounded-xl border border-orange-200 bg-orange-50 p-4 text-sm leading-6 text-orange-900">
              Attendance submission is not currently available. Responses open after the consultation ends and remain subject to the backend response window.
            </p>
          )}
          {attendance?.ownResponse && <AttendanceResponseSummary attendance={attendance} />}
          {!attendance?.ownResponse && ["Attendance Review", "Completed", "Expired"].includes(appointment.status) && attendance && (
            <AttendanceResponseSummary attendance={attendance} />
          )}

          <OnlineMeetingDetails
            appointment={appointment}
            allowLink={["Confirmed", "Completed"].includes(appointment.status) && !historyMode}
            actionLabel="Join Meeting"
          />

          {canDownloadCalendar && (
            <section className="min-w-0 rounded-xl border border-gold-300 bg-gold-50 p-4">
              <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <h3 className="font-bold text-maroon-900">Add to Calendar</h3>
                  <p className="mt-1 break-words text-sm leading-6 text-slate-700">
                    This file adds a copy of the consultation to a compatible calendar. Changes made in the external calendar will not update SOCConsult.
                  </p>
                  {calendarMessage && (
                    <p className="mt-2 break-words text-sm font-semibold text-slate-700" role="status">
                      {calendarMessage}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={downloadCalendar}
                  disabled={downloadingCalendar}
                  className="btn-primary inline-flex min-h-10 w-full shrink-0 items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                >
                  <CalendarPlus size={17} aria-hidden="true" />
                  {downloadingCalendar ? "Downloading..." : "Download .ics"}
                </button>
              </div>
            </section>
          )}

          {appointment.status === "Rejected" && appointment.responseNote && (
            <Section title="Status Details">
              <Detail
                label="Rejection Reason"
                value={appointment.responseNote}
                wide
              />
            </Section>
          )}
          {appointment.status === "Cancelled" && (
            <Section title="Status Details">
              <Detail
                label="Cancellation Reason"
                value={appointment.cancellationReason || "Not provided"}
                wide
              />
            </Section>
          )}
          {appointment.status === "Expired" && (
            <Section title="Status Details">
              <Detail label="Expiration" value={appointment.expirationReason || "This consultation request expired before it could proceed."} wide />
            </Section>
          )}
          {appointment.status === "Completed" && (
            <Section title="Status Details">
              <Detail
                label="Attendance Finalized"
                value={appointment.attendanceSummary?.finalizedAt ? safeDate(appointment.attendanceSummary.finalizedAt) : "Historical Completed: attendance not verified"}
              />
              <Detail
                label="Consultation Summary"
                value={appointment.responseNote || "Not provided"}
              />
            </Section>
          )}
          {appointment.status === "Reschedule Proposed" && (
            <Section title="Status Information">
              <Detail
                label="Original Schedule"
                value={`${safeDate(appointment.startAt)} – ${clock(appointment.endAt)}`}
                wide
              />
            </Section>
          )}
          {appointment.status === "Reschedule Proposed" && (
            <Section title="Proposed Schedule">
              <Detail
                label="Date and Time"
                value={`${safeDate(appointment.proposedStartAt)} – ${clock(appointment.proposedEndAt)}`}
                wide
              />
              <Detail label="Mode" value={appointment.proposedConsultationMode} />
              <Detail
                label="Location / Platform"
                value={
                  appointment.proposedConsultationMode === "Face-to-Face"
                    ? appointment.proposedLocation
                    : appointment.proposedMeetingPlatform
                }
              />
              <Detail label="Faculty Note / Reason" value={appointment.proposalNote} wide />
            </Section>
          )}

          {appointment.scheduleHistory?.length > 0 && (
            <Section title="Reschedule History">
              {appointment.scheduleHistory
                .slice()
                .reverse()
                .map((entry) => (
                  <div
                    key={entry._id || entry.createdAt}
                    className="sm:col-span-2 rounded-lg border border-amber-200 bg-amber-50 p-3"
                  >
                    <p className="font-bold text-amber-900">
                      Schedule changed by {entry.initiatedByRole || "Faculty"}
                    </p>
                    <p className="mt-2 text-sm text-slate-700">
                      <strong>Previous:</strong>{" "}
                      {safeDate(entry.previous?.startAt)} –{" "}
                      {clock(entry.previous?.endAt)}
                    </p>
                    <p className="mt-1 text-sm text-slate-700">
                      <strong>New:</strong> {safeDate(entry.next?.startAt)} –{" "}
                      {clock(entry.next?.endAt)}
                    </p>
                    <p className="mt-1 break-words text-sm text-slate-700">
                      <strong>Changed from:</strong> {entry.previous?.mode}
                      {entry.previous?.mode === "Face-to-Face"
                        ? ` · ${entry.previous?.location || "Location not provided"}`
                        : ` · ${entry.previous?.meetingPlatform || "Online meeting"}`}
                    </p>
                    <p className="mt-1 break-words text-sm text-slate-700">
                      <strong>Changed to:</strong> {entry.next?.mode}
                      {entry.next?.mode === "Face-to-Face"
                        ? ` · ${entry.next?.location || "Location not provided"}`
                        : ` · ${entry.next?.meetingPlatform || "Online meeting"}`}
                    </p>
                    <p className="mt-1 break-words text-sm text-slate-700">
                      <strong>Reason:</strong> {entry.reason}
                    </p>
                    {entry.response && (
                      <p className="mt-1 break-words text-sm font-semibold text-slate-700">
                        Student response: {entry.response}
                      </p>
                    )}
                  </div>
                ))}
            </Section>
          )}

          {historyMode && appointment.statusHistory?.length > 0 && (
            <Section title="Status History">
              <ol className="sm:col-span-2 space-y-3">
                {appointment.statusHistory.map((entry, index) => (
                  <li key={`${entry.changedAt}-${index}`} className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="break-words text-sm font-bold text-slate-900">
                      {entry.previousStatus || "Previous state"} → {entry.newStatus}
                    </p>
                    <p className="mt-1 break-words text-xs text-slate-600">
                      {safeDate(entry.changedAt)} · {entry.changedByRole || "System"}
                    </p>
                  </li>
                ))}
              </ol>
            </Section>
          )}

          <Section title="Supporting Documents">
            <div className="sm:col-span-2">
              <SupportingDocumentViewer appointment={appointment} />
            </div>
          </Section>
        </div>
        <footer className="sticky bottom-0 flex flex-col gap-2 border-t border-slate-200 bg-white px-4 py-4 sm:flex-row sm:justify-end sm:px-6">
          {!readOnly && canStudentCancelAppointment(appointment) && onCancelConsultation && (
            <button type="button" onClick={onCancelConsultation} className="min-h-10 w-full rounded-lg bg-red-700 px-4 text-sm font-bold text-white hover:bg-red-800 sm:w-auto">
              Cancel Consultation
            </button>
          )}
          {!readOnly && appointment.status === "Reschedule Proposed" && onRespondToProposal && (
            <button type="button" onClick={onRespondToProposal} className="btn-primary w-full sm:w-auto">
              View Proposal / Respond
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary w-full sm:w-auto"
          >
            Close
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

function Section({ title, children }) {
  return (
    <section className="min-w-0 rounded-xl border border-slate-200 p-4">
      <h3 className="mb-4 break-words font-bold text-maroon-900">{title}</h3>
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}
function Detail({ label, value, wide = false }) {
  return (
    <div className={`min-w-0 ${wide ? "sm:col-span-2" : ""}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-1 break-words text-sm text-slate-800">
        {value || "Not provided"}
      </p>
    </div>
  );
}
