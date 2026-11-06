import { useState } from "react";
import { api } from "../../api/apiClient";
import { formatManilaDateTime } from "../../utils/formatDateTime";
import ConfirmDialog from "../ConfirmDialog";

export default function OutcomeReportSummary({ appointmentId, attendance, viewerRole, onChanged }) {
  const [error, setError] = useState(""), [loading, setLoading] = useState(false);
  const [disputing, setDisputing] = useState(false), [reason, setReason] = useState("");
  const report = attendance?.recordedOutcome;
  if (!report) return null;
  const viewProof = async () => {
    if (loading) return;
    setLoading(true); setError("");
    try {
      const { blob } = await api.download(`/appointments/${appointmentId}/attendance-proof`);
      const url = URL.createObjectURL(blob); window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch { setError("Unable to open the consultation proof. Please try again."); }
    finally { setLoading(false); }
  };
  const dispute = async () => {
    if (!reason.trim() || loading) return;
    setLoading(true); setError("");
    try {
      await api(`/appointments/${appointmentId}/attendance-dispute`, { method: "POST", body: JSON.stringify({ reason: reason.trim() }) });
      setDisputing(false); setReason(""); await onChanged?.();
    } catch { setError("Unable to dispute this outcome. Refresh the consultation and try again."); }
    finally { setLoading(false); }
  };
  return <section className="rounded-xl border border-slate-200 bg-slate-50 p-4" aria-labelledby={`outcome-report-${appointmentId}`}>
    <h3 id={`outcome-report-${appointmentId}`} className="font-bold text-maroon-900">Outcome and Evidence</h3>
    <dl className="mt-3 space-y-2 text-sm">
      <div><dt className="font-semibold text-slate-600">Original request initiator</dt><dd className="capitalize">{attendance.initiatorRole}</dd></div>
      <div><dt className="font-semibold text-slate-600">Reported outcome</dt><dd>{report.outcome}</dd></div>
      <div><dt className="font-semibold text-slate-600">Reported by</dt><dd className="capitalize">{report.reportedByRole}</dd></div>
      <div><dt className="font-semibold text-slate-600">Date reported</dt><dd>{formatManilaDateTime(report.submittedAt)}</dd></div>
      {report.reason && <div><dt className="font-semibold text-slate-600">Remarks</dt><dd className="whitespace-pre-wrap break-words">{report.reason}</dd></div>}
    </dl>
    {report.proof?.available && <button type="button" className="btn-secondary mt-3" onClick={viewProof} disabled={loading}>{loading ? "Opening proof..." : "View Proof"}</button>}
    {attendance.status === "Completed" && viewerRole && viewerRole !== report.reportedByRole && <button type="button" className="btn-secondary mt-3 ml-2" onClick={() => setDisputing(true)} disabled={loading}>Dispute Outcome</button>}
    {error && <p role="alert" className="mt-2 text-sm font-semibold text-red-700">{error}</p>}
    <ConfirmDialog open={disputing} title="Dispute reported outcome" message="Send this outcome to the Dean for review?" inputLabel="Dispute reason (required, up to 500 characters)" inputRequired inputMaxLength={500} inputValue={reason} onInputChange={setReason} confirmLabel="Submit Dispute" loading={loading} loadingLabel="Submitting..." onCancel={() => !loading && setDisputing(false)} onConfirm={dispute} />
  </section>;
}
