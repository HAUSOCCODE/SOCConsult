import { formatManilaDateTime, formatDateOnly } from "../../utils/formatDateTime";
import { deanUiError } from "../../utils/deanUiErrors";
import { useEffect, useRef, useState } from "react";
import { api } from "../../api/apiClient";

const disclaimer = "This narrative was generated from authorized aggregate SOCConsult data. It must be reviewed by the Dean before inclusion in an official report.";
export default function ReportNarrativePanel({ filters }) {
  const [summary, setSummary] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const active = useRef(true);
  const [conflict, setConflict] = useState(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const input = Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== ""));
  const matches = summary && ["start", "end", "facultyId", "status", "attendanceOutcome", "mode"].every(key => (summary.filters[key] || "") === (input[key] || ""));
  async function perform(review = false) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try {
      const result = await api(review ? `/dean/reports/ai-summaries/${summary.id}/review` : "/dean/reports/ai-summaries", { method: "POST", body: JSON.stringify(review ? { expectedVersion: summary.version } : input) });
      if (!active.current) return;
      setSummary(result); setConflict(false);
    } catch (failure) { if (!active.current) return; setConflict(review && failure.status === 409); setError(deanUiError(failure, "ai")); }
    finally { pending.current = false; if (active.current) setBusy(false); }
  }
  async function refresh() {
    if (pending.current || !summary) return;
    pending.current = true; setBusy(true); setError("");
    try { const result = await api(`/dean/reports/ai-summaries/${summary.id}`); if (active.current) { setSummary(result); setConflict(false); } }
    catch (failure) { if (active.current) setError(deanUiError(failure, "ai")); }
    finally { pending.current = false; if (active.current) setBusy(false); }
  }
  return <section className="space-y-3 rounded-2xl border bg-white p-6" aria-label="Optional AI Summary" aria-busy={busy}>
    <h2 className="text-lg font-semibold">Optional AI Summary</h2>
    <p className="text-sm">AI-assisted narrative. PDF reports work independently and do not include this narrative.</p>
    <p className="text-sm">{disclaimer}</p>
    <button type="button" className="btn-primary" disabled={busy} onClick={() => perform()}>{summary ? "Generate new AI Summary" : "Generate AI Summary"}</button>
    {busy && <p role="status">Processing AI summary…</p>}
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {conflict && <button type="button" className="btn-secondary" disabled={busy} onClick={refresh}>Refresh narrative status</button>}
    {summary && <div className="space-y-3">
      <p role="status">{summary.reviewState === "reviewed" ? "Review completed. " : "AI summary ready for review. "}AI-assisted · {summary.reviewState === "reviewed" ? "Reviewed" : "Unreviewed"}</p>
      <p>Date range: {formatDateOnly(summary.filters.start)} to {formatDateOnly(summary.filters.end)}</p>
      <p>Generated: {formatManilaDateTime(summary.generatedAt)} (Asia/Manila)</p>
      <p>Snapshot filters: {Object.entries(summary.filters).map(([key, value]) => `${key}: ${key === "facultyId" ? "Selected faculty" : ["start", "end"].includes(key) ? formatDateOnly(value) : value}`).join("; ")}</p>
      {!matches && <p role="status">This narrative uses different filters from the current report.</p>}
      <p className="whitespace-pre-wrap break-words">{summary.narrative}</p>
      {summary.reviewedAt && <p>Reviewed: {formatManilaDateTime(summary.reviewedAt)} (Asia/Manila)</p>}
      {summary.reviewState === "unreviewed" && <button type="button" className="btn-primary" disabled={busy || !matches || conflict} onClick={() => perform(true)}>I have reviewed and approve this narrative</button>}
    </div>}
  </section>;
}
