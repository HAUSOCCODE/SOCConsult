import { formatManilaDateTime } from "../../utils/formatDateTime";
import useDialogFocus from "../../hooks/useDialogFocus";
import { deanUiError } from "../../utils/deanUiErrors";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/apiClient";
import { StatusBadge } from "../UI";
import ConsultationDocumentViewer from "./ConsultationDocumentViewer";

export function monitoringDate(value) { return formatManilaDateTime(value); }
const schedule = value => value ? `${monitoringDate(value.startAt)} – ${monitoringDate(value.endAt)} · ${value.mode || "Unavailable"}${value.location ? ` · ${value.location}` : ""}` : "Unavailable";

function DetailSection({ title, fields }) {
  return <section className="space-y-3"><h3 className="border-b border-slate-200 pb-2 text-base font-semibold text-maroon-900">{title}</h3><dl className="grid gap-x-5 gap-y-3 text-sm sm:grid-cols-2">
    {fields.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs font-semibold text-slate-500">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-slate-900">{value || "Unavailable"}</dd></div>)}
  </dl></section>;
}

export default function ConsultationDetailsDialog({ recordId, onClose }) {
  const dialog = useRef(null);
  const [data, setData] = useState(null), [error, setError] = useState(""), [retry, setRetry] = useState(0);
  const opener = useRef(document.activeElement);
  useEffect(() => { const panel = dialog.current; panel.showModal(); return () => panel.close(); }, []);
  useDialogFocus(dialog, { restoreTarget: opener.current, onClose });
  useEffect(() => {
    const controller = new AbortController();
    setData(null); setError("");
    api(`/dean/consultations/${recordId}`, { signal: controller.signal }).then(result => { if (!controller.signal.aborted) setData(result.consultation); })
      .catch(error => { if (!controller.signal.aborted) setError(deanUiError(error, "document")); });
    return () => controller.abort();
  }, [recordId, retry]);
  return <dialog tabIndex={-1} ref={dialog} onCancel={onClose} aria-labelledby="consultation-detail-title" className="max-h-[90dvh] w-[95vw] max-w-3xl overflow-y-auto rounded-2xl p-4 shadow-xl backdrop:bg-slate-950/55 sm:p-6">
    <div className="flex items-center justify-between gap-3"><h2 id="consultation-detail-title" className="text-xl font-bold text-maroon-900">Consultation details</h2><button autoFocus type="button" className="btn-action-sm" onClick={onClose}>Close</button></div>
    {error ? <div role="alert" className="mt-5 text-sm text-red-700">{error} <button type="button" className="underline" onClick={() => setRetry(value => value + 1)}>Retry</button></div> : !data ? <p role="status" className="mt-5 text-sm text-slate-600">Loading details…</p> : <div className="mt-6 space-y-7">
      <div className="flex flex-wrap items-center gap-2"><StatusBadge status={data.status || "Unavailable"} allowWrap />{data.legacy && <span className="text-xs text-slate-500">Legacy record</span>}</div>
      <DetailSection title="Consultation" fields={[
        ["Student", data.studentName], ["Faculty", data.facultyName], ["Subject/course", data.subject], ["Consultation concern", data.concern],
        ["Booking method", data.bookingMethod], ["Consultation mode", data.mode], ["Record ID", data.recordId],
      ]} />
      <DetailSection title="Schedule" fields={[
        ["Current/requested schedule", schedule(data.currentSchedule)], ["Original/requested schedule", schedule(data.originalSchedule)],
        ["Proposed schedule", schedule(data.proposedSchedule)],
      ]} />
      <DetailSection title="Attendance" fields={[
        ["Attendance verification", data.attendance?.verification === "two_party_workflow" ? "Legacy two-party workflow" : data.attendance?.verification === "initiator_report" ? "Initiator outcome report" : "Not verified"],
        ["Final attendance outcome", data.attendance?.finalOutcome || "Unresolved / not verified"],
        ["Attendance review category", data.attendance?.reviewReason],
        ["Missing response roles", data.attendance?.missingRoles?.join(", ")],
        ["Attendance opens (Asia/Manila)", monitoringDate(data.attendance?.attendanceOpensAt)],
        ["Response deadline (Asia/Manila)", monitoringDate(data.attendance?.responseDeadlineAt)],
        ["Finalization source", data.attendance?.finalizationSource],
      ]} />
      {(data.status === "Attendance Review" || data.attendance?.finalizationSource === "dean_review") && <p className="rounded-lg bg-amber-50 p-3 text-sm text-slate-700">Attendance Review is handled separately. <Link className="font-medium text-maroon-800 underline" to={`/dean/attendance-review/${recordId}`}>Open Attendance Review</Link>.</p>}
      <DetailSection title="Record dates" fields={[["Created · Asia/Manila", monitoringDate(data.createdAt)], ["Updated · Asia/Manila", monitoringDate(data.updatedAt)]]} />
      <section className="space-y-3"><h3 className="border-b border-slate-200 pb-2 text-base font-semibold text-maroon-900">Status history</h3>{!data.statusHistory.length ? <p className="text-sm text-slate-600">No recorded status history.</p> : <ol className="space-y-3">{data.statusHistory.map((entry, index) => <li key={index} className="border-l-2 border-gold-500 pl-3 text-sm">
        <p className="font-medium text-slate-900">{entry.from} → {entry.to}</p><p className="mt-1 text-xs text-slate-600">{entry.actorRole} · {entry.actorType} · {monitoringDate(entry.timestamp)} · {entry.source}</p>{entry.reason && <p className="mt-1 break-words text-slate-700">{entry.reason}</p>}
      </li>)}</ol>}</section>
      <ConsultationDocumentViewer recordId={recordId} documents={data.documents} />
    </div>}
  </dialog>;
}
