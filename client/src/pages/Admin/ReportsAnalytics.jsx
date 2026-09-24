import { ChevronDown, FileText, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../api/apiClient";
import { EmptyState, ErrorState, Loading } from "../../components/UI";
import { formatPersonName } from "../../utils/formatPersonName";

const displayDate = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
};

const safeCsvCell = (value) => {
  let text = String(value ?? "");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
};

const downloadCsv = (rows, filename) => {
  const content = rows.map((row) => row.map(safeCsvCell).join(",")).join("\n");
  const blob = new Blob(["\uFEFF", content], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

const fileDate = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

const inputDate = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const summaryRangeLabel = ({ start, end }) => {
  const startDate = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);
  const options = { month: "long", day: "numeric", year: "numeric" };
  return `${startDate.toLocaleDateString("en-US", options)} – ${endDate.toLocaleDateString("en-US", options)}`;
};

const approvalMethodLabel = (user) => {
  if (user.registrationStatus === "Pending") return "Pending Admin Approval";
  if (user.registrationStatus === "Rejected") return "Rejected by Admin";
  if (["email_verification", "system"].includes(user.approvalMethod))
    return "Automatic - Email Verification";
  if (user.approvalMethod === "admin" || user.approvedBy)
    return "Admin Approval";
  return "Not Available";
};

const auditorLabel = (user) => {
  if (["email_verification", "system"].includes(user.approvalMethod))
    return "System";
  const auditor =
    user.registrationStatus === "Rejected" ? user.rejectedBy : user.approvedBy;
  return formatPersonName(auditor?.name) || auditor?.email || "—";
};

export default function ReportsAnalytics() {
  const [items, setItems] = useState(null);
  const [registrations, setRegistrations] = useState(null);
  const [error, setError] = useState("");
  const [registrationError, setRegistrationError] = useState("");
  const today = new Date();
  const [summaryStart, setSummaryStart] = useState(
    inputDate(new Date(today.getFullYear(), today.getMonth(), 1)),
  );
  const [summaryEnd, setSummaryEnd] = useState(inputDate(today));
  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState("");

  const load = () => {
    setError("");
    setRegistrationError("");
    setItems(null);
    setRegistrations(null);
    Promise.allSettled([
      api("/admin/appointments"),
      api("/admin/reports/user-registrations"),
    ]).then(([appointmentsResult, registrationsResult]) => {
      if (appointmentsResult.status === "fulfilled") {
        setItems(
          Array.isArray(appointmentsResult.value?.appointments)
            ? appointmentsResult.value.appointments
            : [],
        );
      } else setError("Unable to generate reports. Please try again.");

      if (registrationsResult.status === "fulfilled") {
        setRegistrations(
          Array.isArray(registrationsResult.value?.users)
            ? registrationsResult.value.users
            : [],
        );
      } else {
        setRegistrations([]);
        setRegistrationError(
          "The user registration report is temporarily unavailable.",
        );
      }
    });
  };

  useEffect(load, []);
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!items) return <Loading />;

  const completed = items.filter((item) => item.status === "Completed");
  const exportConsultations = () => {
    const rows = [
      ["Student", "Faculty", "Subject", "Date", "Status"],
      ...items.map((item) => [
        formatPersonName(item.student?.name),
        formatPersonName(item.faculty?.name),
        item.subject,
        item.startAt
          ? new Date(item.startAt).toLocaleString("en-PH", {
              timeZone: "Asia/Manila",
            })
          : "Not scheduled",
        item.status,
      ]),
    ];
    downloadCsv(rows, "socconsult-report.csv");
  };

  const exportRegistrations = () => {
    const rows = [
      [
        "Name",
        "Email",
        "Role",
        "Registered Date",
        "Email Verification",
        "Verified Date",
        "Approval Status",
        "Approval Method",
        "Approved By",
        "Approved Date",
        "Account Status",
      ],
      ...registrations.map((user) => [
        formatPersonName(user.name),
        user.email,
        user.role
          ? `${user.role.charAt(0).toUpperCase()}${user.role.slice(1)}`
          : "Not Available",
        displayDate(user.createdAt),
        typeof user.emailVerified === "boolean"
          ? user.emailVerified
            ? "Verified"
            : "Not Verified"
          : "Not Available",
        user.emailVerifiedAt ? displayDate(user.emailVerifiedAt) : "—",
        user.registrationStatus || "Not Available",
        approvalMethodLabel(user),
        auditorLabel(user),
        user.approvedAt ? displayDate(user.approvedAt) : "—",
        user.accountStatus || "Not Available",
      ]),
    ];
    downloadCsv(rows, `SOCConsult_User_Registration_Report_${fileDate()}.csv`);
  };

  const setSummaryPreset = (preset) => {
    const now = new Date();
    let start;
    let end = now;
    if (preset === "week") {
      start = new Date(now);
      start.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    } else if (preset === "month") {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
    } else {
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      end = new Date(now.getFullYear(), now.getMonth(), 0);
    }
    setSummaryStart(inputDate(start));
    setSummaryEnd(inputDate(end));
    setSummary(null);
    setSummaryError("");
  };

  const generateSummary = async () => {
    setSummaryError("");
    setSummary(null);
    if (!summaryStart || !summaryEnd) {
      setSummaryError("Select a start date and end date.");
      return;
    }
    if (summaryEnd < summaryStart) {
      setSummaryError("End date must be on or after the start date.");
      return;
    }
    setSummaryLoading(true);
    try {
      const query = new URLSearchParams({
        startDate: summaryStart,
        endDate: summaryEnd,
      });
      setSummary(await api(`/admin/reports/ai-summary?${query}`));
    } catch (requestError) {
      setSummaryError(
        requestError.message || "Unable to generate the summary.",
      );
    } finally {
      setSummaryLoading(false);
    }
  };

  return (
    <div className="space-y-6 pb-20 md:pb-16">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-maroon-900">
            Reports &amp; Analytics
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Generate consultation and account audit reports from live system
            data.
          </p>
        </div>
        <details className="group relative w-full sm:w-auto">
          <summary className="btn-primary w-full list-none gap-2 sm:w-auto [&::-webkit-details-marker]:hidden">
            Export Reports <ChevronDown size={17} aria-hidden="true" />
          </summary>
          <div className="absolute right-0 z-20 mt-2 w-full min-w-72 overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl sm:w-80">
            <ReportOption
              icon={FileText}
              title="Consultation Report"
              description="Appointment and consultation activity records."
              onClick={exportConsultations}
            />
            <ReportOption
              icon={Users}
              title="User Registration & Account Report"
              description="Registration, verification, approval, and account-status audit records."
              onClick={exportRegistrations}
              disabled={Boolean(registrationError) || registrations === null}
            />
          </div>
        </details>
      </div>

      {registrationError && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {registrationError} The consultation report remains available.
        </p>
      )}
      {items.length === 0 && <EmptyState title="No reports generated yet." />}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Metric label="Total consultations" value={items.length} />
        <Metric label="Completed" value={completed.length} />
        <Metric
          label="Completion rate"
          value={`${items.length ? Math.round((completed.length / items.length) * 100) : 0}%`}
        />
      </div>
      <section className="rounded-2xl border bg-white p-4 sm:p-6">
        <h2 className="font-bold text-maroon-900">
          AI-Assisted Report Summary
        </h2>
        <p className="mt-2 text-sm text-slate-500">
          Generate a narrative summary of completed consultations for a selected
          date range.
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
          <label className="text-sm font-semibold">
            Start date
            <input
              type="date"
              className="field mt-1"
              value={summaryStart}
              onChange={(event) => {
                setSummaryStart(event.target.value);
                setSummary(null);
              }}
            />
          </label>
          <label className="text-sm font-semibold">
            End date
            <input
              type="date"
              className="field mt-1"
              value={summaryEnd}
              onChange={(event) => {
                setSummaryEnd(event.target.value);
                setSummary(null);
              }}
            />
          </label>
          <button
            type="button"
            className="btn-primary h-11"
            disabled={summaryLoading}
            onClick={generateSummary}
          >
            {summaryLoading
              ? "Analyzing consultation records…"
              : "Generate Consultation Summary"}
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={() => setSummaryPreset("week")}
          >
            This Week
          </button>
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={() => setSummaryPreset("month")}
          >
            This Month
          </button>
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={() => setSummaryPreset("previous")}
          >
            Previous Month
          </button>
        </div>
        {summaryError && (
          <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {summaryError}
          </p>
        )}
        {summary && (
          <div className="mt-6 border-t border-slate-200 pt-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-bold text-maroon-900">
                  Consultation Summary
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  {summaryRangeLabel(summary.dateRange)}
                </p>
              </div>
              <button
                type="button"
                className="btn-secondary text-xs"
                disabled={summaryLoading}
                onClick={generateSummary}
              >
                Regenerate Summary
              </button>
            </div>
            <p className="mt-4 leading-7 text-slate-700">{summary.summary}</p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Insight
                label="Completed consultations"
                value={summary.insights.totalConsultations}
              />
              <Insight
                label="Most active faculty"
                value={summary.insights.mostActiveFaculty || "—"}
              />
              <Insight
                label="Most active year level"
                value={summary.insights.mostActiveYearLevel || "—"}
              />
              <Insight
                label="Common topics"
                value={summary.insights.commonTopics?.join(", ") || "—"}
              />
              <Insight
                label="Meeting modes"
                value={
                  Object.entries(summary.insights.modeDistribution || {})
                    .map(([mode, count]) => `${mode}: ${count}`)
                    .join(" · ") || "—"
                }
              />
              <Insight
                label="Average duration"
                value={
                  summary.insights.averageDurationMinutes
                    ? `${summary.insights.averageDurationMinutes} minutes`
                    : "—"
                }
              />
            </div>
            <p className="mt-5 text-xs text-slate-500">
              AI-generated for administrative reference. Appointment and
              academic decisions remain human-controlled.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

function ReportOption({ icon: Icon, title, description, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full min-w-0 items-start gap-3 rounded-lg p-3 text-left hover:bg-maroon-50 focus-visible:ring-2 focus-visible:ring-maroon-200 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Icon size={18} className="mt-0.5 shrink-0 text-maroon-700" />
      <span className="min-w-0">
        <strong className="block text-sm text-maroon-900">{title}</strong>
        <span className="mt-0.5 block text-xs leading-4 text-slate-500">
          {description}
        </span>
      </span>
    </button>
  );
}

function Metric({ label, value }) {
  return (
    <div className="rounded-2xl border bg-white p-5">
      <p className="text-sm text-slate-500">{label}</p>
      <strong className="mt-2 block text-3xl text-maroon-900">{value}</strong>
    </div>
  );
}

function Insight({ label, value }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <p className="mt-1 break-words text-sm font-bold text-maroon-900">
        {value}
      </p>
    </div>
  );
}
