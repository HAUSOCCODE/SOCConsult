import { formatManilaDisplay } from "../../utils/formatDateTime";
import useDialogFocus from "../../hooks/useDialogFocus";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { EmptyState, StatusBadge } from "../UI";
import FacultyAppointmentDetailsModal from "./FacultyAppointmentDetailsModal";
import ProfileImagePreview from "../profile/ProfileImagePreview";
import { formatPersonName } from "../../utils/formatPersonName";
import ConfirmDialog from "../ConfirmDialog";

const date = (value) =>
  formatManilaDisplay(new Date(value), {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }, "date");
const time = (value) =>
  formatManilaDisplay(new Date(value), {
    hour: "numeric",
    minute: "2-digit",
  }, "time");

export default function FacultyScheduleDetailsModal({
  details,
  loading,
  error,
  onClose,
  onRetry,
  onApprove,
  onReject,
}) {
  const [appointmentDetails, setAppointmentDetails] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectNote, setRejectNote] = useState("");

  const dialogRef = useRef(null);
  const submittingRef = useRef(false);
  useDialogFocus(dialogRef, { onClose, busy: submitting || Boolean(rejectTarget) || Boolean(appointmentDetails) });


  const schedule = details?.schedule;
  const pending = details?.pendingRequests || [];
  const students = details?.approvedStudents || [];
  const rejected = details?.rejectedRequests || [];
  return createPortal(
    <div
      className="fixed inset-0 z-[9998] flex h-[100dvh] w-full min-w-0 items-center justify-center bg-black/50 p-3 sm:p-4"
      onMouseDown={(event) => event.target === event.currentTarget && !submitting && !rejectTarget && !appointmentDetails && onClose()}
    >
      <section ref={dialogRef} tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="schedule-details-title"
        onMouseDown={(event) => event.stopPropagation()}
        className="max-h-[calc(100dvh-1.5rem)] w-full max-w-5xl overflow-y-auto rounded-2xl bg-white shadow-2xl"
      >
        <ConfirmDialog
          open={Boolean(rejectTarget)}
          title="Reject Appointment Request"
          message="Are you sure you want to reject this appointment request?"
          supportingText="You may include an optional reason for the Student."
          confirmLabel="Reject"
          loadingLabel="Rejecting..."
          loading={submitting}
          inputLabel="Rejection reason (optional)"
          inputValue={rejectNote}
          onInputChange={setRejectNote}
          inputPlaceholder="Enter an optional reason"
          onCancel={() => {
            if (submitting) return;
            setRejectTarget(null);
            setRejectNote("");
          }}
          onConfirm={async () => {
            if (!rejectTarget || submittingRef.current) return;
            submittingRef.current = true;
            setSubmitting(true);
            try {
              await onReject(rejectTarget, rejectNote.trim());
              setRejectTarget(null);
              setRejectNote("");
            } finally {
              submittingRef.current = false;
              setSubmitting(false);
            }
          }}
        />
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4 sm:px-6">
          <div>
            <h2
              id="schedule-details-title"
              className="text-xl font-bold text-maroon-900"
            >
              Appointment Requests
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Review requests assigned to this exact schedule.
            </p>
          </div>
          <button
            type="button"
            disabled={submitting || Boolean(rejectTarget) || Boolean(appointmentDetails)} onClick={onClose}
            aria-label="Close schedule details"
            className="rounded-lg p-1 text-slate-500 hover:bg-slate-100"
          >
            <X aria-hidden="true" />
          </button>
        </header>

        <div className="space-y-6 px-5 py-5 sm:px-6">
          {loading && (
            <p className="py-10 text-center text-sm font-semibold text-maroon-800">
              Loading schedule and approved students...
            </p>
          )}
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              <p>{error}</p>
              <button
                type="button"
                onClick={onRetry}
                className="btn-secondary mt-3"
              >
                Try again
              </button>
            </div>
          )}
          {schedule && (
            <>
              <section className="rounded-xl border border-slate-200 p-4">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <Detail label="Date" value={date(schedule.startAt)} />
                  <Detail label="Start Time" value={time(schedule.startAt)} />
                  <Detail label="End Time" value={time(schedule.endAt)} />
                  <Detail label="Consultation Mode" value={schedule.mode} />
                  <Detail
                    label="Location / Meeting Link"
                    value={
                      schedule.mode === "Online"
                        ? schedule.meetingLink || schedule.meetingPlatform
                        : schedule.location
                    }
                    link={schedule.mode === "Online" && schedule.meetingLink}
                  />
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Schedule Status
                    </p>
                    <div className="mt-1">
                      <StatusBadge allowWrap appointment
                        status={schedule.isActive ? "Active" : "Inactive"}
                      />
                    </div>
                  </div>
                </div>
              </section>

              {pending.length === 0 &&
                students.length === 0 &&
                rejected.length === 0 && (
                  <p className="rounded-xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">
                    No appointment requests for this schedule yet.
                  </p>
                )}

              <section>
                <h3 className="text-lg font-bold text-maroon-900">
                  Pending Student Requests ({pending.length})
                </h3>
                {pending.length === 0 ? (
                  <p className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">
                    No pending student requests for this schedule yet.
                  </p>
                ) : (
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    {pending.map((appointment) => (
                      <article
                        key={appointment._id}
                        className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <ProfileImagePreview
                              user={appointment.student}
                              className="h-11 w-11 rounded-full bg-maroon-800 font-bold text-white"
                              buttonClassName="rounded-full"
                            />
                            <h4 className="break-words font-bold text-slate-900">
                              {formatPersonName(appointment.student?.name) ||
                                "Student"}
                            </h4>
                          </div>
                          <StatusBadge allowWrap appointment status={appointment.status} />
                        </div>
                        <p className="mt-3 text-sm text-slate-600">
                          Estimated Time:{" "}
                          {appointment.estimatedDurationMinutes || 0} min
                        </p>
                        <p className="mt-1 break-words text-sm text-slate-600">
                          Topic: {appointment.subject}
                        </p>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => setAppointmentDetails(appointment)}
                            className="btn-secondary"
                          >
                            View Details
                          </button>
                          <button
                            type="button"
                            disabled={submitting}
                            onClick={async () => {
                              if (submittingRef.current) return;
                              submittingRef.current = true; setSubmitting(true);
                              try { await onApprove(appointment); }
                              finally { submittingRef.current = false; setSubmitting(false); }
                            }}
                            className="rounded-lg bg-green-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            disabled={submitting}
                            onClick={() => {
                              setRejectTarget(appointment);
                              setRejectNote("");
                            }}
                            className="rounded-lg bg-red-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
                          >
                            Reject
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>

              <section>
                <h3 className="text-lg font-bold text-maroon-900">
                  Rejected ({rejected.length})
                </h3>
                {rejected.length === 0 ? (
                  <p className="mt-4 text-sm text-slate-500">
                    No rejected requests for this schedule.
                  </p>
                ) : (
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    {rejected.map((appointment) => (
                      <article
                        key={appointment._id}
                        className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <ProfileImagePreview
                              user={appointment.student}
                              className="h-11 w-11 rounded-full bg-maroon-800 font-bold text-white"
                              buttonClassName="rounded-full"
                            />
                            <div className="min-w-0">
                              <h4 className="break-words font-bold text-slate-900">
                                {formatPersonName(appointment.student?.name) ||
                                  "Student"}
                              </h4>
                              <p className="mt-1 break-words text-sm text-slate-500">
                                {appointment.subject}
                              </p>
                            </div>
                          </div>
                          <StatusBadge allowWrap appointment status={appointment.status} />
                        </div>
                        <button
                          type="button"
                          onClick={() => setAppointmentDetails(appointment)}
                          className="btn-secondary mt-4"
                        >
                          View Details
                        </button>
                      </article>
                    ))}
                  </div>
                )}
              </section>

              <section>
                <h3 className="text-lg font-bold text-maroon-900">
                  Confirmed Students ({students.length})
                </h3>
                {students.length === 0 ? (
                  <div className="mt-4">
                    <EmptyState
                      title="No approved students are currently assigned to this schedule."
                      text="Confirmed appointments for this exact schedule will appear here."
                    />
                  </div>
                ) : (
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    {students.map((appointment) => (
                      <article
                        key={appointment._id}
                        className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <ProfileImagePreview
                              user={appointment.student}
                              className="h-11 w-11 rounded-full bg-maroon-800 font-bold text-white"
                              buttonClassName="rounded-full"
                            />
                            <div className="min-w-0">
                              <h4 className="break-words font-bold text-slate-900">
                                {formatPersonName(appointment.student?.name) ||
                                  "Student"}
                              </h4>
                              <p className="[overflow-wrap:anywhere] text-sm text-slate-500">
                                {appointment.student?.email ||
                                  "Email not provided"}
                              </p>
                            </div>
                          </div>
                          <StatusBadge allowWrap appointment status={appointment.status} />
                        </div>
                        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                          <Detail
                            label="Appointment Date"
                            value={date(appointment.startAt)}
                          />
                          <Detail
                            label="Appointment Time"
                            value={`${time(appointment.startAt)} – ${time(appointment.endAt)}`}
                          />
                          <Detail
                            label="Consultation Mode"
                            value={appointment.consultationMode}
                          />
                          <Detail
                            label="Reason / Purpose"
                            value={appointment.reason}
                          />
                        </dl>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => setAppointmentDetails(appointment)}
                            className="btn-secondary"
                          >
                            View Appointment
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
        <footer className="sticky bottom-0 flex justify-end border-t border-slate-200 bg-white px-4 py-4 sm:px-6">
          <button
            type="button"
            disabled={submitting || Boolean(rejectTarget) || Boolean(appointmentDetails)} onClick={onClose}
            className="btn-secondary w-full sm:w-auto"
          >
            Close
          </button>
        </footer>
      </section>

      {appointmentDetails && (
        <FacultyAppointmentDetailsModal
          appointment={appointmentDetails}
          onClose={() => setAppointmentDetails(null)}
        />
      )}
    </div>,
    document.body,
  );
}

function Detail({ label, value, link = false }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="mt-1 break-words text-sm text-slate-800">
        {link ? (
          <a
            href={value}
            target="_blank"
            rel="noreferrer"
            className="[overflow-wrap:anywhere] font-semibold text-blue-700 hover:underline"
          >
            {value}
          </a>
        ) : (
          value || "Not provided"
        )}
      </dd>
    </div>
  );
}
