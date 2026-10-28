import FacultyRescheduleModal from "../../components/appointments/FacultyRescheduleModal";
import { createPortal } from "react-dom";
import useDialogFocus from "../../hooks/useDialogFocus";
import { useEffect, useRef, useState } from "react";
import { api } from "../../api/apiClient";
import { EmptyState, ErrorState, Loading, StatusBadge } from "../../components/UI";
import AppointmentRequestDetailsModal from "../../components/appointments/AppointmentRequestDetailsModal";
import OneTimeScheduleRequests from "../../components/appointments/OneTimeScheduleRequests";
import { formatManilaDisplay } from "../../utils/formatDateTime";
import { useToast } from "../../context/ToastContext";
import { isRecoverableUiError, safeUiError } from "../../utils/safeUiErrors";

const filters = ["Pending", "Reschedule Proposed", "Confirmed", "Rejected", "Cancelled", "Expired", "All"];
const timestamp = value => value && Number.isFinite(new Date(value).getTime()) ? formatManilaDisplay(new Date(value), undefined, "timestamp") : "Not scheduled";

export default function AppointmentRequests() {
  const toast = useToast();
  const searchParams = new URLSearchParams(window.location?.search || "");
  const linkedAppointment = searchParams.getAll("appointment").length === 1 && /^[a-f\d]{24}$/i.test(searchParams.get("appointment") || "")
    ? searchParams.get("appointment") : "";
  const [status, setStatus] = useState("Pending");
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [list, setList] = useState({ loading: true });
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState({});
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [legacyReview, setLegacyReview] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [proposing, setProposing] = useState(false);
  const [decisionError, setDecisionError] = useState("");
  const listRequest = useRef(null);
  const detailRequest = useRef(null);
  const busyRef = useRef(false);
  useEffect(() => {
    let controller;
    const load = async () => {
      controller?.abort(); controller = new AbortController();
      const current = controller; listRequest.current = current;
      setList({ loading: true });
      try {
        const data = await api(`/appointments/requests?status=${encodeURIComponent(status)}&page=${page}`, { signal: current.signal, cache: "no-store" });
        if (!current.signal.aborted) {
          if (page > Math.max(1, data.pagination.totalPages)) setPage(Math.max(1, data.pagination.totalPages));
          else setList({ data });
        }
      } catch (error) { if (!current.signal.aborted) setList({ requestError: error, error: safeUiError(error, "Unable to load appointment requests. Please try again.") }); }
    };
    void load();
    const focus = () => { if (!busyRef.current) void load(); };
    window.addEventListener("focus", focus);
    return () => { controller?.abort(); window.removeEventListener("focus", focus); };
  }, [status, page, revision]);
  const close = () => {
    if (busyRef.current) return;
    detailRequest.current?.abort(); setSelectedId(""); setDetail({}); setRejecting(false); setNote(""); setConfirming(false); setProposing(false); setDecisionError("");
    if (linkedAppointment) { const next = new URLSearchParams(window.location?.search || ""); next.delete("appointment");
      window.history?.replaceState(null, "", `${window.location?.pathname || ""}${next.size ? `?${next}` : ""}${window.location?.hash || ""}`); }
  };
  const open = async id => {
    detailRequest.current?.abort();
    const controller = new AbortController(); detailRequest.current = controller;
    setSelectedId(id); setDetail({ loading: true }); setRejecting(false); setNote(""); setConfirming(false); setProposing(false); setDecisionError("");
    try {
      const data = await api(`/appointments/requests/${id}`, { signal: controller.signal, cache: "no-store" });
      if (!controller.signal.aborted) setDetail({ appointment: data.appointment });
    } catch (error) { if (!controller.signal.aborted) setDetail({ error: safeUiError(error, "Unable to load this request. Please try again.") }); }
  };
  useEffect(() => () => { listRequest.current?.abort(); detailRequest.current?.abort(); }, []);
  useEffect(() => { if (linkedAppointment && linkedAppointment !== selectedId) void open(linkedAppointment); }, [linkedAppointment]);
  const decide = async decision => {
    if (busyRef.current || !detail.appointment) return;
    if (!Number.isInteger(detail.appointment.__v)) { setDecisionError("Reload these details before deciding."); return; }
    if (decision === "Rejected" && !note.trim()) { setDecisionError("A rejection reason is required (up to 500 characters)."); return; }
    busyRef.current = true; setBusy(true);
    const appointment = detail.appointment;
    try {
      const legacy = appointment.bookingMethod === "schedule_request";
      await api(legacy ? `/schedule-requests/${appointment._id}/reject` : `/appointments/${appointment._id}/status`, {
        method: "PUT", body: JSON.stringify({ ...(!legacy && { status: decision }), note, expectedVersion: appointment.__v }),
      });
      toast.success(decision === "Confirmed" ? "Appointment approved successfully." : "Appointment request rejected.");
      busyRef.current = false; close(); setRevision(value => value + 1);
    } catch {
      toast.error("Unable to update this request. Please review its latest details and try again.");
      await open(appointment._id);
    } finally { busyRef.current = false; setBusy(false); }
  };
  const appointment = detail.appointment;
  const pending = appointment?.status === "Pending";
  return <div className="min-w-0 space-y-5">
    <h1 className="text-2xl font-bold text-maroon-900">Appointment Requests</h1>
    <p className="text-sm text-slate-600">Review your Student requests. Times are shown in Asia/Manila.</p>
    <label className="block text-sm font-semibold">Status
      <select className="field mt-1" value={status} onChange={event => { close(); setStatus(event.target.value); setPage(1); }}>
        {filters.map(value => <option key={value}>{value}</option>)}
      </select>
    </label>
    {status === "All" && <p className="text-sm text-slate-600">All includes attendance, finalized, and retained legacy records.</p>}
    {status === "Pending" && <p className="text-sm text-slate-600">Earliest requested schedule first. Unscheduled requests appear last.</p>}
    {list.loading ? <Loading message="Loading consultation requests..." /> : list.error ? <ErrorState message={list.error} onRetry={() => setRevision(value => value + 1)} retryable={isRecoverableUiError(list.requestError)} /> : <>
      {!list.data?.requests.length ? <EmptyState title={status === "Pending" ? "No pending consultation requests." : "No appointment requests match this filter."} text="New matching requests will appear here." /> : <div className="space-y-3">
        {list.data.requests.map(request => <article key={request._id} className="min-w-0 rounded-xl border bg-white p-4 space-y-2">
          <h2 className="font-bold break-words">{request.student.name}</h2>
          <StatusBadge appointment status={request.status} allowWrap />
          <p className="break-words"><strong>Subject / Course:</strong> {request.subject}</p>
          <p className="whitespace-pre-wrap break-words"><strong>Consultation Concern:</strong> {request.reason}</p>
          <p>Requested schedule: {timestamp(request.startAt)}{request.endAt ? ` - ${timestamp(request.endAt)}` : ""}</p>
          <p>Mode: {request.consultationMode || "Not scheduled"}</p>
          <p>Submitted: {request.createdAt ? timestamp(request.createdAt) : "Not available"}</p>
          <p>{request.hasSupportingDocuments ? "Supporting document attached" : "No supporting documents"}</p>
          <button className="btn-secondary" onClick={() => void open(request._id)}>View Details</button>
        </article>)}
      </div>}
      <nav aria-label="Request pagination" className="flex flex-wrap gap-3 items-center">
        <p>{list.data?.pagination.total || 0} requests | Page {page} of {Math.max(1, list.data?.pagination.totalPages || 0)}</p>
        <button className="btn-secondary" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Previous</button>
        <button className="btn-secondary" disabled={page >= (list.data?.pagination.totalPages || 0)} onClick={() => setPage(value => value + 1)}>Next</button>
      </nav>
    </>}
    {selectedId && !appointment && <RequestLoadingDialog loading={detail.loading} onClose={close} onRetry={() => void open(selectedId)} />}
    {appointment && !legacyReview && !proposing && <AppointmentRequestDetailsModal appointment={appointment} personalRequest onClose={close} actions={pending && <>
      {decisionError && <p role="alert" className="w-full text-red-700">{decisionError}</p>}
      {!rejecting && !confirming && <button className="btn-secondary" disabled={busy} onClick={() => setProposing(true)}>Propose Schedule</button>}
      {confirming && <p role="status" className="w-full">Confirm this request at its current schedule?</p>}
      {(confirming || rejecting) && <button className="btn-secondary" disabled={busy} onClick={() => { setConfirming(false); setRejecting(false); setDecisionError(""); }}>Back</button>}
      {rejecting ? <label className="w-full text-sm">Rejection reason (required)<textarea required className="field" maxLength={500} value={note} disabled={busy} onChange={event => setNote(event.target.value)} /></label> : null}
      {!rejecting && appointment.bookingMethod === "schedule_request" ? <button className="btn-primary" disabled={busy} onClick={() => setLegacyReview(appointment)}>Review legacy schedule request</button> : !rejecting && appointment.startAt && appointment.endAt ? <button className="btn-primary" disabled={busy} onClick={() => confirming ? void decide("Confirmed") : setConfirming(true)}>{confirming ? "Confirm appointment" : "Confirm"}</button> : null}
      <button className="btn-secondary" disabled={busy} onClick={() => rejecting ? void decide("Rejected") : setRejecting(true)}>{busy ? "Saving..." : rejecting ? "Confirm rejection" : "Reject"}</button>
    </>} />}
    {proposing && appointment && <FacultyRescheduleModal appointment={appointment} onClose={() => setProposing(false)} onConflict={async () => { setProposing(false); await open(appointment._id); }} onSuccess={() => { close(); setRevision(value => value + 1); toast.success("Schedule proposal sent."); }} />}
    {legacyReview && <OneTimeScheduleRequests key={legacyReview._id} reviewRequest={legacyReview} onClose={() => setLegacyReview(null)} onConflict={async () => { setLegacyReview(null); await open(appointment._id); }} onDecided={() => { close(); setRevision(value => value + 1); }} />}
  </div>;
}

function RequestLoadingDialog({ loading, onClose, onRetry }) {
  const ref = useRef(null);
  useDialogFocus(ref, { onClose });
  return createPortal(<div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4">
    <section ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="request-loading-title" className="max-h-[calc(100dvh-1.5rem)] w-full max-w-md space-y-4 overflow-y-auto rounded-xl bg-white p-5 shadow-xl sm:p-6">
      <h2 id="request-loading-title">Appointment Request Details</h2>
      {loading ? <p role="status">Loading request details...</p> : <div role="alert">This record is unavailable or you no longer have access to it. <button className="btn-secondary" onClick={onRetry}>Retry</button></div>}
      <button className="btn-secondary" onClick={onClose}>Close</button>
    </section>
  </div>, document.body);
}
