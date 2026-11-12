import {
  Bell,
  CalendarClock,
  CalendarDays,
  Clock3,
  LayoutDashboard,
  Search,
  UserRound,
} from "lucide-react";
import RoleLayout from "../components/RoleLayout";
const navigation = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/student/dashboard" },
  { icon: Search, label: "Find Faculty", path: "/student/faculty" },
  { icon: CalendarClock, label: "Availability", path: "/student/availability" },
  { icon: CalendarDays, label: "Calendar", path: "/student/calendar" },
  {
    icon: CalendarDays,
    label: "Consultations / Requests",
    path: "/student/consultations",
  },
  { icon: Clock3, label: "Consultation History", path: "/student/history" },
  { icon: Bell, label: "Notifications", path: "/student/notifications" },
  { icon: UserRound, label: "Account Settings", path: "/student/account" },
];
export default function StudentLayout() {
  return <RoleLayout role="student" navigation={navigation} />;
}
