import { Link } from "react-router-dom";
import ManageAvailability from "./ManageAvailability";
export default function FacultyAvailabilityCalendar() {
  return (
    <div className="space-y-4">
      <Link className="btn-secondary inline-flex" to="/faculty/calendar">
        Open Consultation Calendar
      </Link>
      <ManageAvailability />
    </div>
  );
}
