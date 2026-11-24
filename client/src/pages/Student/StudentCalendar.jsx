import { useCallback, useEffect, useState } from "react";
import ConsultationCalendar from "../../components/calendar/ConsultationCalendar";
import StudentAppointmentDetailsModal from "../../components/appointments/StudentAppointmentDetailsModal";
import DetailLoadingDialog from "../../components/appointments/DetailLoadingDialog";
import { api } from "../../api/apiClient";
import { safeStudentError } from "../../utils/studentUiErrors";

export default function StudentCalendar() {
  const [selectedAppointment, setSelectedAppointment] = useState(null);
  const openDetails = useCallback((event, opener) => setSelectedAppointment({ id: event.appointmentId || event._id || event.id, opener }), []);
  const closeDetails = useCallback(() => setSelectedAppointment(null), []);

  return (
    <>
      <ConsultationCalendar
        apiPath="/calendar/student"
        consultationsPath="/student/consultations"
        title="Consultation Calendar"
        description="View your confirmed and completed consultations on their scheduled dates."
        emptyMessage="No consultations scheduled for this period."
        showUpcoming={false}
        onEventClick={openDetails}
      />
      {selectedAppointment && (
        <StudentCalendarDetails
          key={selectedAppointment.id}
          selection={selectedAppointment}
          onClose={closeDetails}
        />
      )}
    </>
  );
}

function StudentCalendarDetails({ selection, onClose }) {
  const [result, setResult] = useState({ loading: true });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setResult({ loading: true });
    api(`/appointments/student-details/${encodeURIComponent(selection.id)}`, { signal: controller.signal, cache: "no-store" })
      .then(data => {
        if (!data?.appointment || String(data.appointment._id) !== String(selection.id)) throw new Error();
        if (!controller.signal.aborted) setResult({ appointment: data.appointment });
      })
      .catch(error => { if (!controller.signal.aborted) setResult({ error: safeStudentError(error, "Unable to load consultation details. Please try again.") }); });
    return () => controller.abort();
  }, [selection.id, retry]);
  if (result.appointment) return <StudentAppointmentDetailsModal appointment={result.appointment} opener={selection.opener} onClose={onClose} />;
  return <DetailLoadingDialog title="Consultation Details" opener={selection.opener} onClose={onClose}>
    {result.loading ? <p>Loading consultation details...</p> : <><p role="alert">{result.error}</p><button type="button" className="btn-secondary" onClick={() => setRetry(value => value + 1)}>Retry details</button></>}
    <button type="button" className="btn-secondary" onClick={onClose}>Close</button>
  </DetailLoadingDialog>;
}
