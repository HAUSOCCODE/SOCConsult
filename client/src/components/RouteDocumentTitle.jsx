import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const titles = {
  "/dean/import": "CSV Import | SOCConsult",
  "/dean/attendance-review": "Attendance Review | SOCConsult",
  "/dean/account": "Account Settings | SOCConsult",
  "/dean/faculty": "My Faculty Dashboard | SOCConsult",
  "/dean/faculty/dashboard": "My Faculty Dashboard | SOCConsult",
  "/dean/faculty/requests": "My Appointment Requests | SOCConsult",
  "/dean/faculty/availability": "My Availability | SOCConsult",
  "/dean/faculty/consultations": "My Consultations | SOCConsult",
  "/dean/faculty/history": "My Consultation History | SOCConsult",
  "/dean/faculty/reports": "My Faculty PDF Reports | SOCConsult",
  "/dean/faculty/calendar": "My Consultation Calendar | SOCConsult",
  "/": "SOCConsult | HAU School of Computing",
  "/get-started": "Get Started | SOCConsult",
  "/student/login": "Student Login | SOCConsult",
  "/student/register": "Student Register | SOCConsult",
  "/student": "Student Dashboard | SOCConsult",
  "/student/dashboard": "Student Dashboard | SOCConsult",
  "/student/book": "Book Consultation | SOCConsult",
  "/student/appointments": "My Appointments | SOCConsult",
  "/student/history": "Consultation History | SOCConsult",
  "/student/notifications": "Notifications | SOCConsult",
  "/student/profile": "Student Profile | SOCConsult",
  "/student/security": "Security Settings | SOCConsult",
  "/faculty/login": "Faculty Login | SOCConsult",
  "/faculty/register": "Faculty Register | SOCConsult",
  "/faculty": "Faculty Dashboard | SOCConsult",
  "/faculty/dashboard": "Faculty Dashboard | SOCConsult",
  "/faculty/appointments": "My Appointments | SOCConsult",
  "/faculty/calendar": "Consultation Calendar | SOCConsult",
  "/faculty/requests": "Appointment Requests | SOCConsult",
  "/faculty/history": "Consultation History | SOCConsult",
  "/faculty/availability": "Manage Availability | SOCConsult",
  "/faculty/notifications": "Notifications | SOCConsult",
  "/faculty/profile": "Faculty Profile | SOCConsult",
  "/faculty/security": "Security Settings | SOCConsult",
  "/dean/login": "Dean Login | SOCConsult",
  "/dean/register": "Get Started | SOCConsult",
  "/dean": "Dean Dashboard | SOCConsult",
  "/dean/dashboard": "Dean Dashboard | SOCConsult",
  "/dean/audit-logs": "Audit Logs | SOCConsult",
  "/dean/users": "User Management | SOCConsult",
  "/dean/registrations": "User Management | SOCConsult",
  "/dean/consultations": "Consultation Overview | SOCConsult",
  "/dean/appointments": "Appointments Management | SOCConsult",
  "/dean/reports": "Reports & Analytics | SOCConsult",
  "/dean/notifications": "Notifications | SOCConsult",
  "/dean/logs": "Dean Dashboard | SOCConsult",
  "/dean/settings": "System Settings | SOCConsult",
};

export default function RouteDocumentTitle() {
  const { pathname } = useLocation();

  useEffect(() => {
    const normalizedPath =
      pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
    document.title = titles[normalizedPath] || "Page Not Found | SOCConsult";
  }, [pathname]);

  return null;
}
