import { useEffect, useRef, useState } from "react";
import { api } from "../../api/apiClient";
import { monitoringDate } from "../dean/ConsultationDetailsDialog";
import ConsultationDocumentViewer from "../dean/ConsultationDocumentViewer";
import AttendanceResolutionForm, { resolutionLabels } from "./AttendanceResolutionForm";

export default function AttendanceReviewDetails({ recordId, onClose, onChanged }) {
  const dialog = useRef(null), busyRef = useRef(false);
  const [data, setData] = useState(null), [error, setError] = useState(""), [retry, setRetry] = useState(0), [busy, setBusy] = useState(false), [success, setSuccess] = useState("");
  useEffect(() => { const previous = document.activeElement; dialog.current.showModal(); return () => previous?.focus?.(); }, []);
  useEffect(() => {
    const controller = new AbortController(); setData(null); setError("");
    api(`/dean/attendance-review/${recordId}`, { signal: controller.signal }).then(result => { if (!controller.signal.aborted) setData(result.review); })
      .catch(err => { if (!controller.signal.aborted) setError(err.status === 404 ? "This review is unavailable." : err.status === 409 ? "This review changed while loading. Retry to refresh the details." : "Unable to load review details."); });
    return () => controller.abort();
  }, [recordId, retry]);
  const changeBusy = value => { busyRef.current = value; setBusy(value); };
  return <dialog ref={dialog} onCancel={event => { event.preventDefault(); if (!busyRef.current) onClose(); }} aria-labelledby="attendance-review-title" className="max-h-[90vh] w-[95vw] max-w-3xl overflow-y-auto rounded-xl p-6 backdrop:bg-black/50">
    <div className="flex justify-between gap-3"><h2 id="attendance-review-title" className="text-xl font-bold">Attendance Review details</h2><button autoFocus type="button" className="btn-secondary" disabled={busy} onClick={() => { if (!busyRef.current) onClose(); }}>Close</button></div>
    {success && <p role="status" className="my-3 rounded border border-green-600 p-3">{success}</p>}
    {error ? <p role="alert">{error} <button type="button" className="underline" onClick={() => setRetry(n => n + 1)}>Retry</button></p> : !data ? <p role="status">Loading review details…</p> : <div className="mt-4 space-y-5">
      <dl className="grid gap-3 sm:grid-cols-2">{[["Student", data.studentName], ["Faculty", data.facultyName], ["Subject/course", data.subject], ["Consultation concern", data.concern], ["Confirmed start", monitoringDate(data.startAt)], ["Confirmed end", monitoringDate(data.endAt)], ["Mode", data.mode], ["Review trigger", data.attendance?.reviewReason], ["Placed under review", monitoringDate(data.attendance?.reviewStartedAt)], ["Response deadline", monitoringDate(data.attendance?.responseDeadlineAt)], ["Review state", data.state], ["Final outcome", data.attendance?.finalOutcome]].map(([label, value]) => <div key={label}><dt className="font-semibold">{label}</dt><dd className="whitespace-pre-wrap break-words">{value || "Unavailable"}</dd></div>)}</dl>
      <section className="space-y-3"><h3 className="font-bold">Original attendance responses</h3>{["student", "faculty"].map(role => <div key={role} className="rounded border p-3"><h4 className="font-semibold capitalize">{role}</h4>{data.responses[role] ? <><p>{data.responses[role].outcome} · {monitoringDate(data.responses[role].submittedAt)}</p><p className="whitespace-pre-wrap break-words">Private reason: {data.responses[role].reason || "No reason provided."}</p></> : <p>No response was submitted.</p>}</div>)}</section>
      <section><h3 className="font-bold">Status history</h3>{!data.statusHistory.length && <p>No recorded history.</p>}<ol>{data.statusHistory.map((entry, index) => <li className="my-2 rounded border p-3" key={index}>{entry.from} → {entry.to} · {entry.actorRole} · {monitoringDate(entry.timestamp)}<p className="break-words">{entry.reason}</p></li>)}</ol></section>
      <ConsultationDocumentViewer recordId={recordId} documents={data.documents} />
      <section><h3 className="font-bold">Dean review actions</h3>{!data.actions.length && <p>No Dean actions recorded.</p>}<ol>{data.actions.map(entry => <li className="my-2 rounded border p-3" key={entry.reviewId}><p>{resolutionLabels[entry.action]} · {monitoringDate(entry.reviewedAt)}</p><p className="whitespace-pre-wrap break-words">{entry.reason}</p></li>)}</ol></section>
      {data.state === "Unresolved" ? <AttendanceResolutionForm key={`${recordId}:${data.version}`} recordId={recordId} version={data.version} onBusy={changeBusy} onStale={() => setRetry(n => n + 1)} onSaved={result => { setSuccess(result.state === "Resolved" ? `Attendance record reviewed. Recorded outcome: ${result.finalOutcome}.` : "Review action saved. The case remains under review."); onChanged(); setRetry(n => n + 1); }} /> : <p role="status">This record is already resolved. The final attendance decision cannot be changed.</p>}
    </div>}
  </dialog>;
}
