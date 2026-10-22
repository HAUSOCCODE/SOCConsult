import { useEffect, useRef, useState } from "react";
import { api } from "../../api/apiClient";
import ConsultationRecordView from "./ConsultationRecordView";

export const CONSULTATION_NOTES_LIMIT = 3000;
export const CONSULTATION_RECOMMENDATIONS_LIMIT = 3000;

const safeError = error => {
  if (!error?.status) return "Network connection interrupted. Check your connection and try again.";
  if (error.status === 401) return "Your session has expired. Please sign in again.";
  if ([403, 404].includes(error.status)) return "This consultation record is unavailable.";
  if (error.status === 409) return "The consultation record changed or is not currently editable. Reload it before saving.";
  if (error.status === 400) return "Review the consultation notes and recommendations before saving.";
  return "Unable to save the consultation record. Please try again.";
};

export default function ConsultationRecordForm({ appointmentId }) {
  const [state, setState] = useState({ loading: true });
  const [notes, setNotes] = useState("");
  const [recommendations, setRecommendations] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);

  const load = async ({ preserveDraft = false } = {}) => {
    setState({ loading: true });
    if (!preserveDraft) setError("");
    try {
      const data = await api(`/appointments/${appointmentId}/consultation-record`, { cache: "no-store" });
      setState(data);
      if (!preserveDraft) {
        setNotes(data.record?.notes || "");
        setRecommendations(data.record?.recommendations || "");
      }
    } catch (requestError) { setState({ error: safeError(requestError) }); }
  };
  useEffect(() => { void load(); }, [appointmentId]);

  const save = async event => {
    event.preventDefault();
    if (pending.current) return;
    const cleanNotes = notes.trim(), cleanRecommendations = recommendations.trim();
    if (!cleanNotes && !cleanRecommendations) return setError("Add consultation notes or recommendations before saving.");
    pending.current = true; setSaving(true); setError("");
    try {
      const data = await api(`/appointments/${appointmentId}/consultation-record`, { method: "PUT",
        body: JSON.stringify({ notes: cleanNotes, recommendations: cleanRecommendations,
          ...(state.record && { expectedVersion: state.record.version }) }) });
      setState(data); setNotes(data.record.notes); setRecommendations(data.record.recommendations);
    } catch (requestError) {
      setError(safeError(requestError));
      if (requestError?.status === 409) await load({ preserveDraft: true });
    } finally { pending.current = false; setSaving(false); }
  };

  return <section className="min-w-0 rounded-xl border border-slate-200 p-4 sm:p-5" aria-labelledby="consultation-record-heading">
    <h3 id="consultation-record-heading" className="font-bold text-maroon-900">Consultation Record</h3>
    {state.loading ? <p className="mt-3 text-sm text-slate-600" role="status">Loading consultation record...</p>
      : state.error ? <div className="mt-3" role="alert"><p className="text-sm text-red-700">{state.error}</p><button type="button" className="btn-secondary mt-3" onClick={load}>Try again</button></div>
        : !state.canEdit ? <div className="mt-3"><ConsultationRecordView record={state.record} />{!state.consultationEnded && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Consultation notes can be recorded after the scheduled consultation.</p>}</div>
          : <form className="mt-4 min-w-0 space-y-4" onSubmit={save}>
            <p className="text-sm leading-6 text-slate-600">Record professional consultation notes and recommendations that may be visible to the Student.</p>
            <label className="block text-sm font-bold text-slate-800">Consultation Notes / Summary
              <textarea className="field mt-2 min-h-28 w-full resize-y" rows={5} maxLength={CONSULTATION_NOTES_LIMIT} disabled={saving} value={notes} onChange={event => { setNotes(event.target.value); setError(""); }} />
              <span className="mt-1 block text-right text-xs font-normal text-slate-500">{notes.length}/{CONSULTATION_NOTES_LIMIT}</span>
            </label>
            <label className="block text-sm font-bold text-slate-800">Recommendations
              <textarea className="field mt-2 min-h-28 w-full resize-y" rows={5} maxLength={CONSULTATION_RECOMMENDATIONS_LIMIT} disabled={saving} value={recommendations} onChange={event => { setRecommendations(event.target.value); setError(""); }} />
              <span className="mt-1 block text-right text-xs font-normal text-slate-500">{recommendations.length}/{CONSULTATION_RECOMMENDATIONS_LIMIT}</span>
            </label>
            {state.record && <ConsultationRecordView record={state.record} />}
            {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
            <button type="submit" className="btn-primary min-h-10 w-full sm:w-auto" disabled={saving}>{saving ? "Saving..." : state.record ? "Update Consultation Record" : "Save Consultation Record"}</button>
          </form>}
  </section>;
}
