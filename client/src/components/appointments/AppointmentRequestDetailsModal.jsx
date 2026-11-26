import { formatManilaDisplay } from "../../utils/formatDateTime";
import useDialogFocus from "../../hooks/useDialogFocus";
import { X } from "lucide-react";
import { useRef } from "react";
import { createPortal } from "react-dom";
import { StatusBadge } from "../UI";
import SupportingDocumentViewer from "./SupportingDocumentViewer";
import OnlineMeetingDetails from "./OnlineMeetingDetails";
import { formatPersonName } from "../../utils/formatPersonName";
import RequestedAvailability from "./RequestedAvailability";
import { REQUEST_TIMEOUT_EXPLANATION } from "../../utils/appointmentStatus";

const dateTime = (value) =>
  value ? formatManilaDisplay(new Date(value), undefined, "timestamp") : "Not scheduled";
const time = (value) =>
  value
    ? formatManilaDisplay(new Date(value), {
        hour: "numeric",
        minute: "2-digit",
      }, "time")
    : "Not scheduled";

export default function AppointmentRequestDetailsModal({
  appointment,
  onClose,
  personalRequest = false,
  actions,
}) {
  const dialogRef = useRef(null);
  useDialogFocus(dialogRef, { onClose });
  const confirmed = ["Confirmed", "Completed", "Awaiting Attendance Update", "Attendance Review"].includes(appointment.status);


  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex h-[100dvh] w-full min-w-0 items-center justify-center bg-black/50 p-3 sm:p-4"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section ref={dialogRef} tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="request-details-title"
        onMouseDown={(event) => event.stopPropagation()}
        className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white shadow-2xl"
      >
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4 sm:px-6">
          <div>
            <h2
              id="request-details-title"
              className="text-xl font-bold text-maroon-900"
            >
              Appointment Request Details
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Submitted {dateTime(appointment.createdAt)}
            </p>
            <p className="mt-1 text-xs font-bold uppercase tracking-wide text-maroon-700">Requested by {appointment.initiatedByRole === "faculty" ? "Faculty" : "Student"}</p>
            <div className="mt-2"><StatusBadge appointment status={appointment.status} allowWrap /></div>
          </div>

          <RequestedAvailability appointment={appointment} />
          <DetailSection title={confirmed ? "Confirmed Schedule" : appointment.startAt ? "Proposed Appointment Schedule" : "Confirmed Schedule"}>
            {appointment.startAt && appointment.endAt ? <>
              <Detail label="Date and Start" value={dateTime(appointment.startAt)} />
              <Detail label="End Time (Asia/Manila)" value={time(appointment.endAt)} />
              <Detail label="Duration" value={`${Math.round((new Date(appointment.endAt) - new Date(appointment.startAt)) / 60000)} minutes`} />
              <Detail label="Mode" value={appointment.consultationMode} />
            </> : <p className="text-sm text-slate-600 sm:col-span-2">Not scheduled yet</p>}
          </DetailSection>
          <button
            type="button"
            aria-label="Close appointment request details"
            onClick={onClose}
            autoFocus
            className="rounded-lg p-1 text-slate-500 hover:bg-slate-100"
          >
            <X aria-hidden="true" />
          </button>
        </header>

        <div className="space-y-6 px-5 py-5 sm:px-6">
          {appointment.status === "Expired" && <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-700">{REQUEST_TIMEOUT_EXPLANATION}</p>}
          <div className="grid min-w-0 gap-6 md:grid-cols-2">
            <DetailSection title="Student Information">
              <Detail
                label="Full Name"
                value={formatPersonName(appointment.student?.name)}
              />
              {!personalRequest && <>
              <Detail
                label="Official Student Email"
                value={appointment.student?.email}
                breakAll
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
              </>}
            </DetailSection>
            <DetailSection title="Consultation Information">
              <Detail label={personalRequest ? "Subject / Course" : "Subject / Topic"} value={appointment.subject} />
              {appointment.estimatedDurationMinutes && <Detail
                label="Estimated Consultation Time"
                value={
                  appointment.estimatedDurationMinutes
                    ? `${appointment.estimatedDurationMinutes} minutes`
                    : "Not provided"
                }
              />}
              <Detail
                label={personalRequest ? "Consultation Concern" : "Reason for Consultation"}
                value={appointment.reason}
                wide
                breakAnywhere
              />
              {appointment.notes && (
                <Detail
                  label="Notes"
                  value={appointment.notes}
                  wide
                  breakAnywhere
                />
              )}
              <Detail label="Mode" value={appointment.consultationMode} />
              {appointment.consultationMode === "Face-to-Face" && appointment.location && (
                <Detail label="Location" value={appointment.location} />
              )}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Status
                </p>
                <div className="mt-1">
                  <StatusBadge appointment status={appointment.status} />
                </div>
              </div>
            </DetailSection>
          </div>

          {!personalRequest && <OnlineMeetingDetails
            appointment={appointment}
            allowLink
            emptyLinkText="Meeting link not provided."
          />}

          <DetailSection title="Supporting Documents">
            <div className="sm:col-span-2">
              <SupportingDocumentViewer
                appointment={appointment}
                personalRequest={personalRequest}
                wrapFileNames
              />
            </div>
          </DetailSection>
        </div>
        <footer className="sticky bottom-0 flex flex-wrap gap-3 justify-end border-t border-slate-200 bg-white px-4 py-4 sm:px-6">
          {actions}
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
    window.document.body,
  );
}

function DetailSection({ title, children }) {
  return (
    <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200 p-4">
      <h3 className="mb-4 break-words font-bold text-maroon-900">{title}</h3>
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function Detail({
  label,
  value,
  wide = false,
  breakAll = false,
  breakAnywhere = false,
}) {
  return (
    <div className={`min-w-0 ${wide ? "sm:col-span-2" : ""}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p
        className={`mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-800 ${breakAll || breakAnywhere ? "[overflow-wrap:anywhere]" : "break-words"}`}
      >
        {value || "Not available"}
      </p>
    </div>
  );
}
