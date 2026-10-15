import { CalendarDays, Clock3, MapPin, Monitor, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../../api/apiClient";
import { useToast } from "../../context/ToastContext";
import ConfirmDialog from "../ConfirmDialog";

const validDate = (value) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
};
const dateLabel = (value) =>
  validDate(value)?.toLocaleDateString("en-PH", {
    timeZone: "Asia/Manila",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }) || "Schedule not available";
const timeLabel = (value) =>
  validDate(value)?.toLocaleTimeString("en-PH", {
    timeZone: "Asia/Manila",
    hour: "numeric",
    minute: "2-digit",
  }) || "Not available";

const Schedule = ({ title, startAt, endAt, mode, location, platform, accent }) => {
  const ModeIcon = mode === "Face-to-Face" ? MapPin : Monitor;
  return (
    <section className={`min-w-0 rounded-xl border p-4 ${accent}`}>
      <h3 className="font-bold text-maroon-900">{title}</h3>
      <div className="mt-3 space-y-2 text-sm text-slate-700">
        <p className="flex min-w-0 gap-2"><CalendarDays size={16} className="mt-0.5 shrink-0" /><span className="break-words">{dateLabel(startAt)}</span></p>
        <p className="flex min-w-0 gap-2"><Clock3 size={16} className="mt-0.5 shrink-0" /><span>{timeLabel(startAt)} – {timeLabel(endAt)}</span></p>
        <p className="flex min-w-0 gap-2"><ModeIcon size={16} className="mt-0.5 shrink-0" /><span className="break-words">{mode || "Mode not provided"}</span></p>
        <p className="break-words text-slate-600">
          {mode === "Face-to-Face"
            ? location || "Location not provided"
            : platform || "Meeting platform not provided"}
        </p>
      </div>
    </section>
  );
};

export default function StudentRescheduleResponseModal({ appointment, onClose, onSuccess, onCancelConsultation }) {
  const toast = useToast();
  const [submitting, setSubmitting] = useState("");
  const [confirmDecision, setConfirmDecision] = useState("");
  const proposalPassed = !validDate(appointment.proposedStartAt) || validDate(appointment.proposedStartAt) <= new Date();

  useEffect(() => {
    const prior = document.body.style.overflow;
    const onKey = (event) => event.key === "Escape" && !submitting && onClose();
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prior;
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose, submitting]);

  const respond = async (decision) => {
    if (submitting) return;
    setSubmitting(decision);
    try {
      const data = await api(`/appointments/${appointment._id}/reschedule-response`, {
        method: "PUT",
        body: JSON.stringify({ decision }),
      });
      toast.success(data.message || "Proposal response saved.");
      await onSuccess(data.appointment);
    } catch (error) {
      toast.error(error.message || "Unable to respond to the proposal.");
      setSubmitting("");
      setConfirmDecision("");
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex h-[100dvh] w-full items-center justify-center bg-black/55 p-3 sm:p-4" onMouseDown={(event) => event.target === event.currentTarget && !submitting && onClose()}>
      <section role="dialog" aria-modal="true" aria-labelledby="student-proposal-title" onMouseDown={(event) => event.stopPropagation()} className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-gold-700">Faculty Schedule Proposal</p>
            <h2 id="student-proposal-title" className="mt-1 break-words text-xl font-bold text-maroon-900">Respond to Reschedule Proposal</h2>
          </div>
          <button type="button" aria-label="Close proposal" disabled={Boolean(submitting)} onClick={onClose} className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-50"><X /></button>
        </header>
        <div className="space-y-5 p-4 sm:p-6">
          <div className="grid min-w-0 gap-4 md:grid-cols-2">
            <Schedule title="Original Schedule" startAt={appointment.startAt} endAt={appointment.endAt} mode={appointment.consultationMode} location={appointment.location} platform={appointment.meetingPlatform} accent="border-slate-200 bg-slate-50" />
            <Schedule title="Proposed Schedule" startAt={appointment.proposedStartAt} endAt={appointment.proposedEndAt} mode={appointment.proposedConsultationMode} location={appointment.proposedLocation} platform={appointment.proposedMeetingPlatform} accent="border-gold-300 bg-gold-50/50" />
          </div>
          <section className="rounded-xl border border-slate-200 p-4">
            <h3 className="font-bold text-maroon-900">Faculty Note / Reason</h3>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{appointment.proposalNote || "No additional note was provided."}</p>
          </section>
          {proposalPassed && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">This proposed schedule has already passed and can no longer be accepted. You may reject the proposal or cancel the consultation.</p>}
        </div>
        <footer className="sticky bottom-0 flex flex-col gap-2 border-t border-slate-200 bg-white px-4 py-4 sm:flex-row sm:flex-wrap sm:justify-end sm:px-6">
          <button type="button" disabled={Boolean(submitting)} onClick={onClose} className="btn-secondary min-h-10">Close</button>
          <button type="button" disabled={Boolean(submitting)} onClick={onCancelConsultation} className="min-h-10 rounded-lg bg-red-700 px-4 text-sm font-bold text-white disabled:opacity-50">Cancel Consultation</button>
          <button type="button" disabled={Boolean(submitting)} onClick={() => setConfirmDecision("reject")} className="min-h-10 rounded-lg border border-amber-400 px-4 text-sm font-bold text-amber-900 disabled:opacity-50">Reject Proposal</button>
          <button type="button" disabled={Boolean(submitting) || proposalPassed} onClick={() => respond("accept")} className="btn-primary min-h-10 disabled:cursor-not-allowed disabled:opacity-50">{submitting === "accept" ? "Accepting..." : "Accept Proposal"}</button>
        </footer>
        <ConfirmDialog open={confirmDecision === "reject"} title="Reject Proposal" message="Reject this schedule proposal and return the consultation to Pending for Faculty action?" confirmLabel="Reject Proposal" loadingLabel="Saving..." loading={Boolean(submitting)} onCancel={() => !submitting && setConfirmDecision("")} onConfirm={() => respond("reject")} />
      </section>
    </div>,
    document.body,
  );
}
