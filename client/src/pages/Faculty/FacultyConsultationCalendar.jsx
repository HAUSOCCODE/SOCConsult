import ConsultationCalendar from "../../components/calendar/ConsultationCalendar";

export default function FacultyConsultationCalendar({
  consultationsPath = "/faculty/appointments",
}) {
  return <ConsultationCalendar consultationsPath={consultationsPath} />;
}
