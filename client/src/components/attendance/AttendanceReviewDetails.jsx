import useDialogFocus from "../../hooks/useDialogFocus";
import { useEffect, useRef, useState } from "react";
import { api } from "../../api/apiClient";
import { formatManilaDateTime } from "../../utils/formatDateTime";
import ConsultationDocumentViewer from "../dean/ConsultationDocumentViewer";
import AttendanceResolutionForm, { resolutionLabels } from "./AttendanceResolutionForm";

const triggers = {
  responses_conflict: "Responses differ", student_response_missing: "Student response missing",
  faculty_response_missing: "Faculty response missing", both_responses_missing: "Both responses missing",
  initiator_report_disputed: "Initiator report disputed",
};
const date = value => formatManilaDateTime(value);
function Fields({ fields }) {
  return <dl className="grid gap-x-5 gap-y-3 text-sm sm:grid-cols-2">{fields.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs font-semibold text-slate-500">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-slate-900">{value || "Unavailable"}</dd></div>)}</dl>;
}
function Heading({ children }) {
  return <h3 className="border-b border-slate-200 pb-2 text-base font-semibold text-maroon-900">{children}</h3>;
}

export default function AttendanceReviewDetails({ recordId, onClose, onChanged }) {
  const dialog = useRef(null), busyRef = useRef(false), opener = useRef(document.activeElement);
  const [data, setData] = useState(null), [error, setError] = useState(""), [retry, setRetry] = useState(0), [busy, setBusy] = useState(false), [success, setSuccess] = useState("");
  useEffect(() => { const panel = dialog.current; panel.showModal(); return () => panel.close(); }, []);
  useDialogFocus(dialog, { restoreTarget: opener.current, onClose, busy });
  useEffect(() => {
    const controller = new AbortController(); setData(null); setError("");
    api(`/dean/attendance-review/${recordId}`, { signal: controller.signal }).then(result => { if (!controller.signal.aborted) setData(result.review); })
      .catch(err => { if (!controller.signal.aborted) setError(err.status === 404 ? "This review is unavailable." : err.status === 409 ? "This review changed while loading. Retry to refresh the details." : "Unable to load review details."); });
    return () => controller.abort();
  }, [recordId, retry]);
  const changeBusy = value => { busyRef.current = value; setBusy(value); };
  const openProof = async () => {
    changeBusy(true); setError("");
    try {
      const { blob } = await api.download(`/dean/attendance-review/${recordId}/proof`);
      const url = URL.createObjectURL(blob); window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch { setError("Unable to open the consultation proof."); }
    finally { changeBusy(false); }
  };
  const proofAvailable = data && Object.values(data.responses).some(response => response?.proofAvailable);
  return <dialog tabIndex={-1} ref={dialog} onCancel={event => { event.preventDefault(); if (!busyRef.current) onClose(); }} aria-labelledby="attendance-review-title" className="max-h-[92dvh] w-[96vw] max-w-5xl overflow-hidden rounded-2xl p-0 shadow-xl backdrop:bg-slate-950/55">
    <div className="flex max-h-[92dvh] flex-col">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
        <div><h2 id="attendance-review-title" className="text-xl font-bold text-maroon-900">Attendance review</h2><p className="text-xs text-slate-500">Review participant evidence and record a decision.</p></div>
        <button autoFocus type="button" className="btn-action-sm shrink-0" disabled={busy} onClick={() => { if (!busyRef.current) onClose(); }}>Close</button>
      </header>
      <div className="min-h-0 overflow-y-auto px-4 py-5 sm:px-6">
        {success && <p role="status" className="mb-5 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">{success}</p>}
        {error && <p role="alert" className="mb-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error} <button type="button" className="underline" onClick={() => setRetry(n => n + 1)}>Retry</button></p>}
        {!data && !error ? <p role="status" className="text-sm text-slate-600">Loading review details…</p> : data && <div className="space-y-6">
          <section className="space-y-3"><Heading>Consultation summary</Heading><Fields fields={[
            ["Student", data.studentName], ["Faculty", data.facultyName], ["Subject/course", data.subject],
            ["Schedule · Asia/Manila", `${date(data.startAt)} – ${date(data.endAt)}`],
            ["Mode", data.mode], ["Review reason", triggers[data.attendance?.reviewReason] || data.attendance?.reviewReason],
          ]} /></section>
          <section className="space-y-3"><Heading>Original attendance responses</Heading>
            <div className="grid gap-3 md:grid-cols-2">{["student", "faculty"].map(role => {
              const response = data.responses[role];
              return <div key={role} className="min-w-0 rounded-lg border border-slate-200 p-4 text-sm">
                <h4 className="font-semibold capitalize text-maroon-900">{role} report</h4>
                {response ? <dl className="mt-3 space-y-2"><div><dt className="text-xs font-semibold text-slate-500">Reported outcome</dt><dd className="mt-1 font-medium text-slate-900">{response.outcome || "Unavailable"}</dd></div><div><dt className="text-xs font-semibold text-slate-500">Submitted · Asia/Manila</dt><dd className="mt-1">{date(response.submittedAt)}</dd></div><div><dt className="text-xs font-semibold text-slate-500">Private reason</dt><dd className="mt-1 whitespace-pre-wrap break-words">{response.reason || "No reason provided."}</dd></div><div><dt className="text-xs font-semibold text-slate-500">Proof</dt><dd className="mt-1">{response.proofAvailable ? "Available below" : "No proof provided"}</dd></div></dl> : <p className="mt-3 text-slate-600">No response was submitted.</p>}
              </div>;
            })}</div>
            {proofAvailable && <button type="button" className="btn-secondary" disabled={busy} onClick={openProof}>View consultation proof</button>}
          </section>
          <section className="space-y-3"><Heading>Dean resolution</Heading>
            {data.state === "Unresolved" ? <AttendanceResolutionForm key={`${recordId}:${data.version}`} recordId={recordId} version={data.version} onBusy={changeBusy} onStale={() => setRetry(n => n + 1)} onSaved={result => { setSuccess(result.state === "Resolved" ? `Attendance record reviewed. Recorded outcome: ${result.finalOutcome}.` : "Review action saved. The case remains under review."); onChanged(); setRetry(n => n + 1); }} /> : <p role="status" className="text-sm text-slate-700">This record is already resolved. The final attendance decision cannot be changed.</p>}
          </section>
          <details className="border-t border-slate-200 pt-4"><summary className="cursor-pointer font-semibold text-maroon-800">Additional information</summary>
            <div className="mt-5 space-y-6">
              <section className="space-y-3"><Heading>Appointment metadata</Heading><Fields fields={[
                ["Consultation concern", data.concern], ["Booking method", data.bookingMethod], ["Record ID", data.recordId],
                ["Placed under review", date(data.attendance?.reviewStartedAt)], ["Response deadline", date(data.attendance?.responseDeadlineAt)],
                ["Review state", data.state], ["Final outcome", data.attendance?.finalOutcome],
                ["Created", date(data.createdAt)], ["Updated", date(data.updatedAt)],
              ]} /></section>
              <ConsultationDocumentViewer recordId={recordId} documents={data.documents || []} />
              <section className="space-y-3"><Heading>Previous review actions</Heading>{!data.actions.length ? <p className="text-sm text-slate-600">No Dean actions recorded.</p> : <ol className="space-y-3">{data.actions.map(entry => <li className="border-l-2 border-gold-500 pl-3 text-sm" key={entry.reviewId}><p className="font-medium text-slate-900">{resolutionLabels[entry.action] || entry.action} · {date(entry.reviewedAt)}</p><p className="mt-1 whitespace-pre-wrap break-words text-slate-700">{entry.reason}</p><p className="mt-1 text-xs text-slate-500">{entry.previousStatus} → {entry.resultingStatus}{entry.finalOutcome ? ` · ${entry.finalOutcome}` : ""}</p></li>)}</ol>}</section>
              <section className="space-y-3"><Heading>Status history</Heading>{!data.statusHistory.length ? <p className="text-sm text-slate-600">No recorded history.</p> : <ol className="space-y-3">{data.statusHistory.map((entry, index) => <li className="border-l-2 border-gold-500 pl-3 text-sm" key={index}><p className="font-medium text-slate-900">{entry.from} → {entry.to}</p><p className="mt-1 text-xs text-slate-500">{entry.actorRole} · {entry.actorType} · {date(entry.timestamp)} · {entry.source}</p>{entry.reason && <p className="mt-1 whitespace-pre-wrap break-words text-slate-700">{entry.reason}</p>}</li>)}</ol>}</section>
            </div>
          </details>
        </div>}
      </div>
    </div>
  </dialog>;
}
