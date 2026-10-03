import {
  BarChart3,
  Bell,
  CalendarDays,
  FileBarChart,
  History,
  LayoutDashboard,
  Settings,
  Users,
} from "lucide-react";
import RoleLayout from "../components/RoleLayout";
import SOCConsultAIAssistant from "../components/admin/SOCConsultAIAssistant";
const navigation = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/admin/dashboard" },
  { icon: Users, label: "User Management", path: "/admin/users" },
  {
    icon: BarChart3,
    label: "Consultation Overview",
    path: "/admin/consultations",
  },
  {
    icon: CalendarDays,
    label: "Appointments Management",
    path: "/admin/appointments",
  },
  { icon: FileBarChart, label: "Reports & Analytics", path: "/admin/reports" },
  { icon: Bell, label: "Notifications", path: "/admin/notifications" },
  { icon: History, label: "Audit Logs", path: "/admin/audit-logs" },
  { icon: Settings, label: "System Settings", path: "/admin/settings" },
];
export default function AdminLayout() {
  return (
    <>
      <RoleLayout role="admin" navigation={navigation} />
      <SOCConsultAIAssistant />
    </>
  );
}
