import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/apiClient";
import { Loading, ErrorState, EmptyState, StatusBadge } from "../../components/UI";
import { useAuth } from "../../context/AuthContext";
import { formatPersonName } from "../../utils/formatPersonName";
import { formatManilaDateTime } from "../../utils/formatDateTime";

export default function FacultyDashboard({ routeBase = "/faculty", consultationsPath = `${routeBase}/consultations` }) {
  const { user } = useAuth();
  const [result, setResult] = useState(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const identity = `${user?.id || user?._id || ""}:${routeBase}`;
  useEffect(() => {
    let active = true;
    let sequence = 0;
    let controller;
    const load = () => {
      const request = ++sequence;
      controller?.abort();
      controller = new AbortController();
      setLoading(true);
      setError(false);
      api("/dashboard/faculty", { signal: controller.signal, cache: "no-store" })
        .then(data => { if (active && request === sequence) setResult({ identity, data }); })
        .catch(() => { if (active && request === sequence) setError(true); })
        .finally(() => { if (active && request === sequence) setLoading(false); });
    };
    load();
    const interval = setInterval(load, 30000);
    window.addEventListener("notifications:updated", load);
    return () => { active = false; controller?.abort(); clearInterval(interval); window.removeEventListener("notifications:updated", load); };
  }, [identity, retry]);
  if (error) return <ErrorState message="Unable to load the dashboard. Please try again." onRetry={() => setRetry(value => value + 1)} />;
  if (loading || result?.identity !== identity) return <Loading message="Loading your dashboard..." />;
  const data = result.data;
  const notificationsPath = routeBase === "/dean/faculty" ? "/dean/notifications?workspace=faculty" : "/faculty/notifications";
  const rows = (items, empty) => items.length ? <ul className="space-y-3">{items.map(item => {
    const inProgress = item.status === "Confirmed" && new Date(item.startAt) <= new Date(data.asOf) && new Date(data.asOf) < new Date(item.endAt);
    return <li key={item._id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="min-w-0 break-words"><p className="font-semibold">{item.subject}</p><p className="text-sm text-slate-600">{item.studentName || "Student unavailable"}</p><p className="text-sm text-slate-500">{item.startAt ? formatManilaDateTime(item.startAt) : "Not yet scheduled"}</p>{inProgress && <p className="text-sm font-semibold text-maroon-800">In progress</p>}</div>
      <StatusBadge status={item.status} compact allowWrap />
    </li>;
  })}</ul> : <EmptyState title={empty} text="Your consultations and requests will appear here." />;
  return <div className="w-full min-w-0 space-y-7">
    <section className="rounded-2xl bg-[#72182A] p-5 text-white shadow-sm sm:p-8">
      <p className="eyebrow !text-gold-300">Welcome back</p><h1 className="mt-2 break-words text-3xl font-bold sm:text-4xl">Hello, {formatPersonName(user)}</h1>
      <p className="mt-2 text-sm text-slate-100">Your personal consultation dashboard.</p>
      <nav aria-label="Dashboard shortcuts" className="mt-5 flex flex-wrap gap-3"><Link className="btn-secondary" to={`${routeBase}/availability`}>Availability &amp; Calendar</Link><Link className="btn-secondary" to={`${routeBase}/requests`}>Consultation Requests</Link></nav>
    </section>
    <section aria-label="Consultation counts" className="grid gap-4 sm:grid-cols-3">{[
      ["Pending requests", data.pendingCount, `${routeBase}/requests`],
      ["Upcoming Confirmed consultations", data.upcomingCount, consultationsPath],
      ["Attendance responses required", data.attendanceRequiredCount, consultationsPath],
    ].map(([label, count, to]) => <Link key={label} to={to} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm focus-visible:ring-2 focus-visible:ring-maroon-400"><strong className="block text-3xl text-maroon-900">{count}</strong><span className="text-sm font-semibold text-slate-600">{label}</span></Link>)}</section>
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="mb-4 text-lg font-bold">Next Confirmed consultation</h2>{rows(data.nextConsultation ? [data.nextConsultation] : [], "No upcoming Confirmed consultation")}<Link className="mt-4 inline-block text-sm font-semibold text-maroon-800 underline" to={consultationsPath}>View consultations</Link></section>
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="mb-4 text-lg font-bold">Today’s consultations ({data.todayTotal})</h2><p className="mb-4 text-sm text-slate-500">Asia/Manila · Scheduled to start today</p>{rows(data.todayConsultations, "No consultations today")}{data.todayTotal > data.todayConsultations.length && <p className="mt-3 text-sm text-slate-600">Showing {data.todayConsultations.length} of {data.todayTotal}. View consultations for more.</p>}</section>
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="mb-4 text-lg font-bold">Recent Pending requests</h2>{rows(data.recentRequests, "No Pending requests")}</section>
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="mb-4 text-lg font-bold">Recent personal notifications</h2>{data.recentNotifications.length ? <ul className="space-y-3">{data.recentNotifications.map(notice => <li key={notice._id} className="rounded-xl border border-slate-200 p-4"><Link className="font-semibold text-maroon-800 underline" to={notice.actionUrl}>{notice.title}</Link>{!notice.isRead && <span className="ml-2 text-xs font-semibold">Unread</span>}<p className="break-words text-sm text-slate-600">{notice.message}</p><p className="text-xs text-slate-500">{formatManilaDateTime(notice.createdAt)}</p></li>)}</ul> : <EmptyState title="No personal notifications" text="Consultation updates will appear here." />}<Link className="mt-4 inline-block text-sm font-semibold text-maroon-800 underline" to={notificationsPath}>View notifications</Link></section>
    <p className="text-xs text-slate-500">Updated {formatManilaDateTime(data.asOf)} · Asia/Manila</p>
  </div>;
}
