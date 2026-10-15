import { CalendarDays, Clock3, Eye, MapPin, Monitor, UserRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/apiClient";
import { useToast } from "../../context/ToastContext";
import { formatPersonName } from "../../utils/formatPersonName";
import {
  ACTIVE_REQUEST_STATUSES,
  ATTENDANCE_REQUIRED_STATUSES,
  UNDER_REVIEW_STATUSES,
  canStudentCancelAppointment,
  getAppointmentDisplayStatus,
} from "../../utils/appointmentStatus";
import { EmptyState, ErrorState, Loading, StatusBadge } from "../UI";
import ConfirmDialog from "../ConfirmDialog";
import StudentAppointmentDetailsModal from "./StudentAppointmentDetailsModal";
import StudentRescheduleResponseModal from "./StudentRescheduleResponseModal";

const TABS = [
  { id: "active", label: "Active Requests", statuses: ACTIVE_REQUEST_STATUSES, empty: "No active consultation requests." },
  { id: "attendance", label: "Attendance Required", statuses: ATTENDANCE_REQUIRED_STATUSES, empty: "No consultations currently require your attendance response." },
  { id: "review", label: "Under Review", statuses: UNDER_REVIEW_STATUSES, empty: "No attendance records are currently under review." },
];
const validDate = (value) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
};
const dateLabel = (value) =>
  validDate(value)?.toLocaleDateString("en-PH", {
    timeZone: "Asia/Manila", weekday: "short", month: "short", day: "numeric", year: "numeric",
  }) || "Schedule not available";
const timeLabel = (value) =>
  validDate(value)?.toLocaleTimeString("en-PH", {
    timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit",
  }) || "Not available";

export default function StudentConsultationsView() {
  const toast = useToast();
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("active");
  const [details, setDetails] = useState(null);
  const [proposalTarget, setProposalTarget] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancellationReason, setCancellationReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const load = () => {
    setError("");
    return api("/appointments/mine")
      .then((data) => setItems(Array.isArray(data?.appointments) ? data.appointments : []))
      .catch(() => setError("Unable to load consultations. Please try again."));
  };
  useEffect(() => { void load(); }, []);
  const groups = useMemo(() => {
    const source = Array.isArray(items) ? items : [];
    return Object.fromEntries(TABS.map((entry) => [entry.id, source
      .filter((item) => entry.statuses.includes(item.status))
      .sort((left, right) => {
        const leftTime = validDate(left.startAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
        const rightTime = validDate(right.startAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
        return leftTime - rightTime || String(left._id).localeCompare(String(right._id));
      })]));
  }, [items]);
  const selectedTab = TABS.find((entry) => entry.id === tab) || TABS[0];
  const shown = groups[tab] || [];
  const cancel = async () => {
    if (!cancelTarget || cancelling) return;
    setCancelling(true);
    try {
      const data = await api(`/appointments/${cancelTarget._id}/cancel`, {
        method: "PUT",
        body: JSON.stringify({ reason: cancellationReason.trim() }),
      });
      toast.success(data.message || "Consultation request cancelled.");
      setCancelTarget(null);
      setCancellationReason("");
      await load();
    } catch (requestError) {
      toast.error(requestError.message || "Unable to cancel the consultation request.");
    } finally {
      setCancelling(false);
    }
  };
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!items) return <Loading />;

  return (
    <div className="w-full min-w-0 space-y-5 pb-16 md:pb-0">
      <ConfirmDialog open={Boolean(cancelTarget)} title="Cancel Consultation" message="Are you sure you want to cancel this consultation?" supportingText="The consultation will move to Consultation History and cannot be restored here." confirmLabel="Cancel Consultation" loadingLabel="Cancelling..." loading={cancelling} inputLabel="Cancellation Reason (Optional)" inputValue={cancellationReason} onInputChange={setCancellationReason} inputPlaceholder="Briefly explain why you are cancelling" inputMaxLength={500} onCancel={() => { if (!cancelling) { setCancelTarget(null); setCancellationReason(""); } }} onConfirm={cancel} />
      <section className="rounded-2xl border border-maroon-100 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-gold-700">Consultation Management</p>
            <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-maroon-900 sm:text-[28px]">My Consultations</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">Track active requests and consultations requiring your attention.</p>
          </div>
          <span className="hidden h-12 w-12 shrink-0 place-items-center rounded-xl border border-gold-300 bg-maroon-50 text-maroon-800 md:grid"><CalendarDays size={23} /></span>
        </div>
      </section>
      <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-3" role="tablist" aria-label="Consultation groups">
        {TABS.map((entry) => (
          <button key={entry.id} type="button" role="tab" aria-selected={tab === entry.id} onClick={() => setTab(entry.id)} className={`min-w-0 rounded-xl border px-3 py-3 text-sm font-bold transition ${tab === entry.id ? "border-maroon-700 bg-maroon-800 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-maroon-300"}`}>
            <span className="break-words">{entry.label}</span>
            <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${tab === entry.id ? "bg-white/20" : "bg-maroon-50 text-maroon-800"}`}>{groups[entry.id]?.length || 0}</span>
          </button>
        ))}
      </div>
      {shown.length === 0 ? <EmptyState title={selectedTab.label} text={selectedTab.empty} /> : (
        <div className="grid min-w-0 gap-3 lg:grid-cols-2">
          {shown.map((appointment) => {
            const providerName = formatPersonName(appointment.faculty) || "Consultation Provider";
            const mode = appointment.consultationMode || "Not provided";
            const ModeIcon = mode === "Face-to-Face" ? MapPin : Monitor;
            return (
              <article key={appointment._id} className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h2 className="break-words text-base font-bold text-slate-900">{appointment.subject || "Subject not provided"}</h2>
                    <p className="mt-1 flex min-w-0 items-center gap-1.5 text-sm text-slate-600"><UserRound size={15} className="shrink-0 text-maroon-700" /><span className="break-words">{providerName}</span></p>
                  </div>
                  <StatusBadge status={getAppointmentDisplayStatus(appointment)} compact allowWrap />
                </div>
                <p className="mt-3 line-clamp-2 break-words text-sm leading-6 text-slate-600"><span className="font-semibold text-slate-700">Consultation Concern:</span> {appointment.reason || "Not provided"}</p>
                <div className="mt-4 grid min-w-0 gap-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-700 sm:grid-cols-2">
                  <p className="flex min-w-0 items-start gap-2"><CalendarDays size={15} className="mt-0.5 shrink-0 text-maroon-700" /><span className="break-words">{dateLabel(appointment.startAt)}</span></p>
                  <p className="flex min-w-0 items-start gap-2"><Clock3 size={15} className="mt-0.5 shrink-0 text-maroon-700" /><span className="break-words">{timeLabel(appointment.startAt)} – {timeLabel(appointment.endAt)}</span></p>
                  <p className="flex min-w-0 items-start gap-2 sm:col-span-2"><ModeIcon size={15} className="mt-0.5 shrink-0 text-maroon-700" /><span className="break-words">{mode}</span></p>
                </div>
                <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  <button type="button" onClick={() => setDetails(appointment)} className="btn-primary inline-flex min-h-10 items-center justify-center gap-2 px-4"><Eye size={16} /> View Details</button>
                  {appointment.status === "Reschedule Proposed" && <button type="button" onClick={() => setProposalTarget(appointment)} className="btn-secondary min-h-10 px-4">Respond to Proposal</button>}
                  {canStudentCancelAppointment(appointment) && <button type="button" onClick={() => setCancelTarget(appointment)} className="btn-secondary min-h-10 px-4">Cancel Consultation</button>}
                </div>
              </article>
            );
          })}
        </div>
      )}
      {details && <StudentAppointmentDetailsModal appointment={details} onClose={() => setDetails(null)} onRespondToProposal={() => { setProposalTarget(details); setDetails(null); }} onCancelConsultation={() => { setCancelTarget(details); setDetails(null); }} />}
      {proposalTarget && <StudentRescheduleResponseModal appointment={proposalTarget} onClose={() => setProposalTarget(null)} onCancelConsultation={() => { setCancelTarget(proposalTarget); setProposalTarget(null); }} onSuccess={async () => { setProposalTarget(null); setDetails(null); await load(); }} />}
    </div>
  );
}
