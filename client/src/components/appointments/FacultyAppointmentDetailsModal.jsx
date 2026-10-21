import PersonalConsultationDetails from "./PersonalConsultationDetails";
import { formatManilaDisplay } from "../../utils/formatDateTime";
import useDialogFocus from "../../hooks/useDialogFocus";
import { X } from "lucide-react";
import { useRef } from "react";
import { createPortal } from "react-dom";
import { StatusBadge } from "../UI";
import SupportingDocumentViewer from "./SupportingDocumentViewer";
import OnlineMeetingDetails from "./OnlineMeetingDetails";
import ProfileImagePreview from "../profile/ProfileImagePreview";
import { formatPersonName } from "../../utils/formatPersonName";

const safeDate = (value, options) => {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? formatManilaDisplay(date, { timeZone: "Asia/Manila", ...options }, "timestamp")
    : "Not provided";
};
const clock = (value) =>
  safeDate(value, { hour: "numeric", minute: "2-digit" });

export default function FacultyAppointmentDetailsModal({
  appointment,
  onClose,
  showFacultyInfo = false,
  personal = false,
  children,
  opener,
  onAttendanceSubmitted,
}) {
  const dialogRef = useRef(null);
  useDialogFocus(dialogRef, { onClose });



  if (personal) return <PersonalConsultationDetails appointment={appointment} opener={opener} onClose={onClose} onAttendanceSubmitted={onAttendanceSubmitted}>{children}</PersonalConsultationDetails>;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex h-[100dvh] w-full min-w-0 items-center justify-center bg-black/50 p-3 sm:p-4"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section ref={dialogRef} tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="faculty-appointment-title"
        onMouseDown={(event) => event.stopPropagation()}
        className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white shadow-2xl"
      >
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <h2
              id="faculty-appointment-title"
              className="text-xl font-bold text-maroon-900"
            >
              Consultation Details
            </h2>
            <p className="mt-1 break-words font-semibold text-slate-800">
              {appointment.subject || "Consultation"}
            </p>
            <div className="mt-2">
              <StatusBadge allowWrap appointment status={appointment.status} />
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            autoFocus
            aria-label="Close appointment details"
            className="shrink-0 rounded-lg p-1 text-slate-500 hover:bg-slate-100"
          >
            <X aria-hidden="true" />
          </button>
        </header>

        <div className="space-y-6 px-5 py-5 sm:px-6">
          <div className="grid min-w-0 gap-6 md:grid-cols-2">
            <Section title="Student Information">
              <div className="sm:col-span-2">
                <ProfileImagePreview
                  user={appointment.student}
                  className="h-16 w-16 rounded-2xl bg-maroon-800 text-xl font-bold text-white"
                />
              </div>
              <Detail
                label="Student Full Name"
                value={formatPersonName(appointment.student?.name)}
              />
              <Detail
                label="Student ID"
                value={appointment.student?.studentId}
              />
              <Detail label="Program" value={appointment.student?.program} />
              <Detail
                label="Year Level"
                value={appointment.yearLevel || appointment.student?.yearLevel}
              />
              <Detail
                label="Official Student Email"
                value={appointment.student?.email}
                wide
              />
            </Section>

            <Section title="Consultation Information">
              <Detail label="Subject / Topic" value={appointment.subject} />
              <Detail
                label="Estimated Consultation Time"
                value={
                  appointment.estimatedDurationMinutes
                    ? `${appointment.estimatedDurationMinutes} minutes`
                    : "Not provided"
                }
              />
              <Detail
                label="Reason for Consultation"
                value={appointment.reason}
                wide
              />
              <Detail label="Status" value={appointment.status} />
              <Detail label="Final attendance outcome" value={appointment.attendanceSummary?.finalOutcome || "Unresolved / not verified"} />
              <Detail
                label="Date Request Was Submitted"
                value={safeDate(appointment.createdAt)}
              />
            </Section>
            {showFacultyInfo && (
              <Section title="Faculty Information">
                <ProfileImagePreview
                  user={appointment.faculty}
                  className="h-16 w-16 rounded-2xl bg-maroon-800 text-xl font-bold text-white"
                />
                <Detail
                  label="Faculty Full Name"
                  value={formatPersonName(appointment.faculty?.name)}
                />
                <Detail
                  label="Position / Designation"
                  value={
                    appointment.faculty?.position || "Position not provided"
                  }
                />
                <Detail
                  label="Official Faculty Email"
                  value={appointment.faculty?.email}
                  wide
                />
              </Section>
            )}
          </div>

          <Section title="Schedule Information">
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
              label={
                appointment.bookingMethod === "schedule_request"
                  ? "Consultation Time"
                  : "Faculty Availability Window"
              }
              value={
                appointment.startAt
                  ? `${clock(appointment.startAt)} – ${clock(appointment.endAt)}`
                  : "Not scheduled"
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

          <OnlineMeetingDetails
            appointment={appointment}
            allowLink
            emptyLinkText="Meeting link not provided."
          />

          {appointment.responseNote && (
            <Section title="Status Information">
              <Detail
                label="Faculty Response"
                value={appointment.responseNote}
                wide
              />
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
                      Rescheduled by {entry.initiatedByRole || "Faculty"}
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
                      <strong>Reason:</strong> {entry.reason}
                    </p>
                  </div>
                ))}
            </Section>
          )}

          <Section title="Supporting Documents">
            <div className="sm:col-span-2">
              <SupportingDocumentViewer appointment={appointment} />
            </div>
          </Section>
        </div>

        <footer className="sticky bottom-0 flex flex-col-reverse gap-3 border-t border-slate-200 bg-white px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
          <button type="button" onClick={onClose} className="btn-secondary">
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
