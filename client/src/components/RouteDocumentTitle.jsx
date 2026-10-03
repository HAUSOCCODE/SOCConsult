import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const titles = {
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
  "/admin/login": "Admin Login | SOCConsult",
  "/admin/register": "Get Started | SOCConsult",
  "/admin": "Admin Dashboard | SOCConsult",
  "/admin/dashboard": "Admin Dashboard | SOCConsult",
  "/admin/audit-logs": "Audit Logs | SOCConsult",
  "/admin/users": "User Management | SOCConsult",
  "/admin/registrations": "User Management | SOCConsult",
  "/admin/consultations": "Consultation Overview | SOCConsult",
  "/admin/appointments": "Appointments Management | SOCConsult",
  "/admin/reports": "Reports & Analytics | SOCConsult",
  "/admin/notifications": "Notifications | SOCConsult",
  "/admin/logs": "Admin Dashboard | SOCConsult",
  "/admin/settings": "System Settings | SOCConsult",
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
