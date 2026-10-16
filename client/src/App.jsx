import AttendanceReview from "./pages/Dean/AttendanceReview";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import ProtectedRoute from "./components/ProtectedRoute";
import LandingPage from "./pages/Public/LandingPage";
import RoleSelectionPage from "./pages/Public/RoleSelectionPage";
import StudentLogin from "./pages/Auth/StudentLogin";
import FacultyLogin from "./pages/Auth/FacultyLogin";
import FacultyRegister from "./pages/Auth/FacultyRegister";
import DeanLogin from "./pages/Auth/DeanLogin";
import StudentLayout from "./layouts/StudentLayout";
import StudentDashboard from "./pages/Student/StudentDashboard";
import FindFaculty from "./pages/Student/FindFaculty";
import StudentAppointments from "./pages/Student/StudentAppointments";
import StudentHistory from "./pages/Student/StudentConsultationHistory";
import StudentNotifications from "./pages/Student/StudentNotifications";
import StudentAvailability from "./pages/Student/StudentAvailability";
import StudentCalendar from "./pages/Student/StudentCalendar";
import StudentAccountSettings from "./pages/Student/StudentAccountSettings";
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
import DeferredFeaturePage from "./pages/Dean/DeferredFeaturePage";
import CsvImport from "./pages/Dean/CsvImport";
import DeanLayout from "./layouts/DeanLayout";
import DeanDashboard from "./pages/Dean/DeanDashboard";
import UserManagement from "./pages/Dean/UserManagement";
import ConsultationMonitoring from "./pages/Dean/ConsultationMonitoring";
import { monitoringQuery } from "./utils/deanWorkspace";
import ReportsAnalytics from "./pages/Dean/ReportsAnalytics";
import DeanAccountSettings from "./pages/Dean/DeanAccountSettings";
import DeanNotifications from "./pages/Dean/DeanNotifications";
import AuditLogs from "./pages/Dean/AuditLogs";
import NotFoundPage from "./pages/Public/NotFoundPage";
import RouteDocumentTitle from "./components/RouteDocumentTitle";
function DeanRouteRedirect({ to }) {
  const location = useLocation();
  return <Navigate to={to + location.search + location.hash} replace />;
}
function ConsultationMonitoringRedirect() {
  const location = useLocation();
  return <Navigate to={`/dean/consultations${monitoringQuery(location.search)}`} replace />;
}
function LegacyManagementRedirect() {
  const location = useLocation();
  return (
    <Navigate
      to={`${location.pathname.replace(/^\/admin(?=\/|$)/, "/dean")}${location.search}${location.hash}`}
      replace
    />
  );
}
export default function App() {
  return (
    <>
      <RouteDocumentTitle />
      <Routes>
        <Route path="/admin/*" element={<LegacyManagementRedirect />} />
        <Route path="/" element={<LandingPage />} />
        <Route path="/get-started" element={<RoleSelectionPage />} />
        <Route path="/student/login" element={<StudentLogin />} />
        <Route path="/faculty/login" element={<FacultyLogin />} />
        <Route path="/faculty/register" element={<FacultyRegister />} />
        <Route path="/dean/login" element={<DeanLogin />} />
        <Route
          path="/dean/register"
          element={<Navigate to="/get-started" replace />}
        />
        <Route element={<ProtectedRoute role="student" />}>
          <Route path="student" element={<StudentLayout />}>
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<StudentDashboard />} />
            <Route path="faculty" element={<FindFaculty />} />
            <Route path="availability" element={<StudentAvailability />} />
            <Route path="consultations" element={<StudentAppointments />} />
            <Route path="calendar" element={<StudentCalendar />} />
            <Route path="history" element={<StudentHistory />} />
            <Route path="notifications" element={<StudentNotifications />} />
            <Route path="account" element={<StudentAccountSettings />} />
            <Route path="book" element={<Navigate to="/student/faculty" replace />} />
            <Route path="appointments" element={<Navigate to="/student/consultations" replace />} />
            <Route path="profile" element={<Navigate to="/student/account" replace />} />
            <Route path="security" element={<Navigate to="/student/account" replace />} />
            <Route
              path="*"
              element={<NotFoundPage dashboard="/student/dashboard" />}
            />
          </Route>
        </Route>
        <Route element={<ProtectedRoute role={["faculty", "dean"]} />}>
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
        <Route element={<ProtectedRoute role="dean" />}>
          <Route path="dean" element={<DeanLayout />}>
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<DeanDashboard />} />
            <Route path="users" element={<UserManagement />} />
            <Route
              path="registrations"
              element={<DeanRouteRedirect to="/dean/users" />}
            />
            <Route path="consultations" element={<ConsultationMonitoring />} />
            <Route path="appointments" element={<ConsultationMonitoringRedirect />} />
            <Route path="consultation-overview" element={<ConsultationMonitoringRedirect />} />
            <Route path="reports" element={<ReportsAnalytics />} />
            <Route path="notifications" element={<DeanNotifications />} />
            <Route path="audit-logs" element={<AuditLogs />} />
            <Route
              path="logs"
              element={<Navigate to="/dean/dashboard" replace />}
            />
            <Route
              path="settings"
              element={<DeanRouteRedirect to="/dean/account" />}
            />
            <Route path="account" element={<DeanAccountSettings />} />
            <Route path="import" element={<CsvImport />} />
            <Route
              path="attendance-review"
              element={<AttendanceReview />}
            />
            <Route path="attendance-review/:reviewId" element={<AttendanceReview />} />
            <Route path="faculty">
              <Route
                index
                element={<DeanRouteRedirect to="/dean/faculty/dashboard" />}
              />
              <Route
                path="dashboard"
                element={
                  <FacultyDashboard
                    routeBase="/dean/faculty"
                    consultationsPath="/dean/faculty/consultations"
                  />
                }
              />
              <Route path="requests" element={<AppointmentRequests />} />
              <Route path="availability" element={<ManageAvailability />} />
              <Route path="consultations" element={<FacultyAppointments />} />
              <Route path="history" element={<FacultyHistory />} />
              <Route
                path="reports"
                element={
                  <DeferredFeaturePage
                    title="My Faculty PDF Reports"
                    personal
                  />
                }
              />
              <Route
                path="calendar"
                element={
                  <FacultyConsultationCalendar consultationsPath="/dean/faculty/consultations" />
                }
              />
              <Route
                path="appointments"
                element={<DeanRouteRedirect to="/dean/faculty/consultations" />}
              />
              <Route
                path="*"
                element={<NotFoundPage dashboard="/dean/faculty/dashboard" />}
              />
            </Route>
            <Route
              path="*"
              element={<NotFoundPage dashboard="/dean/dashboard" />}
            />
          </Route>
        </Route>
        <Route path="*" element={<NotFoundPage dashboard="/" />} />
      </Routes>
    </>
  );
}
