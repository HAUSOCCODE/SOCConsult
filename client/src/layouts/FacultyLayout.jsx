import {
  Bell,
  CalendarClock,
  CalendarDays,
  ClipboardList,
  History,
  LayoutDashboard,
  UserRound,
  FileBarChart,
} from "lucide-react";
import { Navigate, useLocation } from "react-router-dom";
import { legacyFacultyDestination } from "../utils/deanWorkspace";
import { useAuth } from "../context/AuthContext";
import RoleLayout from "../components/RoleLayout";
const navigation = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/faculty/dashboard" },
  {
    icon: ClipboardList,
    label: "Consultation Requests",
    path: "/faculty/requests",
  },
  {
    icon: CalendarClock,
    label: "Availability & Calendar",
    path: "/faculty/availability",
    activePaths: ["/faculty/calendar"],
  },
  {
    icon: CalendarDays,
    label: "My Consultations",
    path: "/faculty/consultations",
  },
  { icon: History, label: "Consultation History", path: "/faculty/history" },
  { icon: FileBarChart, label: "Reports", path: "/faculty/reports" },
  { icon: Bell, label: "Notifications", path: "/faculty/notifications" },
  { icon: UserRound, label: "Account Settings", path: "/faculty/account" },
];
export default function FacultyLayout() {
  const { user } = useAuth();
  const location = useLocation();
  if (user?.role === "dean")
    return (
      <Navigate
        to={legacyFacultyDestination(
          location.pathname,
          location.search,
          location.hash,
        )}
        replace
      />
    );
  return (
    <>
      <RoleLayout role="faculty" navigation={navigation} />
    </>
  );
}
