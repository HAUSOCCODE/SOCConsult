import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../api/apiClient";
import { EmptyState, ErrorState, Loading, StatusBadge } from "../UI";
import FacultyAppointmentDetailsModal from "./FacultyAppointmentDetailsModal";
import FacultyRescheduleModal from "./FacultyRescheduleModal";
import ConfirmDialog from "../ConfirmDialog";
import DetailLoadingDialog from "./DetailLoadingDialog";
import { consultationTime } from "./PersonalConsultationDetails";
import { isRecoverableUiError, safeUiError } from "../../utils/safeUiErrors";

const sections = ["Upcoming", "Pending", "Reschedule Proposed", "Awaiting Attendance Update", "Attendance Review", "Recently Finalized", "Compatibility"];
export default function FacultyConsultationsView({ detailOnly = false, selection, onChanged, onDetailClose } = {}) {
  const { user } = useAuth();
  const searchParams = new URLSearchParams(window.location?.search || "");
  const linkedAppointment = searchParams.getAll("appointment").length === 1 && /^[a-f\d]{24}$/i.test(searchParams.get("appointment") || "")
    ? searchParams.get("appointment") : "";
  const base = user.role === "dean" ? "/dean/faculty" : "/faculty";
  const [section, setSection] = useState("Upcoming"), [page, setPage] = useState(1), [revision, setRevision] = useState(0);
  const [list, setList] = useState({ loading: true }), [detail, setDetail] = useState(null), [selected, setSelected] = useState("");
  const [proposing, setProposing] = useState(false), [cancelling, setCancelling] = useState(false), [reason, setReason] = useState(""), [busy, setBusy] = useState(false), [actionError, setActionError] = useState("");
  const listRequest = useRef(null), detailRequest = useRef(null), busyRef = useRef(false), opener = useRef(null);
  const [reasonError, setReasonError] = useState("");
  useEffect(() => {
    if (detailOnly) return undefined;
    const load = async () => {
      listRequest.current?.abort(); const c = new AbortController(); listRequest.current = c;
      setList({ loading: true });
      try {
        const data = await api(`/appointments/consultations?section=${encodeURIComponent(section)}&page=${page}`, { signal: c.signal, cache: "no-store" });
        if (!c.signal.aborted) {
          const last = Math.max(1, data.pagination.totalPages);
          if (page > last) setPage(last); else setList({ data });
        }
      } catch (error) { if (!c.signal.aborted) setList({ requestError: error, error: safeUiError(error, "Unable to load your consultations. Please try again.") }); }
    };
    void load(); const refresh = () => { if (!busyRef.current) void load(); };
    window.addEventListener("focus", refresh);
    const timer = setInterval(refresh, 60000);
    return () => { listRequest.current?.abort(); clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [section, page, revision, detailOnly]);
  useEffect(() => () => detailRequest.current?.abort(), []);
  const close = () => { if (busyRef.current || proposing || cancelling) return; detailRequest.current?.abort(); setSelected(""); setDetail(null);
    if (linkedAppointment) { const next = new URLSearchParams(window.location?.search || ""); next.delete("appointment");
      window.history?.replaceState(null, "", `${window.location?.pathname || ""}${next.size ? `?${next}` : ""}${window.location?.hash || ""}`); }
    opener.current?.focus(); onDetailClose?.(); };
  const open = async (id, target) => {
    if (target) opener.current = target;
    detailRequest.current?.abort(); const c = new AbortController(); detailRequest.current = c;
    setSelected(id); setDetail({ loading: true }); setActionError("");
    try { const data = await api(`/appointments/consultations/${id}`, { signal: c.signal, cache: "no-store" }); if (!c.signal.aborted) setDetail({ appointment: data.appointment }); }
    catch (error) { if (!c.signal.aborted) setDetail({ error: safeUiError(error, "Unable to load this consultation. Please try again.") }); }
  };
  const cancel = async () => {
    if (busyRef.current) return;
    if (!reason.trim() || reason.trim().length > 500) {
      setReasonError("Enter a cancellation reason between 1 and 500 characters."); return;
    }
    if (!detail?.appointment?.actions?.cancel || !Number.isInteger(detail?.appointment?.__v)) return;
    busyRef.current = true; setBusy(true); setActionError("");
    try {
      await api(`/appointments/${selected}/status`, { method: "PUT", body: JSON.stringify({ status: "Cancelled", reason: reason.trim(), expectedVersion: detail.appointment.__v }) });
      setCancelling(false); setReason(""); setRevision(v => v + 1); onChanged?.(); await open(selected);
    } catch { setCancelling(false); setRevision(v => v + 1); onChanged?.(); await open(selected); setActionError("Unable to cancel. Review the latest consultation details before trying again."); }
    finally { busyRef.current = false; setBusy(false); }
  };
  useEffect(() => {
    if (selection?.id) void open(selection.id, selection.opener);
    return () => { if (selection) detailRequest.current?.abort(); };
  }, [selection]);
  useEffect(() => { if (!detailOnly && linkedAppointment && linkedAppointment !== selected) void open(linkedAppointment); }, [detailOnly, linkedAppointment]);
  const a = detail?.appointment;
  return <div className="min-w-0 space-y-5">
    {!detailOnly && <>
    <h1 className="text-2xl font-bold text-maroon-900">My Consultations</h1><p>Consultations assigned to you. Times are shown in Asia/Manila.</p>
    <div className="flex flex-wrap gap-2" role="group" aria-label="Consultation sections">{sections.map(name => <button type="button" key={name} aria-pressed={section === name} className={section === name ? "btn-primary" : "btn-secondary"} onClick={() => { setSection(name); setPage(1); }}>{name}</button>)}</div>
    <h2 className="text-lg font-bold">{section}</h2>
    {section === "Recently Finalized" && <p>Latest 20 finalized records. <Link className="underline" to={`${base}/history`}>Full Consultation History</Link></p>}
    {section === "Compatibility" && <p>Latest 20 historical or malformed records requiring review. Read-only; retired statuses are historical labels.</p>}
    {section === "Awaiting Attendance Update" && <p>Submit your attendance response from the consultation details. Responses are accepted once and cannot be edited.</p>}
    {list.loading ? <Loading message="Loading your consultations..." /> : list.error ? <ErrorState message={list.error} onRetry={() => setRevision(v => v + 1)} retryable={isRecoverableUiError(list.requestError)} /> : <>
      {!list.data.appointments.length ? <EmptyState title={section === "Upcoming" ? "No upcoming consultations." : "No consultations in this section."} /> : <div className="space-y-3">{list.data.appointments.map(row => <article key={row._id} className="min-w-0 space-y-2 rounded-xl border bg-white p-4"><h3 className="break-words font-bold">{row.student?.name}</h3><StatusBadge appointment status={row.status} /><p className="break-words">{row.subject || "Consultation"}</p><p>{consultationTime(row.startAt)} - {consultationTime(row.endAt)}</p><p>{row.consultationMode}</p><button type="button" className="btn-secondary" onClick={e => open(row._id, e.currentTarget)}>View Details</button></article>)}</div>}
      {!["Recently Finalized", "Compatibility"].includes(section) && <nav className="flex items-center gap-3" aria-label="Consultation pagination"><button type="button" className="btn-secondary" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button><span>Page {page} of {Math.max(1, list.data.pagination.totalPages)}</span><button type="button" className="btn-secondary" disabled={page >= list.data.pagination.totalPages} onClick={() => setPage(p => p + 1)}>Next</button></nav>}
    </>}
    </>}
    {selected && !a && <DetailLoadingDialog onClose={close} opener={opener.current}>{detail?.loading ? "Loading consultation details..." : <><p role="alert">{detail?.error}</p><button type="button" className="btn-secondary" onClick={() => open(selected)}>Retry details</button></>}<button type="button" className="btn-secondary" onClick={close}>Close details</button></DetailLoadingDialog>}
    {a && <FacultyAppointmentDetailsModal appointment={a} personal opener={opener.current} onClose={close} onAttendanceSubmitted={async () => { setRevision(v => v + 1); onChanged?.(); await open(selected); }}>
      <div className="flex flex-wrap gap-3">
        {a.status === "Pending" && (a.actions.confirm || a.actions.reject || a.actions.propose) && <Link className="btn-secondary" to={`${base}/requests`}>Review request decisions</Link>}
        {a.status === "Confirmed" && a.actions.propose && <button type="button" className="btn-secondary" onClick={() => setProposing(true)}>Propose reschedule</button>}
        {a.actions.cancel && <button type="button" className="btn-secondary" onClick={() => { setReason(""); setReasonError(""); setCancelling(true); }}>Cancel consultation</button>}
      </div>{actionError && <p role="alert">{actionError}</p>}
    </FacultyAppointmentDetailsModal>}
    {proposing && a && <FacultyRescheduleModal appointment={a} opener={opener.current} onClose={() => setProposing(false)} onConflict={async () => { setProposing(false); setRevision(v => v + 1); onChanged?.(); await open(selected); }} onSuccess={async () => { setProposing(false); setRevision(v => v + 1); onChanged?.(); await open(selected); }} />}
    <ConfirmDialog open={cancelling} title="Cancel consultation" message="Cancel this consultation?" inputLabel="Cancellation reason (required, up to 500 characters)" inputRequired inputError={reasonError} inputMaxLength={500} inputValue={reason} onInputChange={value => { setReason(value); setReasonError(""); }} confirmLabel="Cancel consultation" loadingLabel="Cancelling..." loading={busy} onCancel={() => !busyRef.current && setCancelling(false)} onConfirm={cancel} />
  </div>;
}
