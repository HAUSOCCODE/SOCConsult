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
import SOCConsultAIAssistant from "../components/dean/SOCConsultAIAssistant";
const navigation = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/dean/dashboard" },
  { icon: Users, label: "User Management", path: "/dean/users" },
  {
    icon: BarChart3,
    label: "Consultation Overview",
    path: "/dean/consultations",
  },
  {
    icon: CalendarDays,
    label: "Appointments Management",
    path: "/dean/appointments",
  },
  { icon: FileBarChart, label: "Reports & Analytics", path: "/dean/reports" },
  { icon: Bell, label: "Notifications", path: "/dean/notifications" },
  { icon: History, label: "Audit Logs", path: "/dean/audit-logs" },
  { icon: CalendarDays, label: "My Consultation Workspace", path: "/faculty/dashboard" },
  { icon: Settings, label: "System Settings", path: "/dean/settings" },
];
export default function DeanLayout() {
  return (
    <>
      <RoleLayout role="dean" navigation={navigation} />
      <SOCConsultAIAssistant />
    </>
  );
}
