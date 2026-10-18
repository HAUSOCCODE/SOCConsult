import { formatManilaDisplay } from "../../utils/formatDateTime";
import { deanUiError } from "../../utils/deanUiErrors";
import ManagementAuditFeed from "./ManagementAuditFeed";
import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  FileText,
  RefreshCw,
  Search,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api/apiClient";
import { StatusBadge } from "../../components/UI";
import { formatPersonName } from "../../utils/formatPersonName";

const categories = [
  "All Activities",
  "Account",
  "Authentication",
  "Profile",
  "Consultation",
  "Appointment",
  "Documents",
  "Tasks",
];
const categoryIcons = {
  Account: ShieldCheck,
  Authentication: CheckCircle2,
  Profile: UserRound,
  Consultation: CalendarClock,
  Appointment: CalendarClock,
  Documents: FileText,
  Tasks: CheckCircle2,
};
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";
const formatDate = (value) =>
  value
    ? formatManilaDisplay(new Date(value), {
        timeZone: "Asia/Manila",
        month: "short",
        day: "numeric",
        year: "numeric",
      }, "date")
    : "No activity yet";
const formatTime = (value) =>
  formatManilaDisplay(new Date(value), {
    timeZone: "Asia/Manila",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }, "time");
const initials = (name = "") =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "U";

export default function AuditLogs() {
  const [role, setRole] = useState("student");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [userPage, setUserPage] = useState(1);
  const [usersState, setUsersState] = useState({
    users: [],
    counts: {},
    pagination: null,
  });
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [mobileDetails, setMobileDetails] = useState(false);
  const [category, setCategory] = useState("All Activities");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [logPage, setLogPage] = useState(1);
  const [details, setDetails] = useState(null);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState("");
  const [exporting, setExporting] = useState(false);
  const userRequest = useRef(0);
  const logRequest = useRef(0);
  const exportPending = useRef(false);
  const [exportMessage, setExportMessage] = useState("");
  const [exportError, setExportError] = useState("");
  const exportController = useRef(null);
  const mobilePanel = useRef(null);
  const userTrigger = useRef(null);
  useEffect(() => {
    if (mobileDetails && window.matchMedia("(max-width: 639px)").matches) mobilePanel.current?.focus();
  }, [mobileDetails]);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => () => exportController.current?.abort(), [selectedId, category, startDate, endDate]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setUserPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const loadUsers = useCallback(async () => {
    const request = ++userRequest.current;
    setUsersLoading(true);
    setUsersError("");
    try {
      const query = new URLSearchParams({
        role,
        search,
        page: userPage,
        limit: 8,
      });
      const data = await api(`/dean/audit-users?${query}`);
      if (request !== userRequest.current) return;
      setUsersState(data);
      setSelectedId((current) =>
        data.users.some((user) => user.id === current)
          ? current
          : data.users[0]?.id || null,
      );
    } catch (error) {
      if (request === userRequest.current)
        setUsersError(deanUiError(error, "audit"));
    } finally {
      if (request === userRequest.current) setUsersLoading(false);
    }
  }, [role, search, userPage]);
  useEffect(() => { void loadUsers(); return () => { ++userRequest.current; }; }, [loadUsers]);

  const loadLogs = useCallback(async () => {
    if (!selectedId) {
      setDetails(null);
      return;
    }
    const request = ++logRequest.current;
    setDetails(current => current?.user?.id === selectedId ? current : null);
    setLogsLoading(true);
    setLogsError("");
    try {
      const query = new URLSearchParams({ page: logPage, limit: 12 });
      if (category !== "All Activities") query.set("category", category);
      if (startDate) query.set("startDate", startDate);
      if (endDate) query.set("endDate", endDate);
      const data = await api(`/dean/audit-users/${selectedId}/logs?${query}`);
      if (request === logRequest.current) setDetails(data);
    } catch (error) {
      if (request === logRequest.current)
        setLogsError(deanUiError(error, "audit"));
    } finally {
      if (request === logRequest.current) setLogsLoading(false);
    }
  }, [selectedId, logPage, category, startDate, endDate]);
  useEffect(() => { void loadLogs(); return () => { ++logRequest.current; }; }, [loadLogs]);

  const switchRole = (nextRole) => {
    setRole(nextRole);
    setSearchInput("");
    setSearch("");
    setUserPage(1);
    setSelectedId(null);
    setDetails(null);
    setLogPage(1);
    setMobileDetails(false);
  };
  const selectUser = (id) => {
    ++logRequest.current;
    if (id !== selectedId) setDetails(null);
    setSelectedId(id);
    setLogPage(1);
    setMobileDetails(true);
  };
  const updateFilter = (setter, value) => {
    setter(value);
    setLogPage(1);
  };
  const exportLogs = async () => {
    if (!selectedId || exportPending.current) return;
    exportPending.current = true;
    const controller = new AbortController(); exportController.current = controller;
    setExportError("");
    setExportMessage("");
    setExporting(true);
    try {
      const query = new URLSearchParams({
        userId: selectedId,
        page: 1,
        limit: 100,
      });
      if (category !== "All Activities") query.set("category", category);
      if (startDate) query.set("startDate", startDate);
      if (endDate) query.set("endDate", endDate);
      const response = await fetch(
        `${API_URL}/dean/audit-logs/export?${query}`,
        {
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${sessionStorage.getItem("consultio_token") || ""}`,
          },
        },
      );
      if (!response.ok) {
        throw Object.assign(new Error(), { status: response.status });
      }
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      const disposition = response.headers.get("Content-Disposition") || "";
      const filename =
        disposition.match(/filename="([^"]+)"/)?.[1] ||
        "socconsult-audit-logs.csv";
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      setExportMessage("Audit export generated; download started.");
      URL.revokeObjectURL(url);
    } catch (error) {
      if (!controller.signal.aborted) setExportError("Unable to generate the audit export. Check the filters and try again.");
    } finally {
      exportPending.current = false;
      if (mounted.current) setExporting(false);
    }
  };

  const selectedFromList = usersState.users.find(
    (user) => user.id === selectedId,
  );
  return (
    <div className="audit-logs-page min-w-0 space-y-5 pb-20 md:pb-16">
      <header>
        <h1 className="text-2xl font-bold text-maroon-900">Audit Logs</h1>
        <p className="mt-2 text-sm text-slate-500">
          Review detailed activity records for registered students and faculty.
        </p>
      </header>
      <ManagementAuditFeed />
      {exporting && <p role="status">Generating audit export?</p>}
      {exportMessage && <p role="status">{exportMessage}</p>}
      {exportError && <p id="audit-export-error" role="alert">{exportError}</p>}
      <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
        <div
          role="group"
          aria-label="Registered user role"
          className="grid w-full grid-cols-2 rounded-xl bg-slate-100 p-1 sm:w-fit sm:min-w-80"
        >
          {[
            ["student", "Students"],
            ["faculty", "Faculty"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={role === value}
              onClick={() => switchRole(value)}
              className={`rounded-lg px-4 py-2.5 text-sm font-bold transition focus-visible:ring-2 focus-visible:ring-maroon-300 ${role === value ? "bg-maroon-800 text-white shadow-sm" : "text-slate-600 hover:bg-white"}`}
            >
              {label}
              <span
                className={`ml-2 rounded-full px-2 py-0.5 text-xs ${role === value ? "bg-white/15 text-gold-200" : "bg-white text-slate-500"}`}
              >
                {usersState.counts?.[value] ?? "—"}
              </span>
            </button>
          ))}
        </div>
        <div role="group" aria-label="Activity filters" aria-describedby={logsError ? "audit-filter-error" : exportError ? "audit-export-error" : undefined} className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(15rem,1fr)_12rem_12rem_13rem_auto] xl:items-end">
          <label className="min-w-0 text-xs font-bold text-slate-600">
            Search registered users
            <span className="relative mt-1.5 block">
              <Search aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                size={16}
              />
              <input
                className="field h-10 pl-9"
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Name, email, or ID"
              />
            </span>
          </label>
          <FilterDate
            label="Start date"
            value={startDate}
            onChange={(value) => updateFilter(setStartDate, value)}
          />
          <FilterDate
            label="End date"
            value={endDate}
            onChange={(value) => updateFilter(setEndDate, value)}
          />
          <label className="text-xs font-bold text-slate-600">
            Activity category
            <select
              className="field mt-1.5 h-10"
              value={category}
              onChange={(event) =>
                updateFilter(setCategory, event.target.value)
              }
            >
              {categories.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={exportLogs}
            disabled={!selectedId || exporting}
            className="btn-primary h-10 min-h-0 gap-2 px-4 py-0 disabled:opacity-50 sm:col-span-2 xl:col-span-1"
          >
            <Download aria-hidden="true" size={16} /> {exporting ? "Exporting…" : "Export Logs"}
          </button>
        </div>
      </section>

      <div
        className={`audit-master-detail min-w-0 gap-4 ${mobileDetails ? "show-mobile-details" : ""}`}
      >
        <section className="audit-user-panel min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3.5">
            <div>
              <h2 className="font-bold text-maroon-900">
                Registered {role === "student" ? "Students" : "Faculty"}
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                {usersState.pagination?.total ?? 0} result
                {usersState.pagination?.total === 1 ? "" : "s"}
              </p>
            </div>
            <button
              type="button"
              onClick={loadUsers}
              aria-label="Refresh registered users"
              className="grid h-9 w-9 place-items-center rounded-lg text-maroon-800 hover:bg-maroon-50 focus-visible:ring-2 focus-visible:ring-maroon-300"
            >
              <RefreshCw aria-hidden="true" size={16} />
            </button>
          </div>
          <div className="p-2">
            {usersLoading ? (
              <UserListSkeleton />
            ) : usersError ? (
              <InlineError message={usersError} retry={loadUsers} />
            ) : usersState.users.length === 0 ? (
              <div className="px-4 py-12 text-center">
                <UserRound aria-hidden="true" className="mx-auto text-slate-300" size={34} />
                <p className="mt-3 font-semibold text-slate-700">
                  {search ? "No registered users match this search." : `No registered ${role === "student" ? "students" : "faculty"} yet.`}
                </p>
              </div>
            ) : (
              usersState.users.map((user) => (
                <button
                  key={user.id}
                  type="button"
                  aria-pressed={selectedId === user.id}
                  onClick={event => { userTrigger.current = event.currentTarget; selectUser(user.id); }}
                  className={`mb-1 flex w-full min-w-0 items-start gap-3 rounded-xl border p-3 text-left transition focus-visible:ring-2 focus-visible:ring-maroon-300 ${selectedId === user.id ? "border-maroon-300 bg-maroon-50 shadow-sm" : "border-transparent hover:border-slate-200 hover:bg-slate-50"}`}
                >
                  <Avatar user={user} small />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-start justify-between gap-2">
                      <p className="min-w-0 break-words text-sm font-bold text-slate-900">
                        {formatPersonName(user)}
                      </p>
                      <StatusBadge allowWrap status={user.accountStatus} compact />
                    </div>
                    <p className="mt-0.5 break-all text-xs text-slate-600">
                      {user.email}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {user.studentId || user.employeeId || "ID unavailable"}
                      {user.role === "student" && user.yearLevel
                        ? ` · ${user.yearLevel}`
                        : user.position
                          ? ` · ${user.position}`
                          : ""}
                    </p>
                    <p className="mt-1.5 flex items-center gap-1 text-[11px] text-slate-400">
                      <Clock3 aria-hidden="true" size={12} /> Last activity:{" "}
                      {formatDate(user.lastActivity)}
                    </p>
                  </div>
                  <ChevronRight aria-hidden="true"
                    className="mt-1 shrink-0 text-slate-400"
                    size={16}
                  />
                </button>
              ))
            )}
          </div>
          <Pager pagination={usersState.pagination} onPage={setUserPage} />
        </section>

        <section ref={mobilePanel} tabIndex={-1} aria-label="Selected user activity" className="audit-details-panel min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <button
            type="button"
            onClick={() => { setMobileDetails(false); queueMicrotask(() => { if (userTrigger.current?.isConnected) userTrigger.current.focus(); }); }}
            className="m-3 mb-0 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold text-maroon-800 hover:bg-maroon-50 md:hidden"
          >
            <ArrowLeft aria-hidden="true" size={16} /> Back to users
          </button>
          {!selectedId ? (
            <div className="grid min-h-80 place-items-center p-8 text-center text-slate-500">
              Select a registered user to review activity.
            </div>
          ) : logsLoading && !details ? (
            <DetailsSkeleton />
          ) : logsError ? (
            <InlineError id="audit-filter-error" message={logsError} retry={loadLogs} />
          ) : details ? (
            <>
              <UserSummary
                user={details.user || selectedFromList}
                summary={details.summary}
              />
              <div className="border-t border-slate-200 px-4 py-4 sm:px-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-bold text-maroon-900">
                    Activity Timeline
                  </h2>
                  {logsLoading && (
                    <span className="text-xs text-slate-500">Refreshing…</span>
                  )}
                </div>
                {details.logs.length === 0 ? (
                  <div className="py-12 text-center">
                    <Clock3 aria-hidden="true" className="mx-auto text-slate-300" size={34} />
                    <p className="mt-3 font-semibold text-slate-700">
                      {category !== "All Activities" || startDate || endDate ? "No activity matches these filters." : "No recorded activity is available for this user yet."}
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                      New activity will appear here as it occurs.
                    </p>
                  </div>
                ) : (
                  <div className="mt-5 space-y-0">
                    {details.logs.map((log, index) => (
                      <TimelineEntry
                        key={log.id}
                        log={log}
                        last={index === details.logs.length - 1}
                      />
                    ))}
                  </div>
                )}
              </div>
              <Pager
                pagination={details.pagination}
                onPage={setLogPage}
                label="activity page"
              />
            </>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function Avatar({ user, small = false }) {
  const size = small ? "h-11 w-11 text-xs" : "h-16 w-16 text-lg";
  return user?.profilePicture ? (
    <img
      src={user.profilePicture}
      alt=""
      className={`${size} shrink-0 rounded-full border border-maroon-100 object-cover`}
    />
  ) : (
    <span
      className={`${size} grid shrink-0 place-items-center rounded-full bg-maroon-800 font-bold text-white`}
    >
      {initials(user?.name)}
    </span>
  );
}
function FilterDate({ label, value, onChange }) {
  return (
    <label className="text-xs font-bold text-slate-600">
      {label}
      <input
        className="field mt-1.5 h-10"
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
function UserSummary({ user, summary }) {
  if (!user) return null;
  return (
    <div className="p-4 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <Avatar user={user} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="break-words text-xl font-bold text-maroon-900">
              {formatPersonName(user)}
            </h2>
            <StatusBadge allowWrap status={user.accountStatus} compact />
          </div>
          <p className="mt-1 break-all text-sm text-slate-600">{user.email}</p>
          <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-gold-600">
            {user.role}
          </p>
        </div>
        <div className="rounded-xl bg-maroon-50 px-4 py-3 text-left sm:text-right">
          <strong className="block text-2xl text-maroon-900">
            {summary?.totalEvents ?? 0}
          </strong>
          <span className="text-xs text-slate-500">Recorded events</span>
        </div>
      </div>
      <dl className="mt-5 grid gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4 sm:grid-cols-2 lg:grid-cols-3">
        <SummaryItem
          label={user.role === "student" ? "Student ID" : "Faculty ID"}
          value={user.studentId || user.employeeId || "Not available"}
        />
        <SummaryItem
          label={user.role === "student" ? "Year level" : "Position"}
          value={user.yearLevel || user.position || "Not available"}
        />
        <SummaryItem
          label="Account creation date"
          value={formatDate(user.registeredAt)}
        />
        <SummaryItem
          label="Last recorded activity"
          value={formatDate(summary?.lastActivity)}
        />
        {user.role === "student" ? (
          <SummaryItem
            label="Program"
            value={user.program || "Not available"}
          />
        ) : (
          <SummaryItem
            label="Specialization"
            value={user.specialization || "Not available"}
          />
        )}
      </dl>
    </div>
  );
}
function SummaryItem({ label, value }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold text-slate-500">{label}</dt>
      <dd className="mt-1 break-words text-sm font-semibold text-slate-800">
        {value}
      </dd>
    </div>
  );
}
function TimelineEntry({ log, last }) {
  const Icon = categoryIcons[log.category] || Clock3;
  const before = log.changes?.before?.status;
  const after = log.changes?.after?.status;
  return (
    <article className="relative grid grid-cols-[2.25rem_minmax(0,1fr)] gap-3 pb-5">
      {!last && (
        <span className="absolute bottom-0 left-[1.08rem] top-9 w-px bg-slate-200" />
      )}
      <span className="relative z-10 grid h-9 w-9 place-items-center rounded-full border border-maroon-100 bg-maroon-50 text-maroon-800">
        <Icon aria-hidden="true" size={16} />
      </span>
      <div className="min-w-0 rounded-xl border border-slate-200 p-3.5 sm:p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="font-bold text-slate-900">{log.title}</h3>
            <span className="mt-1 inline-block rounded-full bg-gold-50 px-2 py-0.5 text-[11px] font-bold text-gold-700">
              {log.category}
            </span>
          </div>
          <time dateTime={log.createdAt} className="text-xs text-slate-500">
            {formatDate(log.createdAt)} · {formatTime(log.createdAt)}
          </time>
        </div>
        <p className="mt-3 break-words text-sm leading-6 text-slate-600">
          {log.description}
        </p>
        {before && after && (
          <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
            Status changed from <strong>{before}</strong> to{" "}
            <strong>{after}</strong>.
          </p>
        )}
        {log.action === "appointment_rescheduled" && log.metadata && (
          <dl className="mt-3 grid gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-slate-700 sm:grid-cols-2">
            <AuditDetail label="Topic" value={log.metadata.topic} />
            <AuditDetail label="Faculty" value={log.metadata.facultyName} />
            <AuditDetail label="Student" value={log.metadata.studentName} />
            <AuditDetail
              label="Previous schedule"
              value={log.metadata.previousSchedule}
            />
            <AuditDetail
              label="New schedule"
              value={log.metadata.newSchedule}
            />
            <AuditDetail label="Reason" value={log.metadata.reason} wide />
          </dl>
        )}
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
          <span>
            Performed by{" "}
            <strong className="text-slate-700">
              {formatPersonName(log.actor?.name) || "SOCConsult System"}
            </strong>
          </span>
          {log.relatedRecord && (
            <span className="break-all">
              {log.relatedRecord.type}: {log.relatedRecord.id}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

function AuditDetail({ label, value, wide = false }) {
  if (!value) return null;
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <dt className="font-bold text-slate-500">{label}</dt>
      <dd className="mt-0.5 break-words">{value}</dd>
    </div>
  );
}
function Pager({ pagination, onPage, label = "page" }) {
  if (!pagination || pagination.pages <= 1) return null;
  return (
    <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-xs text-slate-500">
      <span>
        Page {pagination.page} of {pagination.pages}
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          aria-label={`Previous ${label}`}
          disabled={pagination.page <= 1}
          onClick={() => onPage(pagination.page - 1)}
          className="grid h-8 w-8 place-items-center rounded-lg border disabled:opacity-40"
        >
          <ChevronLeft aria-hidden="true" size={15} />
        </button>
        <button
          type="button"
          aria-label={`Next ${label}`}
          disabled={pagination.page >= pagination.pages}
          onClick={() => onPage(pagination.page + 1)}
          className="grid h-8 w-8 place-items-center rounded-lg border disabled:opacity-40"
        >
          <ChevronRight aria-hidden="true" size={15} />
        </button>
      </div>
    </div>
  );
}
function InlineError({ message, retry, id }) {
  return (
    <div id={id} className="m-4 rounded-xl border border-red-200 bg-red-50 p-5 text-center text-sm text-red-700">
      <p role="alert">{message}</p>
      <button
        type="button"
        onClick={retry}
        className="mt-3 font-bold underline"
      >
        Retry
      </button>
    </div>
  );
}
function UserListSkeleton() {
  return (
    <div className="space-y-2 p-2" role="status" aria-label="Loading registered users">
      {Array.from({ length: 5 }, (_, index) => (
        <div
          key={index}
          className="h-24 animate-pulse rounded-xl bg-slate-100"
        />
      ))}
    </div>
  );
}
function DetailsSkeleton() {
  return (
    <div className="space-y-4 p-6" role="status" aria-label="Loading audit details">
      <div className="h-24 animate-pulse rounded-xl bg-slate-100" />
      <div className="h-36 animate-pulse rounded-xl bg-slate-100" />
      <div className="h-36 animate-pulse rounded-xl bg-slate-100" />
    </div>
  );
}
