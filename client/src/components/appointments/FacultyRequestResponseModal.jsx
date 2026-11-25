import { useRef, useState } from "react";
import { Modal } from "../UI";
import ConfirmDialog from "../ConfirmDialog";
import { api } from "../../api/apiClient";
import { safeStudentError } from "../../utils/studentUiErrors";
import { formatManilaDateTime } from "../../utils/formatDateTime";
import { useToast } from "../../context/ToastContext";

const initial = { startAt: "", endAt: "", mode: "Face-to-Face", location: "", meetingPlatform: "", meetingLink: "", reason: "" };
const stamp = value => value ? `${value}:00+08:00` : "";
const clock = value => value ? new Date(`2000-01-01T${value}:00+08:00`).toLocaleTimeString("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" }) : "Not provided";
export default function FacultyRequestResponseModal({ appointment, onClose, onSuccess, onConflict }) {
  const toast = useToast();
  const [form, setForm] = useState(initial), [decision, setDecision] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const inFlight = useRef(false), change = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const canAccept = Boolean(appointment.startAt) && new Date(appointment.startAt) > new Date();
  const respond = async selected => {
    if (inFlight.current || (selected === "accept" && !canAccept)) return;
    if (selected === "propose") {
      const start = new Date(stamp(form.startAt)), end = new Date(stamp(form.endAt));
      if (!(start > new Date()) || !(end > start)) {
        setError("Choose a future start and a later end time in Asia/Manila.");
        return;
      }
      if (form.mode === "Face-to-Face" ? !form.location.trim() : !form.meetingPlatform.trim()) {
        setError("Enter a location or a meeting platform for the selected consultation mode.");
        return;
      }
    }
    inFlight.current = true; setBusy(true); setError("");
    try {
      const body = { decision: selected, expectedVersion: appointment.__v,
        ...(selected === "decline" && { reason: form.reason.trim() }),
        ...(selected === "propose" && { ...form, startAt: stamp(form.startAt), endAt: stamp(form.endAt) }) };
      const data = await api(`/appointments/${appointment._id}/respond`, { method: "PUT", body: JSON.stringify(body) });
      await onSuccess(data.appointment);
    } catch (requestError) {
      const message = safeStudentError(requestError, "Unable to respond. Review the schedule and try again.");
      if ([404, 409].includes(requestError.status) && onConflict) {
        toast.error(message);
        await onConflict();
      } else {
        setError(message);
        if (selected !== "propose") setDecision("");
      }
    }
    finally { inFlight.current = false; setBusy(false); }
  };
  return <Modal title="Respond to Faculty Request" busy={busy} onClose={() => !busy && onClose()}><div className="space-y-4">
    <p className="break-words"><strong>{appointment.faculty?.name || "Your Faculty member"}</strong> requested this consultation.</p>
    <div className="rounded-lg bg-slate-50 p-3 text-sm"><p><strong>Subject:</strong> {appointment.subject}</p><p className="mt-1 whitespace-pre-wrap break-words"><strong>Reason:</strong> {appointment.reason}</p></div>
    <p><strong>Faculty proposed schedule (Asia/Manila)</strong><br />{formatManilaDateTime(appointment.startAt)} – {formatManilaDateTime(appointment.endAt)}</p>
    {appointment.availableTimeSlots?.length > 0 && <div className="rounded-lg border border-maroon-100 bg-maroon-50/50 p-3 text-sm"><p className="font-bold text-maroon-900">Faculty available times (Asia/Manila)</p><ul className="mt-1 list-disc space-y-1 pl-5">{appointment.availableTimeSlots.map((slot, index) => <li key={`${slot.startTime}-${slot.endTime}-${index}`}>{clock(slot.startTime)} – {clock(slot.endTime)}</li>)}</ul></div>}
    {decision === "propose" && <div className="space-y-3 rounded-xl border p-4"><h3 className="font-bold">Propose Another Schedule</h3><div className="grid gap-3 sm:grid-cols-2"><label>Start — Asia/Manila<input className="field mt-1 w-full" type="datetime-local" required value={form.startAt} onChange={e => change("startAt", e.target.value)} /></label><label>End — Asia/Manila<input className="field mt-1 w-full" type="datetime-local" required value={form.endAt} onChange={e => change("endAt", e.target.value)} /></label></div><label className="block">Reason<input className="field mt-1 w-full" required maxLength={500} value={form.reason} onChange={e => change("reason", e.target.value)} /></label><label className="block">Mode<select className="field mt-1 w-full" value={form.mode} onChange={e => change("mode", e.target.value)}><option>Face-to-Face</option><option>Online</option></select></label>{form.mode === "Face-to-Face" ? <label className="block">Location<input className="field mt-1 w-full" required value={form.location} onChange={e => change("location", e.target.value)} /></label> : <><label className="block">Meeting platform<input className="field mt-1 w-full" required value={form.meetingPlatform} onChange={e => change("meetingPlatform", e.target.value)} /></label><label className="block">Meeting link (optional)<input className="field mt-1 w-full" type="url" value={form.meetingLink} onChange={e => change("meetingLink", e.target.value)} /></label></>}<button type="button" className="btn-primary" disabled={busy || !form.startAt || !form.endAt || !form.reason.trim()} onClick={() => respond("propose")}>{busy ? "Sending..." : "Send Proposal"}</button></div>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end"><button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>Close</button><button type="button" className="btn-secondary" disabled={busy} onClick={() => setDecision("propose")}>Propose Another Schedule</button><button type="button" className="rounded-lg border border-red-300 px-4 py-2 font-bold text-red-700" disabled={busy} onClick={() => setDecision("decline")}>Decline</button><button type="button" className="btn-primary" disabled={busy || !canAccept} onClick={() => setDecision("accept")}>Accept</button></div>
    <ConfirmDialog open={decision === "accept"} title="Accept consultation request" message="Accept this proposed schedule?" confirmLabel="Accept Request" loading={busy} loadingLabel="Accepting..." onCancel={() => !busy && setDecision("")} onConfirm={() => respond("accept")} />
    <ConfirmDialog open={decision === "decline"} title="Decline consultation request" message="Decline this Faculty consultation request?" inputLabel="Reason (required)" inputRequired inputValue={form.reason} onInputChange={value => change("reason", value)} confirmLabel="Decline Request" loading={busy} loadingLabel="Declining..." onCancel={() => !busy && setDecision("")} onConfirm={() => form.reason.trim() && respond("decline")} />
  </div></Modal>;
}
