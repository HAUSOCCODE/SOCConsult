import { useCallback, useRef, useState } from "react";
import { Link } from "react-router-dom";
import ManageAvailability from "./ManageAvailability";
import ConsultationCalendar from "../../components/calendar/ConsultationCalendar";
import FacultyConsultationsView from "../../components/appointments/FacultyConsultationsView";
import AvailabilityCalendarDetails from "../../components/calendar/AvailabilityCalendarDetails";

export default function FacultyAvailabilityCalendar({ routeBase = "/faculty", consultationsPath = "/faculty/consultations" } = {}) {
  const root = useRef(null);
  const [selection, setSelection] = useState(null);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  const open = useCallback((event, opener) => setSelection({ id: event.availabilityId || event.appointmentId, kind: event.kind, opener }), []);
  const close = () => {
    const target = selection?.opener;
    setSelection(null);
    queueMicrotask(() => (target?.isConnected ? target : root.current)?.focus());
  };
  return <div ref={root} tabIndex={-1} className="min-w-0 space-y-6">
    <ConsultationCalendar includeAvailability personalCalendar revision={revision} onEventClick={open} consultationsPath={consultationsPath}
      title="Availability & Calendar" description="Internal calendar in Asia/Manila. Proposals await Student acceptance and do not reserve the proposed time. An .ics file is a separate one-way download; external calendars are not synchronized."
      emptyMessage="No dated events in this period. Unscheduled requests do not appear on the calendar." />
    <p className="text-sm text-slate-600">Unscheduled or malformed records have no calendar date. <Link className="font-semibold underline" to={routeBase + "/requests"}>Review Requests</Link> or <Link className="font-semibold underline" to={consultationsPath}>My Consultations</Link>.</p>
    <ManageAvailability routeBase={routeBase} consultationsPath={consultationsPath} showCalendarLink={false} onChanged={refresh} revision={revision} />
    <FacultyConsultationsView detailOnly selection={selection?.kind === "appointment" ? selection : null} onChanged={refresh} onDetailClose={close} />
    {selection?.kind === "availability" && <AvailabilityCalendarDetails selection={selection} onClose={close} />}
  </div>;
}
