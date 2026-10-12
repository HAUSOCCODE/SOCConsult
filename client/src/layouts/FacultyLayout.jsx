import {
  Bell,
  CalendarClock,
  CalendarDays,
  ClipboardList,
  History,
  LayoutDashboard,
  UserRound,
  LockKeyhole,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import RoleLayout from "../components/RoleLayout";
import SOCConsultFacultyAIAssistant from "../components/faculty/SOCConsultFacultyAIAssistant";
const navigation = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/faculty/dashboard" },
  {
    icon: CalendarDays,
    label: "My Appointments",
    path: "/faculty/appointments",
  },
  {
    icon: CalendarDays,
    label: "Consultation Calendar",
    path: "/faculty/calendar",
  },
  {
    icon: ClipboardList,
    label: "Appointment Requests",
    path: "/faculty/requests",
  },
  { icon: History, label: "Consultation History", path: "/faculty/history" },
  {
    icon: CalendarClock,
    label: "Manage Availability",
    path: "/faculty/availability",
  },
  { icon: Bell, label: "Notifications", path: "/faculty/notifications" },
  { icon: UserRound, label: "Profile", path: "/faculty/profile" },
  { icon: LockKeyhole, label: "Security Settings", path: "/faculty/security" },
];
export default function FacultyLayout() {
  const { user } = useAuth();
  const links = user?.role === "dean" ? [...navigation, { icon: LayoutDashboard, label: "Dean Management", path: "/dean/dashboard" }] : navigation;
  return (
    <>
      <RoleLayout role="faculty" navigation={links} />
      <SOCConsultFacultyAIAssistant />
    </>
  );
}
