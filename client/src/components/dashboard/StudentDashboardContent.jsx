import AttendanceSummary from "../appointments/AttendanceSummary";
import {
  Bell,
  CalendarCheck2,
  ChevronRight,
  Clock3,
  ClipboardCheck,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/apiClient";
import { useAuth } from "../../context/AuthContext";
import { formatPersonName } from "../../utils/formatPersonName";
import { EmptyState, ErrorState, Loading } from "../UI";

const MANILA_DATE = new Intl.DateTimeFormat("en-PH", {
  timeZone: "Asia/Manila",
  dateStyle: "medium",
});
const MANILA_TIME = new Intl.DateTimeFormat("en-PH", {
  timeZone: "Asia/Manila",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});
const MANILA_DATE_TIME = new Intl.DateTimeFormat("en-PH", {
  timeZone: "Asia/Manila",
  dateStyle: "medium",
  timeStyle: "short",
});

const STAT_CARDS = [
  {
    key: "upcomingCount",
    label: "Upcoming Confirmed Consultations",
    helper: "Confirmed consultations ahead",
    icon: CalendarCheck2,
    to: "/student/consultations",
  },
  {
    key: "pendingCount",
    label: "Pending Requests",
    helper: "Waiting for Faculty response",
    icon: Clock3,
    to: "/student/consultations",
  },
  {
    key: "attendanceRequiredCount",
    label: "Attendance Updates Required",
    helper: "Attendance responses you owe",
    icon: ClipboardCheck,
    to: "/student/consultations",
  },
  {
    key: "unreadNotificationCount",
    label: "Unread Notifications",
    helper: "Updates you have not read",
    icon: Bell,
    to: "/student/notifications",
  },
];

const validDate = (value) => {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
};

export default function StudentDashboardContent() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const load = useCallback(() => {
    let active = true;
    api("/dashboard/student")
      .then((response) => {
        if (!active) return;
        setData(response);
        setError("");
      })
      .catch(() => {
        if (!active) return;
        setData(null);
        setError("Unable to load your dashboard right now.");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => load(), [load, retry]);
  useEffect(() => {
    const refresh = () => {
      api("/dashboard/student")
        .then((response) => {
          setData(response);
          setError("");
        })
        .catch(() => {});
    };
    window.addEventListener("notifications:updated", refresh);
    return () => window.removeEventListener("notifications:updated", refresh);
  }, []);

  if (error)
    return (
      <ErrorState
        message={error}
        onRetry={() => setRetry((value) => value + 1)}
      />
    );
  if (!data) return <Loading />;

  const consultations = Array.isArray(data.recentConsultations)
    ? data.recentConsultations
    : [];
  const notifications = Array.isArray(data.recentNotifications)
    ? data.recentNotifications
    : [];
  const displayName = formatPersonName(user) || "Student";
  const firstName = user?.firstName || displayName.split(/\s+/)[0];

  return (
    <div className="w-full min-w-0 space-y-5 pb-8 sm:space-y-6">
      <AttendanceSummary counts={data.attendanceSummary} />
      <section className="overflow-hidden rounded-2xl border border-maroon-700 bg-maroon-800 p-5 text-white shadow-sm sm:p-6">
        <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-gold-300">
          Student dashboard
        </p>
        <h1 className="mt-2 break-words text-2xl font-bold sm:text-3xl">
          Welcome back, {firstName}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-maroon-50">
          Review your consultation requests, upcoming schedule, and recent
          updates.
        </p>
      </section>

      <section
        aria-label="Student consultation summary"
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
                {Number(data[key] || 0)}
              </strong>
              <p className="mt-1.5 break-words text-sm font-bold leading-5 text-slate-800">
                {label}
              </p>
              <p className="mt-1 text-xs leading-4 text-slate-500">{helper}</p>
            </div>
          </Link>
        ))}
      </section>

      <NextConsultation consultation={data.nextConsultation} />
      <div className="grid min-w-0 gap-5 lg:grid-cols-2">
        <RecentConsultations consultations={consultations} />
        <RecentNotifications notifications={notifications} />
      </div>
    </div>
  );
}

function NextConsultation({ consultation }) {
  if (!consultation)
    return (
      <section>
        <h2 className="mb-3 text-lg font-bold text-slate-900">
          Next Consultation
        </h2>
        <EmptyState
          title="No upcoming confirmed consultation"
          text="Your next confirmed consultation will appear here."
        />
      </section>
    );

  const start = validDate(consultation.startAt);
  const end = validDate(consultation.endAt);
  const place =
    consultation.consultationMode === "Online"
      ? consultation.meetingPlatform || "Online platform not provided"
      : consultation.location || "Location not provided";

  return (
    <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-slate-900">
            Next Consultation
          </h2>
          <p className="mt-3 break-words text-xl font-bold text-maroon-900">
            {consultation.subject || "Consultation"}
          </p>
          <p className="mt-1 text-sm text-slate-600">
            {formatPersonName(consultation.faculty) || "Faculty Member"}
          </p>
          <dl className="mt-4 grid min-w-0 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <Detail
              label="Date"
              value={start ? MANILA_DATE.format(start) : "Not provided"}
            />
            <Detail
              label="Time"
              value={
                start && end
                  ? `${MANILA_TIME.format(start)} – ${MANILA_TIME.format(end)}`
                  : "Not provided"
              }
            />
            <Detail
              label="Mode"
              value={consultation.consultationMode || "Not provided"}
            />
            <Detail label="Location / Platform" value={place} />
          </dl>
        </div>
        <Link to="/student/consultations" className="btn-secondary shrink-0">
          View Details
        </Link>
      </div>
    </section>
  );
}

function Detail({ label, value }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="mt-1 break-words font-semibold text-slate-800">{value}</dd>
    </div>
  );
}

function RecentConsultations({ consultations }) {
  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <CardHeader
        title="Recent Requests"
        to="/student/consultations"
        label="View All"
      />
      {consultations.length === 0 ? (
        <div className="p-4 sm:p-5">
          <EmptyState
            title="No recent requests"
            text="Your consultation requests will appear here."
          />
        </div>
      ) : (
        <div className="divide-y divide-slate-200">
          {consultations.map((consultation) => {
            const start = validDate(consultation.startAt);
            return (
              <Link
                key={consultation._id}
                to="/student/consultations"
                className="flex min-w-0 items-center gap-3 px-4 py-3.5 transition-colors hover:bg-maroon-50/60 sm:px-5"
              >
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-bold text-slate-900">
                    {consultation.subject || "Consultation"}
                  </p>
                  <p className="mt-1 break-words text-xs text-slate-600">
                    {formatPersonName(consultation.faculty) || "Faculty Member"}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {start
                      ? MANILA_DATE_TIME.format(start)
                      : "Schedule not yet available"}
                  </p>
                </div>
                <span className="max-w-36 shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-center text-[11px] font-semibold text-slate-700">
                  {consultation.status}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}

function RecentNotifications({ notifications }) {
  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <CardHeader
        title="Recent Notifications"
        to="/student/notifications"
        label="View All"
      />
      {notifications.length === 0 ? (
        <div className="p-4 sm:p-5">
          <EmptyState
            title="No recent notifications"
            text="Your latest notifications will appear here."
          />
        </div>
      ) : (
        <div className="divide-y divide-slate-200">
          {notifications.map((notification) => {
            const created = validDate(notification.createdAt);
            return (
              <Link
                key={notification._id}
                to="/student/notifications"
                className="flex min-w-0 items-start gap-3 px-4 py-3.5 transition-colors hover:bg-maroon-50/60 sm:px-5"
              >
                <span
                  className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${notification.isRead ? "bg-slate-300" : "bg-gold-500"}`}
                  aria-label={notification.isRead ? "Read" : "Unread"}
                />
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-bold text-slate-900">
                    {notification.title || "Notification"}
                  </p>
                  <p className="mt-1 break-words text-xs leading-5 text-slate-600">
                    {notification.message || "No additional details."}
                  </p>
                  {created && (
                    <p className="mt-1 text-xs text-slate-500">
                      {MANILA_DATE_TIME.format(created)}
                    </p>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}

function CardHeader({ title, to, label }) {
  return (
    <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-4 sm:px-5">
      <h2 className="min-w-0 text-lg font-bold text-slate-900">{title}</h2>
      <Link
        to={to}
        className="inline-flex shrink-0 items-center gap-1 text-sm font-bold text-maroon-800 hover:text-maroon-950"
      >
        {label}
        <ChevronRight size={16} aria-hidden="true" />
      </Link>
    </header>
  );
}
