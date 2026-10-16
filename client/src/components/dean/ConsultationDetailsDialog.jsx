import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/apiClient";
import ConsultationDocumentViewer from "./ConsultationDocumentViewer";

export function monitoringDate(value) {
  if (!value) return "Unavailable";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" }) : "Unavailable";
}
const schedule = value => value ? `${monitoringDate(value.startAt)} – ${monitoringDate(value.endAt)} · ${value.mode || "Unavailable"}${value.location ? ` · ${value.location}` : ""}` : "Unavailable";
export default function ConsultationDetailsDialog({ recordId, onClose }) {
  const dialog = useRef(null);
  const [data, setData] = useState(null), [error, setError] = useState(""), [retry, setRetry] = useState(0);
  useEffect(() => { dialog.current.showModal(); }, []);
  useEffect(() => {
    const controller = new AbortController();
    setData(null); setError("");
    api(`/dean/consultations/${recordId}`, { signal: controller.signal }).then(result => { if (!controller.signal.aborted) setData(result.consultation); })
      .catch(() => { if (!controller.signal.aborted) setError("Unable to load consultation details."); });
    return () => controller.abort();
  }, [recordId, retry]);
  return <dialog ref={dialog} onCancel={onClose} aria-labelledby="consultation-detail-title" className="max-h-[90vh] w-[95vw] max-w-3xl overflow-y-auto rounded-xl p-6 backdrop:bg-black/50">
    <div className="flex items-center justify-between gap-3"><h2 id="consultation-detail-title" className="text-xl font-bold">Consultation details</h2><button autoFocus type="button" className="btn-secondary" onClick={onClose}>Close</button></div>
    {error ? <div role="alert">{error} <button type="button" onClick={() => setRetry(value => value + 1)}>Retry</button></div> : !data ? <p role="status">Loading details…</p> : <div className="mt-5 space-y-5">
      <dl className="grid gap-3 sm:grid-cols-2">{[
        ["Attendance verification", data.attendance?.verification === "two_party_workflow" ? "Two-party workflow" : "Not verified by two-party workflow"],
        ["Final attendance outcome", data.attendance?.finalOutcome || "Unresolved / not verified"],
        ["Attendance review category", data.attendance?.reviewReason],
        ["Missing response roles", data.attendance?.missingRoles?.join(", ")],
        ["Attendance opens (Asia/Manila)", monitoringDate(data.attendance?.attendanceOpensAt)],
        ["Response deadline (Asia/Manila)", monitoringDate(data.attendance?.responseDeadlineAt)],
        ["Finalization source", data.attendance?.finalizationSource],
        ["Record ID", data.recordId], ["Student", data.studentName], ["Faculty", data.facultyName], ["Subject/course", data.subject],
        ["Consultation concern", data.concern], ["Booking method", data.bookingMethod], ["Consultation mode", data.mode], ["Status", `${data.status}${data.legacy ? " (Legacy)" : ""}`],
        ["Original/requested schedule", schedule(data.originalSchedule)], ["Current/requested schedule", schedule(data.currentSchedule)],
        ["Proposed schedule", schedule(data.proposedSchedule)], ["Created — Asia/Manila", monitoringDate(data.createdAt)], ["Updated — Asia/Manila", monitoringDate(data.updatedAt)],
      ].map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-sm font-semibold text-slate-500">{label}</dt><dd className="whitespace-pre-wrap break-words">{value || "Unavailable"}</dd></div>)}</dl>
      {(data.status === "Attendance Review" || data.attendance?.finalizationSource === "dean_review") && <p className="rounded border p-3">Attendance Review is handled separately. <Link className="underline" to={`/dean/attendance-review/${recordId}`}>Open Attendance Review</Link>.</p>}
      <section><h3 className="font-bold">Status history</h3>{!data.statusHistory.length ? <p>No recorded status history.</p> : <ol className="space-y-3">{data.statusHistory.map((entry, index) => <li key={index} className="rounded border p-3">
        <p>{entry.from} → {entry.to}</p><p className="text-sm">{entry.actorRole} · {entry.actorType} · {monitoringDate(entry.timestamp)} · {entry.source}</p>{entry.reason && <p className="break-words">{entry.reason}</p>}
      </li>)}</ol>}</section>
      <ConsultationDocumentViewer recordId={recordId} documents={data.documents} />
    </div>}
  </dialog>;
}
