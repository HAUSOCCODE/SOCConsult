import {
  BarChart3,
  Bell,
  CalendarClock,
  CalendarDays,
  ClipboardList,
  FileBarChart,
  FileUp,
  History,
  LayoutDashboard,
  Settings,
  Users,
} from "lucide-react";
import { useLocation } from "react-router-dom";
import RoleLayout from "../components/RoleLayout";
import { deanWorkspace } from "../utils/deanWorkspace";
const management = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/dean/dashboard" },
  { icon: FileUp, label: "CSV Import", path: "/dean/import" },
  { icon: Users, label: "User Management", path: "/dean/users" },
  {
    icon: BarChart3,
    label: "Consultation Overview",
    path: "/dean/consultations",
  },
  {
    icon: ClipboardList,
    label: "Attendance Review",
    path: "/dean/attendance-review",
  },
  { icon: FileBarChart, label: "Reports & Analytics", path: "/dean/reports" },
];
const personal = [
  {
    icon: LayoutDashboard,
    label: "Dashboard",
    path: "/dean/faculty/dashboard",
  },
  {
    icon: ClipboardList,
    label: "Appointment Requests",
    path: "/dean/faculty/requests",
  },
  {
    icon: CalendarClock,
    label: "Manage Availability",
    path: "/dean/faculty/availability",
  },
  {
    icon: CalendarDays,
    label: "My Consultations",
    path: "/dean/faculty/consultations",
  },
  {
    icon: History,
    label: "Consultation History",
    path: "/dean/faculty/history",
  },
  {
    icon: FileBarChart,
    label: "My Faculty PDF Reports",
    path: "/dean/faculty/reports",
  },
];
export default function DeanLayout() {
  const { pathname, search } = useLocation();
  const faculty = deanWorkspace(pathname, search) === "faculty";
  const suffix = faculty ? "?workspace=faculty" : "";
  const navigation = [
    ...(faculty ? personal : management),
    {
      icon: Bell,
      label: "Notifications",
      path: "/dean/notifications" + suffix,
    },
    {
      icon: Settings,
      label: "Account Settings",
      path: "/dean/account" + suffix,
    },
  ];
  return (
    <RoleLayout
      role="dean"
      navigation={navigation}
      workspaceLabel={faculty ? "My Faculty Workspace" : "Dean Management"}
      notificationsPath={"/dean/notifications" + suffix}
    />
  );
}
