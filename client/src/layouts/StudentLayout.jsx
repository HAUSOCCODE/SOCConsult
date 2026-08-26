import {
  Bell,
  CalendarDays,
  Clock3,
  LayoutDashboard,
  LockKeyhole,
  UserRound,
} from "lucide-react";
import RoleLayout from "../components/RoleLayout";
import SOCConsultStudentAIAssistant from "../components/student/SOCConsultStudentAIAssistant";
const navigation = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/student/dashboard" },
  { icon: CalendarDays, label: "Book Consultation", path: "/student/book" },
  {
    icon: CalendarDays,
    label: "My Appointments",
    path: "/student/appointments",
  },
  { icon: Clock3, label: "Consultation History", path: "/student/history" },
  { icon: Bell, label: "Notifications", path: "/student/notifications" },
  { icon: UserRound, label: "Profile", path: "/student/profile" },
  { icon: LockKeyhole, label: "Security Settings", path: "/student/security" },
];
export default function StudentLayout() {
  return <><RoleLayout role="student" navigation={navigation} /><SOCConsultStudentAIAssistant /></>;
}
