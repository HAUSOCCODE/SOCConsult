import { Navigate, useLocation } from "react-router-dom";
import { calendarAliasSuffix } from "../../utils/deanWorkspace";

export default function FacultyConsultationCalendar({ consultationsPath = "/faculty/consultations" }) {
  const location = useLocation();
  const base = consultationsPath === "/dean/faculty/consultations" ? "/dean/faculty" : "/faculty";
  return <Navigate replace to={base + "/availability" + calendarAliasSuffix(location.search, location.hash)} />;
}
