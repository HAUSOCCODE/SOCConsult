import { useRef, useState } from "react";
import { api } from "../../api/apiClient";
import { Modal } from "../UI";
import { safeUiError } from "../../utils/safeUiErrors";

const initial = { studentId: "", subject: "", reason: "", startAt: "", endAt: "", mode: "Face-to-Face", location: "", meetingPlatform: "", meetingLink: "" };
const timestamp = value => value ? `${value}:00+08:00` : "";
export default function FacultyConsultationRequestModal({ open, onClose, onSuccess, opener }) {
  const [form, setForm] = useState(initial), [query, setQuery] = useState(""), [students, setStudents] = useState([]);
  const [searching, setSearching] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const inFlight = useRef(false);
  const change = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const search = async () => {
    if (query.trim().length < 2 || searching) return;
    setSearching(true); setError("");
    try { const data = await api(`/appointments/faculty-request/students?q=${encodeURIComponent(query.trim())}`); setStudents(data.students || []); }
    catch (requestError) { setError(safeUiError(requestError, "Unable to search Students. Please try again.")); }
    finally { setSearching(false); }
  };
  const submit = async event => {
    event.preventDefault(); if (inFlight.current) return; inFlight.current = true; setBusy(true); setError("");
    try {
      await api("/appointments/faculty-request", { method: "POST", body: JSON.stringify({ ...form,
        startAt: timestamp(form.startAt), endAt: timestamp(form.endAt) }) });
      setForm(initial); setStudents([]); setQuery(""); await onSuccess?.(); onClose();
    } catch (requestError) { setError(safeUiError(requestError, "Unable to send the consultation request. Review the schedule and try again.")); }
    finally { inFlight.current = false; setBusy(false); }
  };
  if (!open) return null;
  return <Modal onClose={() => !inFlight.current && onClose()} title="Request Consultation">
    <form className="space-y-4" onSubmit={submit}>
      <fieldset className="space-y-2"><legend className="font-semibold">Select Student</legend><div className="flex flex-col gap-2 sm:flex-row"><label className="min-w-0 flex-1">Name or institutional ID<input className="field mt-1 w-full" value={query} onChange={event => setQuery(event.target.value)} /></label><button type="button" className="btn-secondary self-end" disabled={searching || query.trim().length < 2} onClick={search}>{searching ? "Searching..." : "Search"}</button></div>
        {students.length > 0 && <div className="max-h-40 space-y-1 overflow-y-auto" role="radiogroup" aria-label="Eligible Students">{students.map(student => <label key={student.id} className="flex cursor-pointer gap-2 rounded border p-2"><input type="radio" name="student" required checked={form.studentId === student.id} onChange={() => change("studentId", student.id)} /><span className="min-w-0 break-words"><strong>{student.name}</strong><br /><span className="text-sm text-slate-600">{student.institutionalId}</span></span></label>)}</div>}
      </fieldset>
      <label className="block font-semibold">Consultation subject<input className="field mt-1 w-full" required maxLength={150} value={form.subject} onChange={event => change("subject", event.target.value)} /></label>
      <label className="block font-semibold">Reason for consultation<textarea className="field mt-1 w-full" required maxLength={1000} rows={4} value={form.reason} onChange={event => change("reason", event.target.value)} /></label>
      <div className="grid gap-3 sm:grid-cols-2"><label className="font-semibold">Start — Asia/Manila<input className="field mt-1 w-full" type="datetime-local" required value={form.startAt} onChange={event => change("startAt", event.target.value)} /></label><label className="font-semibold">End — Asia/Manila<input className="field mt-1 w-full" type="datetime-local" required value={form.endAt} onChange={event => change("endAt", event.target.value)} /></label></div>
      <label className="block font-semibold">Consultation mode<select className="field mt-1 w-full" value={form.mode} onChange={event => change("mode", event.target.value)}><option>Face-to-Face</option><option>Online</option></select></label>
      {form.mode === "Face-to-Face" ? <label className="block font-semibold">Location<input className="field mt-1 w-full" required maxLength={150} value={form.location} onChange={event => change("location", event.target.value)} /></label> : <><label className="block font-semibold">Meeting platform<input className="field mt-1 w-full" required maxLength={100} value={form.meetingPlatform} onChange={event => change("meetingPlatform", event.target.value)} /></label><label className="block font-semibold">Meeting link (optional)<input className="field mt-1 w-full" type="url" maxLength={500} value={form.meetingLink} onChange={event => change("meetingLink", event.target.value)} /></label></>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy || !form.studentId}>{busy ? "Sending..." : "Send Consultation Request"}</button></div>
    </form>
  </Modal>;
}
