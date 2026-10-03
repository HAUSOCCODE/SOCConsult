import { Navigate, Route, Routes } from "react-router-dom";
import ProtectedRoute from "./components/ProtectedRoute";
import LandingPage from "./pages/Public/LandingPage";
import RoleSelectionPage from "./pages/Public/RoleSelectionPage";
import StudentLogin from "./pages/Auth/StudentLogin";
import StudentRegister from "./pages/Auth/StudentRegister";
import FacultyLogin from "./pages/Auth/FacultyLogin";
import FacultyRegister from "./pages/Auth/FacultyRegister";
import AdminLogin from "./pages/Auth/AdminLogin";
import StudentLayout from "./layouts/StudentLayout";
import StudentDashboard from "./pages/Student/StudentDashboard";
import BookConsultation from "./pages/Student/BookConsultation";
import StudentAppointments from "./pages/Student/StudentAppointments";
import StudentHistory from "./pages/Student/StudentConsultationHistory";
import StudentNotifications from "./pages/Student/StudentNotifications";
import StudentProfile from "./pages/Student/StudentProfile";
import StudentSecuritySettings from "./pages/Student/StudentSecuritySettings";
import FacultyLayout from "./layouts/FacultyLayout";
import FacultyDashboard from "./pages/Faculty/FacultyDashboard";
import FacultyAppointments from "./pages/Faculty/FacultyAppointments";
import FacultyConsultationCalendar from "./pages/Faculty/FacultyConsultationCalendar";
import AppointmentRequests from "./pages/Faculty/AppointmentRequests";
import FacultyHistory from "./pages/Faculty/FacultyConsultationHistory";
import ManageAvailability from "./pages/Faculty/ManageAvailability";
import FacultyNotifications from "./pages/Faculty/FacultyNotifications";
import FacultyProfile from "./pages/Faculty/FacultyProfile";
import FacultySecuritySettings from "./pages/Faculty/FacultySecuritySettings";
import AdminLayout from "./layouts/AdminLayout";
import AdminDashboard from "./pages/Admin/AdminDashboard";
import UserManagement from "./pages/Admin/UserManagement";
import ConsultationOverview from "./pages/Admin/ConsultationOverview";
import AppointmentsManagement from "./pages/Admin/AppointmentsManagement";
import ReportsAnalytics from "./pages/Admin/ReportsAnalytics";
import SystemSettings from "./pages/Admin/SystemSettings";
import AdminNotifications from "./pages/Admin/AdminNotifications";
import AuditLogs from "./pages/Admin/AuditLogs";
import NotFoundPage from "./pages/Public/NotFoundPage";
import RouteDocumentTitle from "./components/RouteDocumentTitle";
export default function App() {
  return (
    <>
      <RouteDocumentTitle />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/get-started" element={<RoleSelectionPage />} />
        <Route path="/student/login" element={<StudentLogin />} />
        <Route path="/student/register" element={<StudentRegister />} />
        <Route path="/faculty/login" element={<FacultyLogin />} />
        <Route path="/faculty/register" element={<FacultyRegister />} />
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route
          path="/admin/register"
          element={<Navigate to="/get-started" replace />}
        />
        <Route element={<ProtectedRoute role="student" />}>
          <Route path="student" element={<StudentLayout />}>
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<StudentDashboard />} />
            <Route path="book" element={<BookConsultation />} />
            <Route path="appointments" element={<StudentAppointments />} />
            <Route path="history" element={<StudentHistory />} />
            <Route path="notifications" element={<StudentNotifications />} />
            <Route path="profile" element={<StudentProfile />} />
            <Route path="security" element={<StudentSecuritySettings />} />
            <Route
              path="*"
              element={<NotFoundPage dashboard="/student/dashboard" />}
            />
          </Route>
        </Route>
        <Route element={<ProtectedRoute role="faculty" />}>
          <Route path="faculty" element={<FacultyLayout />}>
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<FacultyDashboard />} />
            <Route path="appointments" element={<FacultyAppointments />} />
            <Route path="calendar" element={<FacultyConsultationCalendar />} />
            <Route path="requests" element={<AppointmentRequests />} />
            <Route path="history" element={<FacultyHistory />} />
            <Route path="availability" element={<ManageAvailability />} />
            <Route path="notifications" element={<FacultyNotifications />} />
            <Route path="profile" element={<FacultyProfile />} />
            <Route path="security" element={<FacultySecuritySettings />} />
            <Route
              path="*"
              element={<NotFoundPage dashboard="/faculty/dashboard" />}
            />
          </Route>
        </Route>
        <Route element={<ProtectedRoute role="admin" />}>
          <Route path="admin" element={<AdminLayout />}>
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<AdminDashboard />} />
            <Route path="users" element={<UserManagement />} />
            <Route
              path="registrations"
              element={<UserManagement initialTab="Pending Registrations" />}
            />
            <Route path="consultations" element={<ConsultationOverview />} />
            <Route path="appointments" element={<AppointmentsManagement />} />
            <Route path="reports" element={<ReportsAnalytics />} />
            <Route path="notifications" element={<AdminNotifications />} />
            <Route path="audit-logs" element={<AuditLogs />} />
            <Route
              path="logs"
              element={<Navigate to="/admin/dashboard" replace />}
            />
            <Route path="settings" element={<SystemSettings />} />
            <Route
              path="*"
              element={<NotFoundPage dashboard="/admin/dashboard" />}
            />
          </Route>
        </Route>
        <Route path="*" element={<NotFoundPage dashboard="/" />} />
      </Routes>
    </>
  );
}
