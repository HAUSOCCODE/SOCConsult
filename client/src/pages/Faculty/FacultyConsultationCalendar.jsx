import { Link } from "react-router-dom";
import ConsultationCalendar from "../../components/calendar/ConsultationCalendar";

export default function FacultyConsultationCalendar({
  consultationsPath = "/faculty/consultations",
}) {
  return (
    <div className="space-y-4">
      {consultationsPath === "/faculty/consultations" && (
        <Link className="btn-secondary inline-flex" to="/faculty/availability">
          Back to Availability &amp; Calendar
        </Link>
      )}
      <ConsultationCalendar consultationsPath={consultationsPath} />
    </div>
  );
}
