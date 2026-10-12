import {
  Bell,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import Brand from "./Brand";
import { useAuth } from "../context/AuthContext";
import { api } from "../api/apiClient";
import PageErrorBoundary from "./PageErrorBoundary";
import ProfileImagePreview from "./profile/ProfileImagePreview";
import { formatPersonName } from "../utils/formatPersonName";

const SIDEBAR_PREFERENCE_KEY = "socconsult-sidebar-collapsed";

function SidebarTooltip({ label, enabled, children, className = "" }) {
  const [position, setPosition] = useState(null);
  const show = (event) => {
    if (!enabled || !window.matchMedia("(min-width: 1024px)").matches) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setPosition({ left: rect.right + 12, top: rect.top + rect.height / 2 });
  };
  const hide = () => setPosition(null);

  return (
    <>
      <div
        className={className}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocusCapture={show}
        onBlurCapture={hide}
      >
        {children}
      </div>
      {position &&
        createPortal(
          <div
            role="tooltip"
            className="pointer-events-none fixed z-[100] -translate-y-1/2 whitespace-nowrap rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white shadow-xl"
            style={{ left: position.left, top: position.top }}
          >
            {label}
          </div>,
          document.body,
        )}
    </>
  );
}

export default function RoleLayout({ role, navigation }) {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_PREFERENCE_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [unread, setUnread] = useState(0);
  const location = useLocation();
  const compactStudentHeader =
    role === "student" &&
    ["/student/profile", "/student/notifications", "/student/history"].includes(
      location.pathname,
    );
  const navigate = useNavigate();
  const currentPage =
    navigation.find(({ path }) => location.pathname === path)?.label ||
    "Dashboard";
  const displayName =
    user.role === "dean" && ["ConsultIO Administrator", "SOCConsult Administrator", "ConsultIO Dean"].includes(user.name)
      ? "SOCConsult Dean"
      : formatPersonName(user);
  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_PREFERENCE_KEY, String(sidebarCollapsed));
    } catch {
      // The sidebar remains usable when storage is unavailable.
    }
  }, [sidebarCollapsed]);
  useEffect(() => {
    const previous = document.body.style.overflow;
    if (open) document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);
  useEffect(() => {
    const load = () =>
      api("/notifications")
        .then((data) => setUnread(data.unreadCount))
        .catch(() => {});
    const handleNotificationsUpdated = (event) => {
      const nextUnreadCount = Number(event.detail?.unreadCount);
      if (Number.isFinite(nextUnreadCount)) setUnread(nextUnreadCount);
      else load();
    };
    load();
    window.addEventListener(
      "notifications:updated",
      handleNotificationsUpdated,
    );
    window.addEventListener("focus", load);
    const timer = setInterval(load, 15000);
    return () => {
      clearInterval(timer);
      window.removeEventListener(
        "notifications:updated",
        handleNotificationsUpdated,
      );
      window.removeEventListener("focus", load);
    };
  }, []);
  const signOut = async () => {
    await logout();
    navigate("/", { replace: true });
  };
  return (
    <div className="flex min-h-screen w-full min-w-0 max-w-full bg-slate-50">
      <button
        aria-label="Close navigation"
        onClick={() => setOpen(false)}
        className={`fixed inset-0 z-40 bg-slate-950/70 transition-opacity duration-200 lg:hidden ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
      />
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[min(18rem,calc(100vw-2rem))] max-w-full flex-col overflow-hidden bg-[#6E1423] text-white shadow-2xl transition-[width,transform] duration-200 lg:translate-x-0 ${sidebarCollapsed ? "lg:w-20" : "lg:w-72"} ${open ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div
          className={`relative flex h-20 shrink-0 items-center justify-between border-b border-[#8A2436] px-6 ${sidebarCollapsed ? "lg:justify-center lg:px-2" : ""}`}
        >
          <div className={sidebarCollapsed ? "lg:hidden" : ""}>
            <Brand light />
          </div>
          <button
            className="lg:hidden"
            onClick={() => setOpen(false)}
            aria-label="Close navigation"
          >
            <X />
          </button>
          <SidebarTooltip
            label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            enabled
            className={`absolute top-1/2 hidden -translate-y-1/2 lg:block ${sidebarCollapsed ? "left-1/2 -translate-x-1/2" : "right-3"}`}
          >
            <button
              type="button"
              onClick={() => setSidebarCollapsed((value) => !value)}
              aria-label={
                sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"
              }
              className="grid h-9 w-9 place-items-center rounded-lg border border-white/20 bg-transparent text-white transition-colors duration-150 hover:border-white/30 hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#6E1423]"
            >
              {sidebarCollapsed ? (
                <PanelLeftOpen size={18} />
              ) : (
                <PanelLeftClose size={18} />
              )}
            </button>
          </SidebarTooltip>
        </div>
        <SidebarTooltip
          label={`${formatPersonName(displayName)} — ${role === "dean" ? "Dean" : `${role[0].toUpperCase()}${role.slice(1)}`} Portal`}
          enabled={sidebarCollapsed}
        >
          <div
            className={`border-b border-[#8A2436] px-5 py-5 ${sidebarCollapsed ? "lg:px-2" : ""}`}
          >
            <div
              className={`flex items-center gap-3 ${sidebarCollapsed ? "lg:justify-center" : ""}`}
            >
              <ProfileImagePreview
                user={user}
                className="h-11 w-11 shrink-0 rounded-xl bg-gold-400 font-extrabold text-maroon-900 shadow-md"
              />
              <div
                className={`min-w-0 flex-1 ${sidebarCollapsed ? "lg:hidden" : ""}`}
              >
                <p className="whitespace-normal break-normal text-sm font-semibold leading-5">
                  {formatPersonName(displayName)}
                </p>
                <p className="mt-0.5 text-sm font-medium text-white">
                  {role === "dean"
                    ? "Dean Portal"
                    : `${role[0].toUpperCase()}${role.slice(1)} Portal`}
                </p>
              </div>
            </div>
          </div>
        </SidebarTooltip>
        <nav className="scrollbar-hide min-h-0 flex-1 space-y-1 overflow-y-auto p-4">
          {navigation.map(({ icon: Icon, label, path }) => (
            <SidebarTooltip key={path} label={label} enabled={sidebarCollapsed}>
              <NavLink
                to={path}
                aria-label={label}
                className={({ isActive }) =>
                  `relative flex min-h-12 items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-gold-400 ${sidebarCollapsed ? "lg:justify-center lg:px-0" : ""} ${isActive ? "bg-[#FFF9F7] text-[#6E1423] shadow-sm" : "text-white hover:bg-[#8A2436]"}`
                }
              >
                <Icon size={19} className="shrink-0" />
                <span className={sidebarCollapsed ? "lg:hidden" : ""}>
                  {label}
                </span>
                {label === "Notifications" && unread > 0 && (
                  <span
                    className={`ml-auto rounded-full bg-gold-400 px-2 py-0.5 text-xs font-bold text-maroon-900 ${sidebarCollapsed ? "lg:absolute lg:right-1 lg:top-1 lg:h-2 lg:w-2 lg:p-0 lg:text-transparent" : ""}`}
                  >
                    {unread}
                  </span>
                )}
              </NavLink>
            </SidebarTooltip>
          ))}
        </nav>
        <div className="mt-auto border-t border-[#8A2436] p-4">
          <SidebarTooltip label="Logout" enabled={sidebarCollapsed}>
            <button
              onClick={signOut}
              aria-label="Logout"
              className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold text-white transition-colors duration-200 hover:bg-[#8A2436] focus-visible:ring-2 focus-visible:ring-gold-400 ${sidebarCollapsed ? "lg:justify-center lg:px-0" : ""}`}
            >
              <LogOut size={19} />
              <span className={sidebarCollapsed ? "lg:hidden" : ""}>
                Logout
              </span>
            </button>
          </SidebarTooltip>
        </div>
      </aside>
      <div
        className={`box-border w-full min-w-0 max-w-full flex-1 transition-[padding] duration-200 ${sidebarCollapsed ? "lg:pl-20" : "lg:pl-72"}`}
      >
        <header
          className={`sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white shadow-sm md:min-h-20 md:px-6 md:py-3 xl:px-7 ${compactStudentHeader ? "min-h-16 px-4 py-2" : "min-h-20 px-3 py-3 min-[360px]:px-4 sm:px-5"}`}
        >
          <button
            onClick={() => setOpen(true)}
            aria-label="Open navigation"
            className={`grid shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-maroon-800 shadow-sm lg:hidden ${compactStudentHeader ? "h-10 w-10" : "h-11 w-11"}`}
          >
            <Menu />
          </button>
          <div className="min-w-0 flex-1">
            <p className={`truncate text-sm font-extrabold tracking-tight text-maroon-900 ${compactStudentHeader ? "md:hidden" : "sm:hidden"}`}>
              SOCConsult
            </p>
            <p className="text-[0.65rem] font-extrabold uppercase tracking-[0.14em] text-gold-600 sm:text-xs sm:tracking-[0.18em]">
              {role} workspace
            </p>
            <h1
              className={`mt-0.5 whitespace-normal text-sm font-bold leading-5 text-slate-900 sm:text-base ${compactStudentHeader ? "hidden md:block" : ""}`}
            >
              {currentPage}
            </h1>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
            <NavLink
              to={`/${role}/notifications`}
              className={`relative grid place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-maroon-200 hover:bg-maroon-50 hover:text-maroon-800 ${compactStudentHeader ? "h-10 w-10 md:h-11 md:w-11" : "h-11 w-11"}`}
            >
              <Bell size={19} />
              {unread > 0 && (
                <span className="absolute right-0 top-0 h-2.5 w-2.5 rounded-full border-2 border-white bg-red-500" />
              )}
            </NavLink>
            <ProfileImagePreview
              user={user}
              className={`${compactStudentHeader ? "h-10 w-10 md:h-11 md:w-11" : "h-11 w-11"} rounded-xl bg-maroon-800 font-bold text-white shadow-md ring-2 ring-maroon-100`}
            />
          </div>
        </header>
        <main className={`box-border mx-auto w-full min-w-0 max-w-[1600px] ${compactStudentHeader ? "p-4 md:p-6 xl:p-8" : "p-3 min-[360px]:p-4 sm:p-5 md:p-6 xl:p-8"}`}>
          <div className="w-full min-w-0 max-w-full">
            <PageErrorBoundary key={location.pathname}>
              <Outlet />
            </PageErrorBoundary>
          </div>
        </main>
      </div>
    </div>
  );
}
