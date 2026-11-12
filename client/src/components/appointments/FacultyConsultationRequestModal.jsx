import { useEffect, useId, useRef, useState } from "react";
import { api } from "../../api/apiClient";
import { Modal } from "../UI";
import { safeUiError } from "../../utils/safeUiErrors";
import { useToast } from "../../context/ToastContext";

const initial = { studentId: "", subject: "", reason: "", startAt: "", endAt: "", mode: "Face-to-Face", location: "", meetingPlatform: "", meetingLink: "" };
const timestamp = value => value ? `${value}:00+08:00` : "";
export default function FacultyConsultationRequestModal({ open, onClose, onSuccess, opener, initialStudent }) {
  const toast = useToast();
  const [form, setForm] = useState(initial), [query, setQuery] = useState(""), [students, setStudents] = useState([]);
  const [searching, setSearching] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const inFlight = useRef(false);
  const formId = useId();
  useEffect(() => {
    if (open && initialStudent?.id) {
      setForm(current => ({ ...current, studentId: initialStudent.id }));
      setStudents([initialStudent]); setQuery(initialStudent.name || "");
    }
  }, [open, initialStudent]);
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
      toast.success("Consultation request sent to the Student.");
      setForm(initial); setStudents([]); setQuery(""); await onSuccess?.(); onClose();
    } catch (requestError) { setError(safeUiError(requestError, "Unable to send the consultation request. Review the schedule and try again.")); }
    finally { inFlight.current = false; setBusy(false); }
  };
  if (!open) return null;
  const close = () => !inFlight.current && onClose();
  return <Modal onClose={close} title="Request Consultation" busy={busy} maxWidth="2xl" actions={<><button type="button" className="btn-secondary" disabled={busy} onClick={close}>Cancel</button><button type="submit" form={formId} className="btn-primary" disabled={busy || !form.studentId}>{busy ? "Sending..." : "Send Consultation Request"}</button></>}>
    <form id={formId} className="space-y-4" onSubmit={submit}>
      <fieldset className="space-y-2"><legend className="font-semibold">Selected Student</legend>{!initialStudent && <div className="flex flex-col gap-2 sm:flex-row"><label className="min-w-0 flex-1">Name or institutional ID<input className="field mt-1 w-full" value={query} onChange={event => setQuery(event.target.value)} /></label><button type="button" className="btn-secondary self-end" disabled={searching || query.trim().length < 2} onClick={search}>{searching ? "Searching..." : "Search"}</button></div>}
        {initialStudent && <div className="rounded-xl border border-maroon-100 bg-maroon-50 px-4 py-3"><p className="font-bold text-maroon-900">{initialStudent.name}</p>{(initialStudent.program || initialStudent.yearLevel) && <p className="mt-1 text-sm text-slate-600">{[initialStudent.program, initialStudent.yearLevel].filter(Boolean).join(" · ")}</p>}</div>}
        {!initialStudent && students.length > 0 && <div className="max-h-40 space-y-1 overflow-y-auto" role="radiogroup" aria-label="Eligible Students">{students.map(student => <label key={student.id} className="flex cursor-pointer gap-2 rounded border p-2"><input type="radio" name="student" required checked={form.studentId === student.id} onChange={() => change("studentId", student.id)} /><span className="min-w-0 break-words"><strong>{student.name}</strong><br /><span className="text-sm text-slate-600">{student.institutionalId}</span></span></label>)}</div>}
      </fieldset>
      <label className="block font-semibold">Consultation subject<input className="field mt-1 w-full" required maxLength={150} value={form.subject} onChange={event => change("subject", event.target.value)} /></label>
      <label className="block font-semibold">Reason for consultation<textarea className="field mt-1 w-full" required maxLength={1000} rows={4} value={form.reason} onChange={event => change("reason", event.target.value)} /></label>
      <div className="grid gap-3 sm:grid-cols-2"><label className="font-semibold">Start — Asia/Manila<input className="field mt-1 w-full" type="datetime-local" required value={form.startAt} onChange={event => change("startAt", event.target.value)} /></label><label className="font-semibold">End — Asia/Manila<input className="field mt-1 w-full" type="datetime-local" required value={form.endAt} onChange={event => change("endAt", event.target.value)} /></label></div>
      <p className="rounded-lg border border-gold-200 bg-gold-50 p-3 text-sm text-slate-700">This proposed time remains a Pending request until the Student accepts. SOCConsult checks conflicts again before confirmation.</p>
      <label className="block font-semibold">Consultation mode<select className="field mt-1 w-full" value={form.mode} onChange={event => change("mode", event.target.value)}><option>Face-to-Face</option><option>Online</option></select></label>
      {form.mode === "Face-to-Face" ? <label className="block font-semibold">Location<input className="field mt-1 w-full" required maxLength={150} value={form.location} onChange={event => change("location", event.target.value)} /></label> : <><label className="block font-semibold">Meeting platform<input className="field mt-1 w-full" required maxLength={100} value={form.meetingPlatform} onChange={event => change("meetingPlatform", event.target.value)} /></label><label className="block font-semibold">Meeting link (optional)<input className="field mt-1 w-full" type="url" maxLength={500} value={form.meetingLink} onChange={event => change("meetingLink", event.target.value)} /></label></>}
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    </form>
  </Modal>;
}
