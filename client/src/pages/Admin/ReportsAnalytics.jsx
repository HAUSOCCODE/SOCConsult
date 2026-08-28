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
        new Date(item.startAt).toLocaleString(),
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
    downloadCsv(
      rows,
      `SOCConsult_User_Registration_Report_${fileDate()}.csv`,
    );
  };

  return (
    <div className="space-y-6 pb-20 md:pb-16">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-maroon-900">
            Reports &amp; Analytics
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Generate consultation and account audit reports from live system data.
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
        <h2 className="font-bold">AI-Assisted Report Summary</h2>
        <p className="mt-2 text-sm text-slate-500">
          AI summaries are reserved for a future configured AI service.
          Appointment decisions remain entirely human-controlled.
        </p>
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
