import { useCallback, useState } from "react";
import ConsultationCalendar from "../../components/calendar/ConsultationCalendar";
import StudentAppointmentDetailsModal from "../../components/appointments/StudentAppointmentDetailsModal";

export default function StudentCalendar() {
  const [selectedAppointment, setSelectedAppointment] = useState(null);
  const openDetails = useCallback((event) => setSelectedAppointment(event), []);
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
        <StudentAppointmentDetailsModal
          appointment={selectedAppointment}
          onClose={closeDetails}
        />
      )}
    </>
  );
}
