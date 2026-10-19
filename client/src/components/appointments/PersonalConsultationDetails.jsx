import { useRef } from "react";
import { createPortal } from "react-dom";
import useDialogFocus from "../../hooks/useDialogFocus";
import { formatManilaDisplay } from "../../utils/formatDateTime";
import SupportingDocumentViewer from "./SupportingDocumentViewer";
import OnlineMeetingDetails from "./OnlineMeetingDetails";
import { StatusBadge } from "../UI";

export const consultationTime = value => value && Number.isFinite(+new Date(value)) ? formatManilaDisplay(new Date(value), undefined, "timestamp") : "Not scheduled";
export default function PersonalConsultationDetails({ appointment: a, onClose, children, opener }) {
  const ref = useRef(null);
  useDialogFocus(ref, { onClose, restoreTarget: opener });
  const attendance = a.attendance;
  return createPortal(<div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-3" onMouseDown={e => e.target === e.currentTarget && onClose()}>
    <section ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="personal-consultation-title" className="max-h-[90dvh] w-full max-w-3xl overflow-auto rounded-xl bg-white p-5 shadow-xl">
      <header className="flex items-center justify-between gap-3"><h2 id="personal-consultation-title" className="text-xl font-bold">Consultation Details</h2><button type="button" onClick={onClose} className="btn-secondary" aria-label="Close consultation details">Close</button></header>
      <div className="mt-4 space-y-5">
        <StatusBadge appointment status={a.status} />
        <dl className="space-y-3"><Field label="Student" value={a.student?.name} /><Field label="Subject / Course" value={a.subject} /><Field label="Consultation Concern" value={a.reason} /></dl>
        <section className="rounded border p-4"><h3 className="font-bold">{a.confirmedSchedule ? "Confirmed schedule" : "Current schedule"}</h3><Schedule start={a.startAt} end={a.endAt} mode={a.consultationMode} location={a.location} platform={a.meetingPlatform} /></section>
        {(a.proposedStartAt || a.status === "Reschedule Proposed") && <section className="rounded border p-4"><h3 className="font-bold">Proposed schedule - awaiting Student response; proposed time is not reserved</h3><Schedule start={a.proposedStartAt} end={a.proposedEndAt} mode={a.proposedConsultationMode} location={a.proposedLocation} platform={a.proposedMeetingPlatform} /></section>}
        <OnlineMeetingDetails appointment={a} allowLink={Boolean(a.meetingLink)} />
        <section><h3 className="font-bold">Status history</h3>{!a.statusHistory?.length ? <p>No recorded status history.</p> : <ol className="mt-2 space-y-3">{a.statusHistory.map((event, index) => <li key={index} className="rounded border p-3"><p>{event.previousStatus} ? {event.newStatus}</p><p className="text-sm">{consultationTime(event.changedAt)} - {event.changedByRole}</p>{event.reason && <p className="whitespace-pre-wrap break-words">{event.reason}</p>}</li>)}</ol>}</section>
        <section><h3 className="font-bold">Attendance</h3>{attendance?.enrolled ? <dl className="mt-2 space-y-2"><Field label="Opens" value={consultationTime(attendance.attendanceOpensAt)} /><Field label="Deadline" value={consultationTime(attendance.responseDeadlineAt)} />{attendance.ownResponse && <><Field label="Your response" value={attendance.ownResponse.outcome} /><Field label="Your reason" value={attendance.ownResponse.reason} /></>}{attendance.outcomes && <><Field label="Student response" value={attendance.outcomes.student} /><Field label="Faculty response" value={attendance.outcomes.faculty} /></>}{attendance.finalOutcome && <Field label="Final outcome" value={attendance.finalOutcome} />}</dl> : <p>Historical attendance is not verified through the two-party workflow.</p>}
          {attendance?.waiting && <p>Your response is recorded. Awaiting completion of the attendance workflow.</p>}
          {attendance?.eligible && <p className="mt-2 rounded bg-amber-50 p-3">Faculty attendance submission is pending FAC-11.</p>}
        </section>
        <section><h3 className="mb-2 font-bold">Supporting Documents</h3><SupportingDocumentViewer appointment={a} personalConsultation /></section>
        {children}
      </div>
    </section>
  </div>, document.body);
}
function Field({ label, value }) { return <div><dt className="text-sm font-semibold text-slate-600">{label}</dt><dd className="whitespace-pre-wrap break-words">{value || "Not provided"}</dd></div>; }
function Schedule({ start, end, mode, location, platform }) { return <dl className="mt-2 space-y-2"><Field label="Start (Asia/Manila)" value={consultationTime(start)} /><Field label="End (Asia/Manila)" value={consultationTime(end)} /><Field label="Mode" value={mode} />{mode === "Face-to-Face" && <Field label="Location" value={location} />}{mode === "Online" && <Field label="Platform" value={platform} />}</dl>; }
