import { useCallback, useRef, useState } from "react";
import { Link } from "react-router-dom";
import ConsultationCalendar from "../../components/calendar/ConsultationCalendar";
import AvailabilityCalendarDetails from "../../components/calendar/AvailabilityCalendarDetails";
import FacultyConsultationsView from "../../components/appointments/FacultyConsultationsView";

export default function FacultyConsultationCalendar({ consultationsPath = "/faculty/consultations" }) {
  const base = consultationsPath === "/dean/faculty/consultations" ? "/dean/faculty" : "/faculty";
  const root = useRef(null);
  const [selection, setSelection] = useState(null);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  const open = useCallback((event, opener) =>
    setSelection({ id: event.availabilityId || event.appointmentId, kind: event.kind, opener }), []);
  const close = () => {
    const target = selection?.opener;
    setSelection(null);
    queueMicrotask(() => (target?.isConnected ? target : root.current)?.focus());
  };
  return <div ref={root} tabIndex={-1} className="min-w-0 space-y-6">
    <ConsultationCalendar includeAvailability personalCalendar revision={revision} onEventClick={open}
      consultationsPath={consultationsPath} title="Calendar"
      description="View your consultation schedule and upcoming appointments in Asia/Manila."
      emptyMessage="No dated events in this period. Unscheduled requests remain available in Consultations / Requests." />
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
      <p>Availability and consultation events share this calendar without changing their booking status.</p>
      <Link className="font-semibold text-maroon-800 underline" to={base + "/availability"}>Manage Availability</Link>
    </div>
    <FacultyConsultationsView detailOnly selection={selection?.kind === "appointment" ? selection : null}
      onChanged={refresh} onDetailClose={close} />
    {selection?.kind === "availability" && <AvailabilityCalendarDetails selection={selection} onClose={close} />}
  </div>;
}
