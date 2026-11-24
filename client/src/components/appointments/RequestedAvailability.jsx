import { preferredTimeLabel as clock, requestedDateLabel } from "../../utils/appointmentSchedule";

export default function RequestedAvailability({ appointment, className = "" }) {
  const participant = appointment.initiatedByRole === "faculty" ? "Faculty" : "Student";
  const slots = Array.isArray(appointment.availableTimeSlots) ? appointment.availableTimeSlots : [];
  return <section className={`min-w-0 rounded-xl border border-maroon-100 bg-white p-4 sm:p-5 ${className}`}>
    <h3 className="font-bold text-maroon-900">Requested Schedule and Availability</h3>
    <dl className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2">
      <Field label="Requested Date" value={requestedDateLabel(appointment.requestedConsultationDate)} />
      {appointment.requestedConsultationTime && <Field label="Preferred Time (Asia/Manila)" value={clock(appointment.requestedConsultationTime)} />}
      <Field label="Requesting Participant" value={participant} />
      <Field label="Preferred Consultation Mode" value={appointment.consultationMode || "Not provided"} />
      <div className="min-w-0 sm:col-span-2">
        <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{participant} Available Time (Asia/Manila)</dt>
        <dd className="mt-2">
          {slots.length ? <ol className="space-y-2">{slots.map((slot, index) => <li key={`${slot.startTime}-${slot.endTime}-${index}`} className="flex min-w-0 flex-col gap-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
            <span className="font-semibold text-slate-600">Time Slot {index + 1}</span><span className="break-words font-medium text-slate-900">{clock(slot.startTime)} – {clock(slot.endTime)}</span>
          </li>)}</ol> : appointment.requestedConsultationTime
            ? <p className="text-sm text-slate-800">Legacy preferred time: {clock(appointment.requestedConsultationTime)}</p>
            : <p className="text-sm text-slate-600">Available time was not provided for this request.</p>}
        </dd>
      </div>
    </dl>
    <p className="mt-4 rounded-lg bg-maroon-50 px-3 py-2 text-sm leading-5 text-maroon-900">These times indicate availability preferences and are not a confirmed consultation schedule.</p>
  </section>;
}

function Field({ label, value }) {
  return <div className="min-w-0"><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt><dd className="mt-1 break-words text-sm text-slate-900">{value}</dd></div>;
}
