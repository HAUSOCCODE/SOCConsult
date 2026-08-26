import {
  Bell,
  CalendarCheck2,
  CalendarDays,
  CalendarPlus2,
  CheckCircle2,
  ChevronRight,
  Clock3,
  History,
  LockKeyhole,
  UserRound,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/apiClient";
import { useAuth } from "../../context/AuthContext";
import { getAppointmentDisplayStatus } from "../../utils/appointmentStatus";
import { formatPersonName } from "../../utils/formatPersonName";
import Pagination from "../Pagination";
import { Loading, StatusBadge } from "../UI";

const PAGE_SIZE = 3;
const MANILA_MONTH = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Manila",
  month: "short",
});
const MANILA_DAY = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Manila",
  day: "numeric",
});
const MANILA_YEAR = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Manila",
  year: "numeric",
});
const MANILA_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Manila",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const STAT_CARDS = [
  {
    key: "upcomingAppointments",
    label: "Upcoming Appointments",
    helper: "Scheduled consultations ahead",
    icon: CalendarCheck2,
    to: "/student/appointments",
  },
  {
    key: "pendingAppointments",
    label: "Pending Appointments",
    helper: "Awaiting Faculty review",
    icon: Clock3,
    to: "/student/appointments",
  },
  {
    key: "completedConsultations",
    label: "Completed Consultations",
    helper: "Consultations completed",
    icon: CheckCircle2,
    to: "/student/history",
  },
  {
    key: "unreadNotifications",
    label: "Unread Notifications",
    helper: "Stay updated",
    icon: Bell,
    to: "/student/notifications",
  },
];

const QUICK_ACTIONS = [
  [CalendarPlus2, "Book a Consultation", "/student/book"],
  [CalendarDays, "View My Appointments", "/student/appointments"],
  [History, "Consultation History", "/student/history"],
  [UserRound, "Update Profile", "/student/profile"],
];

const RESOURCES = [
  [Bell, "Notifications Center", "/student/notifications"],
  [LockKeyhole, "Security Settings", "/student/security"],
];

const WEEK_ITEMS = [
  ["Completed", "#15803d"],
  ["Pending", "#d97706"],
  ["Cancelled", "#64748b"],
  ["No Show", "#be123c"],
];

const formatTimeRange = (appointment) =>
  `${MANILA_TIME.format(new Date(appointment.startAt))} – ${MANILA_TIME.format(new Date(appointment.endAt))}`;

export default function StudentDashboardContent() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    let active = true;
    const load = () =>
      api("/dashboard/student")
        .then((response) => {
          if (!active) return;
          setData(response);
          setError("");
        })
        .catch((requestError) => active && setError(requestError.message));
    load();
    const timer = window.setInterval(load, 30000);
    window.addEventListener("notifications:updated", load);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("notifications:updated", load);
    };
  }, []);

  const appointments = Array.isArray(data?.recentAppointments)
    ? data.recentAppointments
    : [];
  const totalPages = Math.max(1, Math.ceil(appointments.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const shownAppointments = appointments.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const week = data?.weeklyOverview || {};
  const weekTotal = WEEK_ITEMS.reduce(
    (total, [status]) => total + Number(week[status] || 0),
    0,
  );

  if (error)
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
        Unable to load dashboard. {error}
      </div>
    );
  if (!data) return <Loading />;

  const formattedName = formatPersonName(user?.name) || "Student";
  const firstName = formattedName.split(/\s+/)[0];

  return (
    <div className="w-full min-w-0 max-w-full space-y-5 sm:space-y-6 md:pb-12">
      <section className="relative w-full min-w-0 overflow-hidden rounded-2xl border border-maroon-700 bg-maroon-800 p-5 text-white shadow-sm sm:p-6 lg:p-7">
        <div className="pointer-events-none absolute -right-10 -top-12 h-44 w-44 rounded-full border border-gold-400/20" />
        <div className="pointer-events-none absolute -bottom-20 right-20 h-40 w-40 rounded-full border border-gold-400/10" />
        <div className="relative grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(240px,.65fr)] lg:items-center lg:gap-6">
          <div className="min-w-0">
            <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-gold-300">
              Welcome back
            </p>
            <h1 className="mt-2 break-words text-2xl font-bold tracking-tight sm:text-3xl">
              Hello, {firstName}!
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-maroon-50">
              We&apos;re here to support your academic journey.
            </p>
            <Link
              to="/student/book"
              className="mt-5 inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-gold-400 px-4 text-sm font-bold text-maroon-950 transition-colors hover:bg-gold-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-200 focus-visible:ring-offset-2 focus-visible:ring-offset-maroon-800"
            >
              <CalendarPlus2 size={17} aria-hidden="true" />
              Book a Consultation
            </Link>
          </div>
          <div className="flex min-w-0 items-center gap-4 border-t border-gold-300/25 pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-gold-300/40 bg-maroon-900 text-gold-300">
              <CalendarCheck2 size={23} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="font-bold text-white">Need Assistance?</h2>
              <p className="mt-1 text-sm leading-5 text-maroon-50">
                Book a consultation with a Faculty Member and get the guidance
                you need.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section
        aria-label="Student dashboard statistics"
        className="grid min-w-0 grid-cols-1 gap-3 min-[380px]:grid-cols-2 xl:grid-cols-4"
      >
        {STAT_CARDS.map(({ key, label, helper, icon: Icon, to }) => (
          <Link
            key={key}
            to={to}
            className="group flex min-w-0 items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-maroon-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-maroon-300"
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-maroon-50 text-maroon-800 group-hover:bg-maroon-100">
              <Icon size={18} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <strong className="block text-2xl font-extrabold leading-none text-maroon-900">
                {Number(data.stats?.[key] || 0)}
              </strong>
              <p className="mt-1.5 break-words text-sm font-bold leading-5 text-slate-800">
                {label}
              </p>
              <p className="mt-1 text-xs leading-4 text-slate-500">{helper}</p>
            </div>
          </Link>
        ))}
      </section>

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)] xl:items-stretch">
        <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm xl:flex xl:h-full xl:flex-col">
          <header className="flex min-w-0 items-center justify-between gap-3 border-b border-slate-200 px-4 py-4 sm:px-5">
            <h2 className="min-w-0 text-lg font-bold text-slate-900">
              Upcoming &amp; Recent Appointments
            </h2>
            <Link
              to="/student/appointments"
              className="shrink-0 text-sm font-bold text-maroon-800 hover:text-maroon-950 focus-visible:outline-none focus-visible:underline"
            >
              View all
            </Link>
          </header>
          {appointments.length === 0 ? (
            <div className="grid place-items-center px-4 py-10 text-center sm:px-5 sm:py-12 xl:flex-1">
              <div>
                <span className="mx-auto mb-4 block h-12 w-12 rounded-2xl bg-maroon-100 ring-4 ring-maroon-50" />
                <p className="font-bold text-slate-700">
                  No recent appointments found.
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  Your recent consultation activity will appear here.
                </p>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-slate-200 xl:flex-1">
              {shownAppointments.map((appointment) => (
                <DashboardAppointment
                  key={appointment._id}
                  appointment={appointment}
                />
              ))}
            </div>
          )}
          {appointments.length > 0 && (
            <div className="md:[&>div]:pr-20">
              <Pagination
                currentPage={safePage}
                totalItems={appointments.length}
                itemsPerPage={PAGE_SIZE}
                itemLabel="records"
                onPageChange={setPage}
              />
            </div>
          )}
        </section>

        <aside className="min-w-0 xl:h-full">
          <WeeklyOverview week={week} total={weekTotal} />
        </aside>

        <div className="grid min-w-0 gap-5 md:grid-cols-2 xl:col-span-2 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)] xl:items-stretch">
          <LinkListCard title="Quick Actions" items={QUICK_ACTIONS} />
          <LinkListCard
            title="Resources"
            items={RESOURCES}
            description="Manage your account updates and security using existing SOCConsult tools."
          />
        </div>
      </div>
    </div>
  );
}

function DashboardAppointment({ appointment }) {
  const start = new Date(appointment.startAt);
  const historicalStatuses = ["Completed", "Rejected", "Cancelled", "No Show"];
  const destination =
    historicalStatuses.includes(appointment.status) ||
    new Date(appointment.endAt) <= new Date()
      ? "/student/history"
      : "/student/appointments";
  const duration = appointment.estimatedDurationMinutes
    ? `${appointment.estimatedDurationMinutes} min`
    : "Duration not provided";
  return (
    <Link
      to={destination}
      className="group grid min-w-0 grid-cols-[3.25rem_minmax(0,1fr)] items-center gap-3 px-4 py-3.5 transition-colors hover:bg-maroon-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-maroon-300 sm:grid-cols-[3.5rem_minmax(0,1fr)_10.5rem_1.25rem] sm:px-5"
      aria-label={`View ${appointment.subject || "consultation"} in My Appointments`}
    >
      <span className="grid h-14 w-full shrink-0 content-center rounded-lg border border-maroon-100 bg-maroon-50 text-center">
        <span className="text-[10px] font-extrabold uppercase tracking-wide text-maroon-700">
          {MANILA_MONTH.format(start)}
        </span>
        <span className="text-xl font-extrabold leading-5 text-maroon-900">
          {MANILA_DAY.format(start)}
        </span>
        <span className="text-[9px] font-semibold text-slate-500">
          {MANILA_YEAR.format(start)}
        </span>
      </span>
      <div className="min-w-0">
        <div className="flex min-w-0 flex-col items-start gap-1.5 sm:block">
          <h3 className="min-w-0 break-words text-sm font-bold text-slate-900 sm:text-base">
            {appointment.subject || "Consultation"}
          </h3>
          <span className="sm:hidden">
            <StatusBadge
              compact
              status={getAppointmentDisplayStatus(appointment)}
            />
          </span>
        </div>
        <p className="mt-1 break-words text-sm text-slate-600">
          {formatPersonName(appointment.faculty?.name) ||
            "Faculty Member not provided"}
        </p>
        <p className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs leading-4 text-slate-500">
          <span>{formatTimeRange(appointment)}</span>
          <span aria-hidden="true">•</span>
          <span>{appointment.consultationMode || "Mode not provided"}</span>
          <span aria-hidden="true">•</span>
          <span>{duration}</span>
        </p>
      </div>
      <div className="hidden min-w-0 items-center justify-center sm:flex">
        <StatusBadge
          compact
          status={getAppointmentDisplayStatus(appointment)}
        />
      </div>
      <ChevronRight
        size={18}
        className="hidden shrink-0 justify-self-end text-slate-400 transition-colors group-hover:text-maroon-700 sm:block"
        aria-hidden="true"
      />
    </Link>
  );
}

function WeeklyOverview({ week, total }) {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  let accumulatedPercentage = 0;

  return (
    <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 xl:flex xl:h-full xl:flex-col">
      <h2 className="text-lg font-bold text-slate-900">This Week Overview</h2>
      <div className="mt-3 flex min-w-0 flex-col gap-4 xl:flex-1 xl:justify-center">
        <div className="flex justify-center">
          <div
            className="relative h-24 w-24 shrink-0 sm:h-28 sm:w-28"
            role="img"
            aria-label={`${total} total ${total === 1 ? "consultation" : "consultations"} this week`}
          >
            <svg
              viewBox="0 0 112 112"
              className="h-full w-full"
              aria-hidden="true"
            >
              <circle
                cx="56"
                cy="56"
                r={radius}
                fill="none"
                stroke="#e2e8f0"
                strokeWidth="11"
              />
              {total > 0 &&
                WEEK_ITEMS.map(([status, color]) => {
                  const count = Number(week[status] || 0);
                  const percentage = Math.max(0, count / total);
                  const dashLength = percentage * circumference;
                  const dashOffset = -accumulatedPercentage * circumference;
                  accumulatedPercentage += percentage;
                  if (count <= 0) return null;
                  return (
                    <circle
                      key={status}
                      cx="56"
                      cy="56"
                      r={radius}
                      fill="none"
                      stroke={color}
                      strokeWidth="11"
                      strokeLinecap="butt"
                      strokeDasharray={`${dashLength} ${circumference}`}
                      strokeDashoffset={dashOffset}
                      transform="rotate(-90 56 56)"
                    />
                  );
                })}
            </svg>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <strong className="text-2xl font-extrabold leading-none text-maroon-900 sm:text-[28px]">
                {total}
              </strong>
              <span className="mt-1 text-[9px] font-extrabold uppercase tracking-[0.14em] text-slate-500">
                Total
              </span>
            </div>
          </div>
        </div>

        <dl className="w-full min-w-0 space-y-3">
          {WEEK_ITEMS.map(([status, color]) => {
            const count = Number(week[status] || 0);
            const percentage =
              total > 0
                ? Math.min(100, Math.max(0, Math.round((count / total) * 100)))
                : 0;
            return (
              <div key={status} className="min-w-0">
                <div className="flex min-w-0 items-center gap-2 text-sm">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: color }}
                    aria-hidden="true"
                  />
                  <dt className="min-w-0 flex-1 text-slate-600">{status}</dt>
                  <dd className="shrink-0 font-bold text-slate-900">{count}</dd>
                </div>
                <div
                  role="progressbar"
                  aria-label={`${status}: ${count} of ${total} ${total === 1 ? "consultation" : "consultations"}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={percentage}
                  className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100"
                >
                  <span
                    className="block h-full rounded-full transition-[width] duration-300"
                    style={{ width: `${percentage}%`, backgroundColor: color }}
                  />
                </div>
              </div>
            );
          })}
        </dl>
        {total === 0 && (
          <p className="text-center text-xs text-slate-500">
            No consultation activity this week.
          </p>
        )}
      </div>
    </section>
  );
}

function LinkListCard({ title, items, description }) {
  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm md:flex md:h-full md:flex-col">
      <div className="px-4 pt-4 sm:px-5 sm:pt-5">
        <h2 className="text-lg font-bold text-slate-900">{title}</h2>
        {description && (
          <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
        )}
      </div>
      <nav
        className="mt-3 divide-y divide-slate-200 md:flex md:flex-1 md:flex-col"
        aria-label={title}
      >
        {items.map(([Icon, label, to]) => (
          <Link
            key={to}
            to={to}
            className="group flex min-w-0 items-center gap-3 px-4 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-maroon-50 hover:text-maroon-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-maroon-300 sm:px-5 md:flex-1"
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-maroon-50 text-maroon-700">
              <Icon size={16} aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1 break-words">{label}</span>
            <ChevronRight
              size={16}
              className="shrink-0 text-slate-400 group-hover:text-maroon-700"
              aria-hidden="true"
            />
          </Link>
        ))}
      </nav>
    </section>
  );
}
