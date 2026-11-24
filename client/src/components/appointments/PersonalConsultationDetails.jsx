import CalendarDownload from "./CalendarDownload";
import { useRef } from "react";
import { createPortal } from "react-dom";
import useDialogFocus from "../../hooks/useDialogFocus";
import { formatManilaDisplay } from "../../utils/formatDateTime";
import SupportingDocumentViewer from "./SupportingDocumentViewer";
import OnlineMeetingDetails from "./OnlineMeetingDetails";
import { StatusBadge } from "../UI";
import FacultyAttendanceForm from "../attendance/FacultyAttendanceForm";
import ConsultationRecordForm from "../consultations/ConsultationRecordForm";
import OutcomeReportSummary from "../attendance/OutcomeReportSummary";
import RequestedAvailability from "./RequestedAvailability";

export const consultationTime = value => value && Number.isFinite(+new Date(value)) ? formatManilaDisplay(new Date(value), undefined, "timestamp") : "Not scheduled";
export default function PersonalConsultationDetails({ appointment: a, onClose, onAttendanceSubmitted, children, opener }) {
  const ref = useRef(null);
  useDialogFocus(ref, { onClose, restoreTarget: opener });
  const attendance = a.attendance;
  return createPortal(<div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-3" onMouseDown={e => e.target === e.currentTarget && onClose()}>
    <section ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="personal-consultation-title" className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-4 py-4 sm:px-6"><div className="min-w-0"><h2 id="personal-consultation-title" className="text-xl font-bold text-maroon-900">Consultation Details</h2><p className="mt-1 break-words font-semibold text-slate-800">{a.subject || "Consultation"}</p><p className="mt-1 text-xs font-bold uppercase tracking-wide text-maroon-700">Requested by {a.initiatedByRole === "faculty" ? "Faculty" : "Student"}</p><div className="mt-2"><StatusBadge appointment status={a.status} allowWrap /></div></div><button type="button" onClick={onClose} className="btn-secondary shrink-0" aria-label="Close consultation details">Close</button></header>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5 sm:px-6">
        <section className="rounded-xl border border-slate-200 p-4"><h3 className="font-bold text-maroon-900">Participant and Consultation Information</h3><dl className="mt-3 grid gap-3 sm:grid-cols-2"><Field label="Student" value={a.student?.name} /><Field label="Subject / Course" value={a.subject} /><div className="sm:col-span-2"><Field label="Consultation Concern" value={a.reason} /></div></dl></section>
        <RequestedAvailability appointment={a} />
        <section className="rounded-xl border border-slate-200 p-4"><h3 className="font-bold text-maroon-900">{a.confirmedSchedule ? "Confirmed Schedule" : a.startAt ? "Proposed Appointment Schedule" : "Confirmed Schedule"}</h3>{a.startAt && a.endAt ? <Schedule start={a.startAt} end={a.endAt} mode={a.consultationMode} location={a.location} platform={a.meetingPlatform} /> : <p className="mt-2 text-sm text-slate-600">Not scheduled yet</p>}</section>
        {(a.proposedStartAt || a.status === "Reschedule Proposed") && <section className="rounded border p-4"><h3 className="font-bold">Proposed schedule - awaiting Student response; proposed time is not reserved</h3><Schedule start={a.proposedStartAt} end={a.proposedEndAt} mode={a.proposedConsultationMode} location={a.proposedLocation} platform={a.proposedMeetingPlatform} /></section>}
        <OnlineMeetingDetails appointment={a} allowLink={Boolean(a.meetingLink)} />
        <section><h3 className="font-bold">Status history</h3>{!a.statusHistory?.length ? <p>No recorded status history.</p> : <ol className="mt-2 space-y-3">{a.statusHistory.map((event, index) => <li key={index} className="rounded border p-3"><p>{event.previousStatus} ? {event.newStatus}</p><p className="text-sm">{consultationTime(event.changedAt)} - {event.changedByRole}</p>{event.reason && <p className="whitespace-pre-wrap break-words">{event.reason}</p>}</li>)}</ol>}</section>
        <section><h3 className="font-bold">Attendance</h3>{attendance?.enrolled ? <dl className="mt-2 space-y-2"><Field label="Opens" value={consultationTime(attendance.attendanceOpensAt)} /><Field label="Deadline" value={consultationTime(attendance.responseDeadlineAt)} />{attendance.ownResponse && <><Field label="Your response" value={attendance.ownResponse.outcome} /><Field label="Submitted" value={consultationTime(attendance.ownResponse.submittedAt)} />{attendance.ownResponse.reason && <Field label="Your reason" value={attendance.ownResponse.reason} />}</>}{attendance.outcomes && <><Field label="Student response" value={attendance.outcomes.student} /><Field label="Faculty response" value={attendance.outcomes.faculty} /></>}{attendance.finalOutcome && <Field label="Final outcome" value={attendance.finalOutcome} />}</dl> : <p>Historical attendance is not verified through the two-party workflow.</p>}
          {attendance?.waiting && <p>Your response is recorded. Awaiting completion of the attendance workflow.</p>}
          {a.status === "Attendance Review" && <p className="mt-2 rounded border border-amber-200 bg-amber-50 p-3 text-amber-900">This attendance record requires review. Faculty responses cannot resolve the review.</p>}
        </section>
        <OutcomeReportSummary appointmentId={a._id} attendance={attendance} viewerRole="faculty" onChanged={onAttendanceSubmitted} />
        {attendance?.eligible && <FacultyAttendanceForm appointmentId={a._id} onSubmitted={onAttendanceSubmitted} allowProof={attendance.workflow === "initiator_report"} />}
        <ConsultationRecordForm appointmentId={a._id} />
        <section><h3 className="mb-2 font-bold">Supporting Documents</h3><SupportingDocumentViewer appointment={a} personalConsultation /></section>
        <CalendarDownload key={a._id} appointment={a} />
      </div>
      <footer className="flex shrink-0 flex-col gap-2 border-t border-slate-200 bg-white px-4 py-4 sm:flex-row sm:flex-wrap sm:justify-end sm:px-6">{children}<button type="button" onClick={onClose} className="btn-secondary">Close</button></footer>
    </section>
  </div>, document.body);
}
function Field({ label, value }) { return <div><dt className="text-sm font-semibold text-slate-600">{label}</dt><dd className="whitespace-pre-wrap break-words">{value || "Not provided"}</dd></div>; }
function Schedule({ start, end, mode, location, platform }) { return <dl className="mt-2 space-y-2"><Field label="Start (Asia/Manila)" value={consultationTime(start)} /><Field label="End (Asia/Manila)" value={consultationTime(end)} /><Field label="Mode" value={mode} />{mode === "Face-to-Face" && <Field label="Location" value={location} />}{mode === "Online" && <Field label="Platform" value={platform} />}</dl>; }
