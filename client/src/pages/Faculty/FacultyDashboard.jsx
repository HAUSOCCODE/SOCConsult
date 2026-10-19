import DashboardOverview from "../../components/dashboard/DashboardOverview";

export default function FacultyDashboard({ routeBase = "/faculty", consultationsPath = `${routeBase}/consultations` }) {
  return (
    <DashboardOverview
      endpoint="/dashboard/faculty"
      recentKey="recentRequests"
      recentTitle="Recent Appointment Requests"
      recentLink={{ to: `${routeBase}/requests`, label: "View all" }}
      statLinks={{
        todayAppointments: consultationsPath,
        pendingRequests: `${routeBase}/requests`,
        weeklyConsultations: consultationsPath,
        completedConsultations: `${routeBase}/history`,
        availableSchedules: `${routeBase}/availability`,
      }}
      statGrid="faculty"
    />
  );
}
