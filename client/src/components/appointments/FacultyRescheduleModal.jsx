import useDialogFocus from "../../hooks/useDialogFocus";
import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { api } from "../../api/apiClient";
import { formatPersonName } from "../../utils/formatPersonName";

const TIMEZONE = "Asia/Manila";
const parts = (value) => {
  const entries = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const get = (type) => entries.find((entry) => entry.type === type)?.value;
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
};
const formatDate = (value) =>
  new Intl.DateTimeFormat("en-PH", {
    timeZone: TIMEZONE,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(value));
const formatTime = (value) =>
  new Intl.DateTimeFormat("en-PH", {
    timeZone: TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
const todayInManila = () => parts(new Date()).date;

export default function FacultyRescheduleModal({
  appointment,
  opener,
  onClose,
  onSuccess,
}) {
  const dialogRef = useRef(null);
  const firstFieldRef = useRef(null);
  const submittingRef = useRef(false);
  const current = parts(appointment.startAt);
  const [form, setForm] = useState({
    consultationDate: current.date,
    startTime: current.time,
    duration: String(appointment.estimatedDurationMinutes || 30),
    mode: appointment.consultationMode || "Online",
    location: appointment.location || "",
    meetingPlatform: appointment.meetingPlatform || "",
    meetingLink: appointment.meetingLink || "",
    reason: "",
  });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const duration = Number(form.duration);
  const newEndTime = useMemo(() => {
    if (!/^\d{2}:\d{2}$/.test(form.startTime) || !Number.isFinite(duration))
      return "";
    const [hour, minute] = form.startTime.split(":").map(Number);
    const total = hour * 60 + minute + duration;
    return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  }, [duration, form.startTime]);

  useDialogFocus(dialogRef, { onClose, busy: submitting, initialFocus: firstFieldRef, restoreTarget: opener });

  const set = (name) => (event) => {
    setForm((currentForm) => ({
      ...currentForm,
      [name]: event.target.value,
    }));
    setError("");
  };
  const close = () => !submittingRef.current && onClose();
  const submit = async (event) => {
    event.preventDefault();
    if (submittingRef.current) return;
    const reason = form.reason.trim();
    if (reason.length < 5) {
      setError("Please provide a meaningful reason of at least 5 characters.");
      return;
    }
    if (form.mode === "Face-to-Face" && !form.location.trim()) {
      setError("Location is required for a face-to-face consultation.");
      return;
    }
    if (form.mode === "Online" && !form.meetingPlatform.trim()) {
      setError("Meeting platform is required for an online consultation.");
      return;
    }
    setSubmitting(true);
    submittingRef.current = true;
    try {
      const data = await api(
        `/faculty/appointments/${appointment._id}/reschedule`,
        {
          method: "PATCH",
          body: JSON.stringify({ expectedVersion: appointment.__v,
            ...form,
            duration,
            reason,
            location: form.mode === "Face-to-Face" ? form.location.trim() : "",
            meetingPlatform:
              form.mode === "Online" ? form.meetingPlatform.trim() : "",
            meetingLink: form.mode === "Online" ? form.meetingLink.trim() : "",
          }),
        },
      );
      onSuccess(data);
    } catch (requestError) {
      setError(
        requestError.message || "Unable to reschedule the consultation.",
      );
    } finally {
      setSubmitting(false);
      submittingRef.current = false;
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex h-[100dvh] w-full min-w-0 items-center justify-center bg-black/60 p-2 sm:p-4"
      onMouseDown={(event) => event.target === event.currentTarget && close()}
    >
      <section
        ref={dialogRef} tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="faculty-reschedule-title"
        onMouseDown={(event) => event.stopPropagation()}
        className="flex max-h-[calc(100dvh-1rem)] w-full max-w-3xl min-w-0 flex-col overflow-hidden rounded-2xl bg-white shadow-2xl sm:max-h-[92vh]"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <h2
              id="faculty-reschedule-title"
              className="text-xl font-bold text-maroon-900"
            >
              Reschedule Consultation
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Choose a new schedule and explain the change to the student.
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            disabled={submitting}
            aria-label="Close reschedule consultation"
            className="shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-50"
          >
            <X aria-hidden="true" size={21} />
          </button>
        </header>

        <form aria-describedby={error ? "faculty-reschedule-error" : undefined} onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6">
            <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <h3 className="font-bold text-maroon-900">
                Current Consultation
              </h3>
              <dl className="mt-3 grid min-w-0 gap-3 text-sm sm:grid-cols-2">
                <Detail
                  label="Student"
                  value={formatPersonName(appointment.student?.name)}
                />
                <Detail label="Topic" value={appointment.subject} />
                <Detail
                  label="Current date"
                  value={formatDate(appointment.startAt)}
                />
                <Detail
                  label="Current time"
                  value={`${formatTime(appointment.startAt)} – ${formatTime(appointment.endAt)}`}
                />
                <Detail
                  label="Duration"
                  value={`${appointment.estimatedDurationMinutes || Math.round((new Date(appointment.endAt) - new Date(appointment.startAt)) / 60000)} minutes`}
                />
                <Detail label="Mode" value={appointment.consultationMode} />
                <Detail
                  label="Location / Meeting"
                  value={
                    appointment.consultationMode === "Online"
                      ? appointment.meetingLink || appointment.meetingPlatform
                      : appointment.location
                  }
                  wide
                />
              </dl>
            </section>

            <div className="grid min-w-0 gap-4 sm:grid-cols-2">
              <Field label="New consultation date" required>
                <input disabled={submitting}
                  ref={firstFieldRef}
                  type="date"
                  min={todayInManila()}
                  required
                  value={form.consultationDate}
                  onChange={set("consultationDate")}
                  className="field mt-1.5"
                />
              </Field>
              <Field label="New start time" required>
                <input disabled={submitting}
                  type="time"
                  required
                  value={form.startTime}
                  onChange={set("startTime")}
                  className="field mt-1.5"
                />
              </Field>
              <Field label="Duration" required>
                <select disabled={submitting}
                  required
                  value={form.duration}
                  onChange={set("duration")}
                  className="field mt-1.5"
                >
                  {[15, 30, 45, 60, 90, 120].map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {minutes} minutes
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="New end time">
                <input disabled={submitting}
                  readOnly
                  value={newEndTime}
                  className="field mt-1.5 bg-slate-100"
                  aria-label="Calculated new end time"
                />
              </Field>
              <Field label="Consultation mode" required wide>
                <select disabled={submitting}
                  required
                  value={form.mode}
                  onChange={set("mode")}
                  className="field mt-1.5"
                >
                  <option value="Face-to-Face">Face-to-Face</option>
                  <option value="Online">Online</option>
                </select>
              </Field>
              {form.mode === "Face-to-Face" ? (
                <Field label="Location" required wide>
                  <input disabled={submitting}
                    required
                    maxLength={150}
                    value={form.location}
                    onChange={set("location")}
                    className="field mt-1.5"
                    placeholder="Room or campus location"
                  />
                </Field>
              ) : (
                <>
                  <Field label="Meeting platform" required>
                    <input disabled={submitting}
                      required
                      maxLength={100}
                      value={form.meetingPlatform}
                      onChange={set("meetingPlatform")}
                      className="field mt-1.5"
                      placeholder="Google Meet, Zoom, etc."
                    />
                  </Field>
                  <Field label="Meeting link">
                    <input disabled={submitting}
                      type="url"
                      maxLength={500}
                      value={form.meetingLink}
                      onChange={set("meetingLink")}
                      className="field mt-1.5"
                      placeholder="https://..."
                    />
                  </Field>
                </>
              )}
              <Field label="Reschedule reason" required wide>
                <textarea disabled={submitting}
                  required
                  minLength={5}
                  maxLength={500}
                  rows={4}
                  value={form.reason}
                  onChange={set("reason")}
                  className="field mt-1.5 resize-y"
                  placeholder="Faculty emergency requiring the consultation to be moved to another available time."
                />
                <span className="mt-1 block text-right text-xs text-slate-500">
                  {form.reason.length}/500
                </span>
              </Field>
            </div>
            {error && (
              <p
                id="faculty-reschedule-error" role="alert"
                className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
              >
                {error}
              </p>
            )}
          </div>

          <footer className="flex shrink-0 flex-col-reverse gap-3 border-t border-slate-200 bg-white px-4 py-4 sm:flex-row sm:justify-end sm:px-6">
            <button
              type="button"
              onClick={close}
              disabled={submitting}
              className="btn-secondary whitespace-nowrap disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="btn-primary whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Rescheduling..." : "Confirm Reschedule"}
            </button>
          </footer>
        </form>
      </section>
    </div>,
    document.body,
  );
}

function Field({ label, required, wide, children }) {
  return (
    <label
      className={`min-w-0 text-sm font-semibold text-slate-700 ${wide ? "sm:col-span-2" : ""}`}
    >
      {label}
      {required && <span className="text-red-700"> *</span>}
      {children}
    </label>
  );
}
function Detail({ label, value, wide }) {
  return (
    <div className={`min-w-0 ${wide ? "sm:col-span-2" : ""}`}>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="mt-1 break-words text-slate-800">
        {value || "Not provided"}
      </dd>
    </div>
  );
}
