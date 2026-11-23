import { formatManilaDateTime, formatDateOnly } from "../../utils/formatDateTime";
import { deanUiError } from "../../utils/deanUiErrors";
import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { api } from "../../api/apiClient";
import "./ReportNarrativePanel.css";

const disclaimer = "This narrative was generated from authorized aggregate SOCConsult data. It must be reviewed by the Dean before inclusion in an official report.";
export default function ReportNarrativePanel({ filters }) {
  const [draft, setSummary] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const active = useRef(true);
  const [conflict, setConflict] = useState(false);
  const [operation, setOperation] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const selection = useRef({ key: "", version: 0 });
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const input = Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== ""));
  const filterKey = JSON.stringify(["start", "end", "facultyId", "status", "attendanceOutcome", "mode"].map(key => input[key] || ""));
  if (selection.current.key !== filterKey) selection.current = { key: filterKey, version: selection.current.version + 1 };
  // A selection change invalidates the visible draft even if filters later return
  // to their previous values. Historical approvals remain tied to their record.
  const summary = draft?.selectionVersion === selection.current.version ? draft : null;
  const matches = summary && ["start", "end", "facultyId", "status", "attendanceOutcome", "mode"].every(key => (summary.filters[key] || "") === (input[key] || ""));
  async function perform(review = false) {
    if (pending.current) return;
    if (review && (!summary || summary.selectionVersion !== selection.current.version || !matches || conflict || summary.reviewState !== "unreviewed")) return;
    const requestVersion = selection.current.version;
    const startedAt = performance.now();
    pending.current = true; setBusy(true); setError(""); setCopyMessage(""); setOperation(review ? "review" : "generate");
    if (!review) setSummary(null);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 40000);
    try {
      const result = await api(review ? `/dean/reports/ai-summaries/${summary.id}/review` : "/dean/reports/ai-summaries", { method: "POST", signal: controller.signal, body: JSON.stringify(review ? { expectedVersion: summary.version } : input) });
      clearTimeout(timer);
      if (!active.current || requestVersion !== selection.current.version) return;
      if (!result?.id || !result.filters || typeof result.narrative !== "string" || !result.narrative.trim()) throw Object.assign(new Error(), { code: "AI_INVALID_OUTPUT" });
      if (!["start", "end", "facultyId", "status", "attendanceOutcome", "mode"].every(key => (result.filters[key] || "") === (input[key] || "")) || (review ? result.id !== summary.id || result.narrative !== summary.narrative || result.reviewState !== "reviewed" || result.version !== 2 : result.id === draft?.id || result.reviewState !== "unreviewed" || result.version !== 1 || result.reviewedAt)) throw Object.assign(new Error(), { code: "AI_INVALID_OUTPUT" });
      // Only fast, successful generations get the remainder of a brief visual transition.
      // Review requests, failures and requests already taking 600ms finish immediately.
      const remaining = review ? 0 : 600 - (performance.now() - startedAt);
      if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
      if (!active.current || requestVersion !== selection.current.version) return;
      setSummary({ ...result, selectionVersion: requestVersion }); setConflict(false);
    } catch (failure) { if (!active.current || requestVersion !== selection.current.version) return; setConflict(review && (failure.status === 409 || !failure.status || failure.status >= 500)); setError(narrativeError(failure, review)); }
    finally { clearTimeout(timer); pending.current = false; if (active.current) setBusy(false); }
  }
  async function refresh() {
    if (pending.current || !summary) return;
    const requestVersion = selection.current.version;
    pending.current = true; setBusy(true); setError(""); setOperation("refresh");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 40000);
    try {
      const result = await api(`/dean/reports/ai-summaries/${summary.id}`, { signal: controller.signal });
      if (active.current && requestVersion === selection.current.version) {
        if (result?.id !== summary.id || result.narrative !== summary.narrative || !["unreviewed", "reviewed"].includes(result.reviewState) || result.version !== (result.reviewState === "reviewed" ? 2 : 1)) throw Object.assign(new Error(), { code: "AI_INVALID_OUTPUT" });
        setSummary({ ...summary, reviewState: result.reviewState, version: result.version, reviewedAt: result.reviewedAt }); setConflict(false);
      }
    }
    catch (failure) { if (active.current && requestVersion === selection.current.version) setError(narrativeError(failure, true)); }
    finally { clearTimeout(timer); pending.current = false; if (active.current) setBusy(false); }
  }
  async function copyNarrative() {
    try { await navigator.clipboard.writeText(summary.narrative); if (active.current) setCopyMessage("Narrative copied."); }
    catch { if (active.current) setCopyMessage("Copy is unavailable. Select the narrative text and copy it manually."); }
  }
  const paragraphs = summary?.narrative.split(/\n\n(?=Executive Summary\n|Consultation Activity\n|Attendance Analysis\n|Key Observations\n|Recommendations\n)/) || [];
  const snapshot = summary?.snapshot;
  const statistics = snapshot && Number.isInteger(snapshot.totalConsultations) && snapshot.totalConsultations >= 0 && ["Completed", "Student No-show", "Faculty No-show"].every(key => Number.isInteger(snapshot.attendanceOutcomeCounts?.[key]) && snapshot.attendanceOutcomeCounts[key] >= 0) ? [
    ["Consultation requests", snapshot.totalConsultations],
    ["Verified attendance", snapshot.attendanceOutcomeCounts.Completed],
    ["Student no-shows", snapshot.attendanceOutcomeCounts["Student No-show"]],
    ["Faculty no-shows", snapshot.attendanceOutcomeCounts["Faculty No-show"]],
  ] : [];
  const generating = busy && operation === "generate";
  const empty = error.startsWith("No consultations match");
  return <section className="soc-insights" aria-label="SOC Insights" aria-busy={busy} data-generating={generating}>
    <header className="insights-header">
      <div className="insights-identity">
        <span className="insights-mark" aria-hidden="true"><Sparkles size={24} strokeWidth={1.6} /></span>
        <div>
          <p className="insights-eyebrow">AI-assisted academic briefing</p>
          <h2>SOC Insights</h2>
        </div>
      </div>
      <button type="button" className="btn-primary insights-generate" disabled={busy} onClick={() => perform()}>
        {generating ? "Generating AI Summary" : error && !empty && operation === "generate" ? "Try again" : summary ? "Generate new AI Summary" : "Generate AI Summary"}
      </button>
    </header>
    <p className="insights-description">Turn the selected consultation statistics into a structured narrative for Dean review. Generated separately from your PDF report.</p>
    {busy && <div className="narrative-generating" role="status" aria-live="polite" aria-atomic="true">
      <p className="insights-progress">{generating ? "Generating narrative from authorized report statistics" : operation === "review" ? "Saving narrative review" : "Refreshing narrative status"}<span className="narrative-dots" aria-hidden="true"><span /><span /><span /></span></p>
      {generating && <>
        <p className="insights-progress-note">Your briefing will appear here when ready. PDF reporting remains available.</p>
        <div className="narrative-skeleton" aria-hidden="true">{[0, 1].map(group => <div key={group}><span className="skeleton-heading" /><span /><span /><span className="skeleton-short" /></div>)}</div>
      </>}
    </div>}
    {error && <div role="alert" className={`insights-notice ${empty ? "insights-empty" : "insights-error"}`}>
      <p className="insights-notice-title">{empty ? "No report data for this selection" : "Narrative unavailable"}</p>
      <p>{error}</p>
    </div>}
    {conflict && summary && <button type="button" className="btn-secondary" disabled={busy} onClick={refresh}>Refresh narrative status</button>}
    {!summary && draft && <p role="status" className="text-sm text-slate-600">Filters changed. Generate a new narrative for this selection; the previous draft and its approval do not apply.</p>}
    {summary && <div className="insights-result" key={summary.id}>
      <p role="status" className="insights-ready">{summary.reviewState === "reviewed" ? "Review completed. This narrative is approved." : "Draft ready for Dean review."}</p>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4">
        <div><p className="insights-eyebrow">Reporting period</p><p className="mt-1 font-medium text-slate-800">{formatDateOnly(summary.filters.start)} to {formatDateOnly(summary.filters.end)}</p><p className="mt-1 text-xs text-slate-500">Generated {formatManilaDateTime(summary.generatedAt)} (Asia/Manila)</p></div>
        <p role="status" className={`rounded-full px-3 py-1 text-xs font-medium ${summary.reviewState === "reviewed" ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>{summary.reviewState === "reviewed" ? "Reviewed" : "Draft (Unreviewed)"}</p>
      </div>
      <p className="text-xs text-slate-600">{Object.entries(summary.filters).filter(([key]) => !["start", "end"].includes(key)).map(([key, value]) => `${({ facultyId: "Faculty", status: "Workflow status", attendanceOutcome: "Attendance outcome", mode: "Mode" })[key] || key}: ${key === "facultyId" ? "Selected faculty" : value}`).join(" | ") || "All faculty, workflow statuses, attendance outcomes and modes"}</p>
      {statistics.length > 0 && <div aria-label="System-calculated report statistics">
        <dl className="insights-statistics">{statistics.map(([label, value]) => <div key={label} className="insights-statistic"><dt className="text-xs text-slate-600">{label}</dt><dd className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</dd></div>)}</dl>
        <p className="mt-2 text-xs text-slate-500">Figures use this narrative's saved report snapshot. Verified attendance is separate from workflow completion.</p>
      </div>}
      {!matches && <p role="status">This narrative uses different filters from the current report.</p>}
      <article aria-label="Report narrative" className="insights-briefing">
        {paragraphs.map((text, index) => {
          const newline = text.indexOf("\n");
          const title = newline >= 0 ? text.slice(0, newline) : "";
          const structured = ["Executive Summary", "Consultation Activity", "Attendance Analysis", "Key Observations", "Recommendations"].includes(title);
          return <section key={index} className="insights-briefing-section">{structured && <h3>{title}</h3>}{(structured ? text.slice(newline + 1) : text).split(/\n\n+/).map((paragraph, paragraphIndex) => <p key={paragraphIndex}>{paragraph}</p>)}</section>;
        })}
      </article>
      <p className="border-t border-slate-200 pt-4 text-xs leading-5 text-slate-500">{disclaimer}</p>
      {summary.reviewedAt && <p className="text-xs text-slate-600">Reviewed: {formatManilaDateTime(summary.reviewedAt)} (Asia/Manila)</p>}
      <div className="insights-actions">
      {summary.reviewState === "unreviewed" && <button type="button" className="btn-primary" disabled={busy || !matches || conflict} onClick={() => perform(true)}>I have reviewed and approve this narrative</button>}
      <button type="button" className="btn-secondary" disabled={busy} onClick={copyNarrative}>Copy Narrative</button>
      </div>
      {copyMessage && <p role="status" className="text-sm text-slate-600">{copyMessage}</p>}
    </div>}
  </section>;
}

function narrativeError(error, review) {
  if (error?.code === "AI_EMPTY_DATASET") return "No consultations match these filters. Select another date range or filter before generating a narrative.";
  if (error?.code === "AI_INVALID_OUTPUT") return "The AI response could not be validated. Please try again. PDF reports remain available.";
  if (error?.name === "AbortError" || error?.code === "AI_TIMEOUT") return review ? "The review request timed out. Refresh narrative status before trying again." : "AI generation timed out. Please try again later. PDF reports remain available.";
  if (error?.status === 429) return "An AI request is already processing or the request limit was reached. Wait before trying again.";
  return deanUiError(error, "ai");
}
