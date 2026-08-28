import {
  ArrowRight,
  CalendarDays,
  GraduationCap,
  Landmark,
  UserPlus,
  Users,
  UserRound,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/apiClient";
import { Loading, StatusBadge } from "../../components/UI";
import { useAuth } from "../../context/AuthContext";
import { formatPersonName } from "../../utils/formatPersonName";

const appointmentStatuses = [
  ["Pending", "pendingAppointments", "bg-amber-500"],
  ["Approved", "approvedAppointments", "bg-green-600"],
  ["Rescheduled", "rescheduledAppointments", "bg-blue-600"],
  ["Completed", "completedConsultations", "bg-teal-600"],
  ["Cancelled", "cancelledAppointments", "bg-slate-500"],
  ["Rejected", "rejectedAppointments", "bg-red-600"],
];

export default function AdminDashboard() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const load = () =>
      api("/dashboard/admin")
        .then((response) => {
          if (active) {
            setData(response);
            setError("");
          }
        })
        .catch((requestError) => active && setError(requestError.message));
    void load();
    const timer = window.setInterval(load, 30000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  if (error && !data)
    return (
      <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
        Unable to load dashboard. {error}
      </p>
    );
  if (!data) return <Loading />;

  const stats = data.stats || {};
  const displayName = formatPersonName(
    user.name === "ConsultIO Administrator"
      ? "SOCConsult Administrator"
      : user.name,
  );
  const summaries = [
    ["Total Users", stats.totalUsers, Users],
    ["Total Students", stats.totalStudents, GraduationCap],
    ["Total Faculty", stats.totalFaculty, UserRound],
    ["Total Appointments", stats.totalAppointments, CalendarDays],
  ];

  return (
    <div className="w-full min-w-0 space-y-4 pb-20 md:pb-16">
      <section className="relative min-h-[104px] overflow-hidden rounded-xl bg-gradient-to-br from-[#681827] to-[#861d32] px-5 py-4 text-white shadow-sm sm:px-6 sm:py-5">
        <Landmark
          size={128}
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-7 right-5 hidden text-white opacity-[0.055] sm:block"
        />
        <p className="eyebrow !text-gold-300">Welcome back</p>
        <h1 className="relative mt-1.5 max-w-[85%] break-words font-sans text-[clamp(1.25rem,4vw,1.75rem)] font-bold leading-tight tracking-[-0.02em]">
          Hello, {displayName}
        </h1>
        <p className="relative mt-1.5 max-w-2xl text-xs leading-5 text-slate-100 sm:text-sm">
          Here is the latest activity from your SOCConsult workspace.
        </p>
      </section>

      <section
        aria-label="Dashboard totals"
        className="grid grid-cols-2 gap-3 md:grid-cols-4"
      >
        {summaries.map(([label, value, Icon]) => (
          <article
            key={label}
            className="flex min-h-[76px] min-w-0 items-center gap-2.5 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:gap-3"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-maroon-50 text-maroon-800 sm:h-10 sm:w-10">
              <Icon size={19} />
            </span>
            <div className="min-w-0">
              <p className="text-xl font-extrabold leading-6 text-maroon-900 sm:text-2xl">
                {value || 0}
              </p>
              <p className="break-words text-[10px] font-semibold leading-4 text-slate-600 sm:text-xs">
                {label}
              </p>
            </div>
          </article>
        ))}
      </section>

      <section className="grid min-w-0 items-stretch gap-4 md:grid-cols-2">
        <div className="order-2 min-w-0 md:order-1">
          <UserDistribution
          students={stats.totalStudents || 0}
          faculty={stats.totalFaculty || 0}
          totalUsers={stats.totalUsers || 0}
          />
        </div>
        <div className="order-1 min-w-0 md:order-2">
          <AppointmentStatusChart stats={stats} />
        </div>
      </section>

      <section className="grid min-w-0 items-stretch gap-4 md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <PendingRegistrations count={stats.pendingRegistrations || 0} />
        <RecentRegistrations
          registrations={data.recentRegistrations || []}
          total={stats.pendingRegistrations || 0}
        />
      </section>
    </div>
  );
}

function UserDistribution({ students, faculty, totalUsers }) {
  const percentage = (count) =>
    totalUsers > 0 ? (count / totalUsers) * 100 : 0;
  const studentPercent = percentage(students);
  const facultyPercent = percentage(faculty);
  const facultyEnd = Math.min(100, studentPercent + facultyPercent);
  const gradient =
    totalUsers > 0
      ? `conic-gradient(#72182A 0 ${studentPercent}%, #D4A72C ${studentPercent}% ${facultyEnd}%, #e2e8f0 ${facultyEnd}% 100%)`
      : "conic-gradient(#e2e8f0 0 100%)";
  return (
    <article className="flex h-full min-h-[230px] min-w-0 flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <h2 className="text-sm font-bold text-maroon-900 sm:text-base">User Distribution</h2>
      {totalUsers === 0 ? (
        <p className="flex flex-1 items-center justify-center py-8 text-center text-sm text-slate-500">
          No user data yet.
        </p>
      ) : (
        <div className="mt-4 grid flex-1 grid-cols-1 items-center gap-4 min-[480px]:grid-cols-[0.9fr_1.1fr] md:grid-cols-1 min-[1200px]:grid-cols-[0.9fr_1.1fr]">
          <div
            role="img"
            aria-label={`${students} Students, ${faculty} Faculty`}
            title={`Students ${formatPercent(studentPercent)} · Faculty ${formatPercent(facultyPercent)}`}
            className="relative mx-auto h-28 w-28 shrink-0 rounded-full sm:h-32 sm:w-32"
            style={{ background: gradient }}
          >
            <div className="absolute inset-6 grid place-items-center rounded-full bg-white text-center">
              <span>
                <strong className="block text-2xl text-maroon-900">
                  {totalUsers}
                </strong>
                <small className="text-slate-500">Users</small>
              </span>
            </div>
          </div>
          <dl className="mx-auto w-full max-w-xs space-y-2">
            <Legend
              color="bg-maroon-800"
              label="Students"
              count={students}
              percent={studentPercent}
            />
            <Legend
              color="bg-gold-500"
              label="Faculty"
              count={faculty}
              percent={facultyPercent}
            />
          </dl>
        </div>
      )}
    </article>
  );
}

function Legend({ color, label, count, percent }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-lg bg-slate-50 px-3 py-2.5">
      <span className={`h-3 w-3 shrink-0 rounded-full ${color}`} />
      <dt className="min-w-0 flex-1 font-semibold text-slate-700">{label}</dt>
      <dd className="shrink-0 text-right">
        <strong>{count}</strong>
        <span className="mx-1.5 text-slate-400">·</span>
        <span className="text-xs text-slate-500">{formatPercent(percent)}</span>
      </dd>
    </div>
  );
}

function formatPercent(value) {
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
}

function AppointmentStatusChart({ stats }) {
  const values = useMemo(
    () =>
      appointmentStatuses.map(([label, key, color]) => ({
        label,
        color,
        value: Number(stats[key]) || 0,
      })),
    [stats],
  );
  const max = Math.max(...values.map((item) => item.value), 0);
  return (
    <article className="h-full min-h-[230px] min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <h2 className="text-sm font-bold text-maroon-900 sm:text-base">
        Appointment Status Overview
      </h2>
      {max === 0 ? (
        <p className="py-12 text-center text-sm text-slate-500">
          No appointment data yet.
        </p>
      ) : (
        <div
          role="img"
          aria-label={values
            .map((item) => `${item.label}: ${item.value}`)
            .join(", ")}
          className="mt-4 space-y-2.5"
        >
          {values.map((item) => (
            <div
              key={item.label}
              title={`${item.label}: ${item.value} appointment${item.value === 1 ? "" : "s"}`}
              className="grid min-w-0 grid-cols-[4.75rem_minmax(0,1fr)_1.5rem] items-center gap-2 text-xs sm:grid-cols-[5.5rem_minmax(0,1fr)_2rem]"
            >
              <span className="truncate font-semibold text-slate-600">
                {item.label}
              </span>
              <div className="h-3 min-w-0 overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full min-w-[2px] rounded-md transition-all ${item.color}`}
                  style={{ width: `${(item.value / max) * 100}%` }}
                />
              </div>
              <strong className="text-right text-slate-800">
                {item.value}
              </strong>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

function PendingRegistrations({ count }) {
  const subtitle =
    count === 0
      ? "No registrations awaiting approval"
      : count === 1
        ? "New registration awaiting approval"
        : "New registrations awaiting approval";
  return (
    <article className="flex min-h-[96px] min-w-0 items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-gold-50 text-gold-600">
        <UserPlus size={21} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="break-words text-xs font-semibold text-slate-700">Pending Registrations</h2>
        <p className={`mt-0.5 text-xl font-extrabold ${count ? "text-maroon-900" : "text-slate-700"}`}>{count}</p>
        <p className="break-words text-[11px] leading-4 text-slate-500">{subtitle}</p>
      </div>
      <Link to="/admin/registrations" className="btn-secondary hidden shrink-0 sm:inline-flex md:hidden min-[900px]:inline-flex">
        Review Users
      </Link>
      <Link to="/admin/registrations" aria-label="Review pending users" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-maroon-800 hover:bg-maroon-50 sm:hidden md:grid min-[900px]:hidden">
        <ArrowRight size={18} aria-hidden="true" />
      </Link>
    </article>
  );
}

function RecentRegistrations({ registrations, total }) {
  const latest = registrations[0];
  return (
    <article className="flex min-h-[96px] min-w-0 items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-slate-50 text-maroon-700">
        <Users size={20} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="break-words text-xs font-semibold text-slate-700">Recent Registration Requests</h2>
        <div className="mt-0.5 flex min-w-0 items-baseline gap-2">
          <p className="text-xl font-extrabold text-maroon-900">{total}</p>
          <p className="text-[11px] text-slate-500">Total requests</p>
        </div>
        {latest ? (
          <div className="mt-1 min-w-0 text-[11px] leading-4">
            <span className="font-semibold text-slate-700">{formatPersonName(latest.name)}</span>
            <span className="mx-1 text-slate-300" aria-hidden="true">·</span>
            <span className="[overflow-wrap:anywhere] text-slate-500">{latest.email}</span>
          </div>
        ) : (
          <p className="mt-1 text-[11px] text-slate-500">No recent activity · New records will appear here.</p>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2">
        <Link
          to="/admin/registrations"
          className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-bold text-maroon-800 hover:text-maroon-900"
        >
          View all <ArrowRight size={15} aria-hidden="true" />
        </Link>
        {latest && <StatusBadge status={latest.status || "Pending"} compact />}
      </div>
    </article>
  );
}
